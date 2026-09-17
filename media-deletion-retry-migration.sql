-- Incremental retry fix; apply only after media-deletion-guard-migration.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
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
    -- A fence alone is not deletion eligibility. An absent object is complete;
    -- only a still-present object may retry after the locked checks above.
    -- Never reset/remove the fence: delayed or concurrent DELETEs cannot hit
    -- a replacement, because all reference/Storage writers remain fenced.
    if inserted is null and not (p = any(reserved)) and exists (
      select 1 from storage.objects where bucket_id = 'storefront-images' and name = p
    ) then reserved := array_append(reserved,p); end if;
  end loop;
  return reserved;
end $$;
revoke all on function public.reserve_orphan_media(text[]) from public,anon,authenticated;
grant execute on function public.reserve_orphan_media(text[]) to service_role;
commit;
