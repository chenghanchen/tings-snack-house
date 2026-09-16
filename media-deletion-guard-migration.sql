-- Apply BEFORE deploying the guarded admin-media-cleanup function.
-- No files are deleted by this migration. Retired paths cannot be reused.
begin;
-- Fail rather than hold up production writers indefinitely during DDL.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.media_retired_paths (
  path text primary key,
  retired_at timestamptz not null default now()
);
alter table public.media_retired_paths enable row level security;
revoke all on public.media_retired_paths from public, anon, authenticated, service_role;

create or replace function public.media_reference_write_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Older repeatable-read snapshots cannot safely check a newly committed fence.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception '媒体引用写入需要 READ COMMITTED 事务';
  end if;
  perform pg_advisory_xact_lock(724617001::bigint);
  return null;
end $$;

create or replace function public.media_path_from_url(value text)
returns text language plpgsql immutable set search_path = '' as $$
declare encoded text; decoded text; bytes bytea := ''::bytea; i integer := 1; c text;
begin
  encoded := substring(value from '/storage/v1/(?:object|render/image)/(?:public|sign|authenticated)/storefront-images/([^?#]+)');
  if encoded is null then return null; end if;
  while i <= length(encoded) loop
    c := substr(encoded,i,1);
    if c = '%' then
      if substr(encoded,i+1,2) !~ '^[0-9A-Fa-f]{2}$' then raise exception '无效的媒体 URL 编码'; end if;
      bytes := bytes || decode(substr(encoded,i+1,2),'hex'); i := i+3;
    else
      bytes := bytes || convert_to(c,'UTF8'); i := i+1;
    end if;
  end loop;
  decoded := trim(both '/' from convert_from(bytes,'UTF8'));
  return decoded;
end $$;

create or replace function public.media_paths_in_json(value jsonb)
returns setof text language sql immutable set search_path = '' as $$
  select distinct public.media_path_from_url(leaf #>> '{}')
  from jsonb_path_query(value, 'strict $.** ? (@.type() == "string")') as leaf
  where public.media_path_from_url(leaf #>> '{}') is not null
$$;

create or replace function public.reject_retired_media_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.media_paths_in_json(to_jsonb(new) -> TG_ARGV[0]) p
    join public.media_retired_paths r on r.path = p
  ) then raise exception '图片路径已进入删除保护，请重新上传图片后保存'; end if;
  return new;
end $$;

-- Every source of references must participate, including order snapshots and
-- writes made by other RPCs. The mutex is acquired before any rows are changed.
do $$
declare t text; col text;
begin
  foreach t in array array['products','product_variants','shop_settings','orders'] loop
    col := case t when 'shop_settings' then 'content' when 'orders' then 'items' else 'image' end;
    execute format('drop trigger if exists media_reference_lock on public.%I',t);
    execute format('create trigger media_reference_lock before insert or update on public.%I for each statement execute function public.media_reference_write_lock()',t);
    execute format('drop trigger if exists media_reference_guard on public.%I',t);
    -- Validate the final row, including changes made by other BEFORE triggers.
    execute format('create trigger media_reference_guard after insert or update on public.%I for each row execute function public.reject_retired_media_reference(%L)',t,col);
  end loop;
end $$;

create or replace function public.reject_retired_storage_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.bucket_id <> 'storefront-images' then return new; end if;
  if current_setting('transaction_isolation') <> 'read committed' then raise exception '媒体写入需要 READ COMMITTED 事务'; end if;
  perform pg_advisory_xact_lock(724617001::bigint);
  if new.bucket_id = 'storefront-images' and exists(select 1 from public.media_retired_paths where path = new.name) then
    raise exception '已退役的图片路径不能覆盖或重新上传，请使用新路径';
  end if;
  return new;
end $$;
drop trigger if exists media_storage_write_lock on storage.objects;
drop trigger if exists media_storage_write_guard on storage.objects;
create trigger media_storage_write_guard after insert or update on storage.objects
for each row execute function public.reject_retired_storage_write();

create or replace function public.reserve_orphan_media(p_paths text[])
returns text[] language plpgsql security definer set search_path = '' as $$
declare p text; refs text[]; reserved text[] := '{}'; inserted text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then raise exception '媒体删除需要 READ COMMITTED 事务'; end if;
  if p_paths is null or cardinality(p_paths) < 1 or cardinality(p_paths) > 100 then raise exception '删除批次无效'; end if;
  perform pg_advisory_xact_lock(724617001::bigint);
  -- These reads occur AFTER taking the same mutex as all reference writers.
  select coalesce(array_agg(distinct paths.p),'{}'::text[]) into refs from (
    select to_jsonb(image) v from public.products union all
    select to_jsonb(image) from public.product_variants union all
    select content from public.shop_settings union all
    select items from public.orders
  ) source cross join lateral public.media_paths_in_json(source.v) paths(p);
  foreach p in array p_paths loop
    if p is null or length(p) > 1024 or p = '' or p <> trim(both '/' from p) or p ~ '(^|/)(\.|\.\.)(/|$)|//|[[:cntrl:]]' or position(chr(92) in p)>0 then
      raise exception '媒体路径无效';
    end if;
    if p = any(refs) or p = any(array['.keep','hero-snack-illustration-v1.webp','footer-composite-v1.webp','footer-snack-illustration-v1.webp']) or p like 'defaults/%' then continue; end if;
    inserted := null;
    insert into public.media_retired_paths(path) values(p) on conflict do nothing returning path into inserted;
    if inserted is not null then reserved := array_append(reserved,inserted); end if;
  end loop;
  return reserved;
end $$;
revoke all on function public.reserve_orphan_media(text[]) from public,anon,authenticated;
grant execute on function public.reserve_orphan_media(text[]) to service_role;
revoke all on function public.media_reference_write_lock(),public.reject_retired_media_reference(),public.reject_retired_storage_write(),public.media_path_from_url(text),public.media_paths_in_json(jsonb) from public,anon,authenticated;
commit;
