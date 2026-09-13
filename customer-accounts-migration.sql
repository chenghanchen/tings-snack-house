-- Apply AFTER order-submission-lockdown-migration.sql and cancellation v2.
-- Transactional: an unexpected owner function or missing owner aborts everything.
begin;

create table if not exists public.shop_account_owners (
  user_id uuid primary key references auth.users(id)
);
alter table public.shop_account_owners enable row level security;
revoke all on public.shop_account_owners from public, anon, authenticated;
insert into public.shop_account_owners(user_id)
select id from auth.users where lower(email) = 'chenghanchen1@gmail.com'
  and email_confirmed_at is not null on conflict do nothing;
do $$ begin
  if not exists (select 1 from public.shop_account_owners) then
    raise exception 'Verified shop owner missing. Configure the owner before enabling accounts.';
  end if;
end $$;

create or replace function public.is_shop_account_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.shop_account_owners where user_id = auth.uid());
$$;
revoke all on function public.is_shop_account_owner() from public;
grant execute on function public.is_shop_account_owner() to anon, authenticated;

alter table public.orders add column if not exists user_id uuid references auth.users(id);
-- No ON DELETE SET NULL: deleting an auth user must not expose their orders as guest orders.
create index if not exists orders_customer_created_idx on public.orders(user_id, created_at desc, id desc)
  where user_id is not null;

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  phone text not null default '' check (phone = '' or phone ~ '^[0-9]{10}$'),
  updated_at timestamptz not null default now()
);
create table if not exists public.customer_addresses (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null default '' check (char_length(address) <= 500),
  updated_at timestamptz not null default now()
);
alter table public.customer_profiles enable row level security;
alter table public.customer_addresses enable row level security;
revoke all on public.customer_profiles, public.customer_addresses from public, anon, authenticated;
grant select on public.customer_profiles, public.customer_addresses to authenticated;
drop policy if exists customer_reads_own_profile on public.customer_profiles;
create policy customer_reads_own_profile on public.customer_profiles for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists customer_reads_own_address on public.customer_addresses;
create policy customer_reads_own_address on public.customer_addresses for select to authenticated
  using (user_id = (select auth.uid()));

-- Add restrictive owner guards alongside existing policies. New customers are
-- authenticated too; permissive legacy policies must not grant them store writes.
do $$ declare t text; operation text; begin
  foreach t in array array['orders','products','categories','shop_settings','settings',
    'product_option_groups','product_option_values','product_variants','marketing_campaigns',
    'marketing_coupons','coupon_redemptions','customer_referrals','referral_reward_settings'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    foreach operation in array array['insert','update','delete'] loop
      execute format('drop policy if exists %I on public.%I', 'account_owner_' || operation, t);
      execute format('create policy %I on public.%I as restrictive for %s to anon, authenticated %s',
        'account_owner_' || operation, t, operation,
        case operation when 'insert' then 'with check (public.is_shop_account_owner())'
        when 'delete' then 'using (public.is_shop_account_owner())'
        else 'using (public.is_shop_account_owner()) with check (public.is_shop_account_owner())' end);
    end loop;
    if t in ('orders','marketing_coupons','coupon_redemptions','customer_referrals','referral_reward_settings') then
      execute format('drop policy if exists account_owner_read on public.%I', t);
      execute format('create policy account_owner_read on public.%I as restrictive for select to anon, authenticated using (public.is_shop_account_owner())', t);
    end if;
  end loop;
end $$;

-- Fail closed if an owner RPC has an unfamiliar guard; never silently leave it exposed.
do $$ declare f record; definition text; guarded text; begin
  for f in select p.oid, p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'owner\_%' escape '\' loop
    definition := pg_get_functiondef(f.oid);
    guarded := regexp_replace(definition,
      '\(auth\.jwt\(\)\s*->>\s*''email''\)\s*<>\s*''chenghanchen1@gmail.com''',
      'public.is_shop_account_owner() is not true', 'g');
    if guarded = definition and position('public.is_shop_account_owner() is not true' in definition)=0 then
      raise exception 'Review owner RPC before enabling accounts: %', f.signature;
    end if;
    execute guarded;
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to authenticated', f.signature);
  end loop;
end $$;

create or replace function public.get_my_customer_details() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  return jsonb_build_object(
    'full_name', coalesce((select full_name from public.customer_profiles where user_id=auth.uid()),''),
    'phone', coalesce((select phone from public.customer_profiles where user_id=auth.uid()),''),
    'address', coalesce((select address from public.customer_addresses where user_id=auth.uid()),''));
end $$;

create or replace function public.save_my_customer_details(p_full_name text, p_phone text, p_address text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if char_length(trim(coalesce(p_full_name,''))) > 80
    or (trim(coalesce(p_phone,'')) <> '' and trim(p_phone) !~ '^[0-9]{10}$')
    or char_length(trim(coalesce(p_address,''))) > 500 then raise exception '收货资料格式不正确'; end if;
  insert into public.customer_profiles(user_id,full_name,phone) values
    (auth.uid(),trim(coalesce(p_full_name,'')),trim(coalesce(p_phone,'')))
    on conflict(user_id) do update set full_name=excluded.full_name,phone=excluded.phone,updated_at=now();
  insert into public.customer_addresses(user_id,address) values(auth.uid(),trim(coalesce(p_address,'')))
    on conflict(user_id) do update set address=excluded.address,updated_at=now();
  return public.get_my_customer_details();
end $$;

create or replace function public.get_my_customer_orders(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 then raise exception '页码无效'; end if;
  return coalesce((select jsonb_agg(to_jsonb(o)) from (
    select id,order_number,created_at,status,fulfillment,address,items,subtotal,
      discount_amount,tax_amount,delivery_fee,total_amount,cancellation_requested,cancellation_rejected_at
    from public.orders where user_id=auth.uid() order by created_at desc,id desc limit 20 offset p_offset
  ) o), '[]'::jsonb);
end $$;

create or replace function public.request_my_order_cancellation(p_order_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if char_length(trim(coalesce(p_reason,''))) not between 1 and 100 then raise exception '请填写 1–100 字取消原因'; end if;
  update public.orders set cancellation_requested=true,cancellation_requested_at=now(),
    cancellation_reason=trim(p_reason),cancellation_stage=status,
    cancellation_rejected_at=null,cancellation_rejected_stage=null
    where id=p_order_id and user_id=auth.uid() and status in ('待确认','已确认')
      and coalesce(cancellation_requested,false)=false;
  get diagnostics changed=row_count;
  return changed=1;
end $$;

revoke all on function public.get_my_customer_details(),
  public.save_my_customer_details(text,text,text), public.get_my_customer_orders(integer),
  public.request_my_order_cancellation(uuid,text) from public, anon, authenticated;
grant execute on function public.get_my_customer_details(),
  public.save_my_customer_details(text,text,text), public.get_my_customer_orders(integer),
  public.request_my_order_cancellation(uuid,text) to authenticated;

-- Guest order lookup cannot disclose account orders, even with a known order number/phone.
create or replace function public.lookup_customer_orders(p_query text) returns setof public.orders
language sql security definer set search_path = '' as $$
  select * from public.orders where user_id is null and case
    when trim(coalesce(p_query,'')) ~ '^[0-9]{10}$' then phone=trim(p_query)
    else order_number=upper(trim(p_query)) end order by created_at desc;
$$;
create or replace function public.lookup_customer_order_v2(p_order_number text,p_phone text)
returns setof public.orders language sql security definer set search_path = '' as $$
  select * from public.orders where user_id is null
    and (nullif(trim(p_order_number),'') is not null or nullif(trim(p_phone),'') is not null)
    and (nullif(trim(p_order_number),'') is null or order_number=upper(trim(p_order_number)))
    and (nullif(trim(p_phone),'') is null or phone=trim(p_phone)) order by created_at desc;
$$;
create or replace function public.request_order_cancellation_v2(p_order_number text,p_phone text,p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if trim(coalesce(p_phone,'')) !~ '^[0-9]{10}$' then raise exception '请输入 10 位手机号码'; end if;
  if char_length(trim(coalesce(p_reason,''))) not between 1 and 100 then raise exception '请填写 1–100 字取消原因'; end if;
  update public.orders set cancellation_requested=true,cancellation_requested_at=now(),
    cancellation_reason=trim(p_reason),cancellation_stage=status,
    cancellation_rejected_at=null,cancellation_rejected_stage=null
    where user_id is null and order_number=upper(trim(p_order_number)) and phone=trim(p_phone)
      and status in ('待确认','已确认') and coalesce(cancellation_requested,false)=false;
  get diagnostics changed=row_count; return changed=1;
end $$;
create or replace function public.request_order_cancellation(p_order_number text,p_phone text)
returns boolean language sql security definer set search_path = '' as $$
  select public.request_order_cancellation_v2(p_order_number,p_phone,'顾客申请取消');
$$;
revoke all on function public.lookup_customer_orders(text),public.lookup_customer_order_v2(text,text),
  public.request_order_cancellation_v2(text,text,text),public.request_order_cancellation(text,text) from public;
grant execute on function public.lookup_customer_orders(text),public.lookup_customer_order_v2(text,text),
  public.request_order_cancellation_v2(text,text,text),public.request_order_cancellation(text,text) to anon,authenticated;

-- Retire legacy lookup/cancel endpoints found in the live preflight audit.
-- The current storefront uses request_order_cancellation_v2, not the old
-- cancel_customer_order endpoint. Preserve its definition but remove public access.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname in ('lookup_customer_order','cancel_customer_order') or p.proname in
      ('submit_shop_order','submit_shop_order_with_referral_rewards','submit_shop_order_idempotent')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;

create or replace function public.submit_shop_order_account(
  p_customer_name text,p_phone text,p_email text,p_fulfillment text,p_address text,p_note text,
  p_items jsonb,p_idempotency_key uuid,p_user_id uuid default null,p_promotion_id uuid default null,
  p_coupon_code text default null,p_referral_value text default null,p_excluded_campaign_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare prior_user uuid; result jsonb;
begin
  if p_idempotency_key is null then raise exception '缺少订单幂等键'; end if;
  if p_user_id is not null and not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null)
    then raise exception '请先验证邮箱'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,29));
  select o.user_id into prior_user from public.order_submission_idempotency i
    join public.orders o on o.id=i.order_id where i.idempotency_key=p_idempotency_key;
  if found and prior_user is distinct from p_user_id then
    raise exception '下单账户已改变，请关闭并重新打开结算窗口';
  end if;
  result := public.submit_shop_order_idempotent(p_customer_name,p_phone,p_email,p_fulfillment,
    p_address,p_note,p_items,p_idempotency_key,p_promotion_id,p_coupon_code,p_referral_value,p_excluded_campaign_ids);
  update public.orders set user_id=p_user_id where id=(result->>'id')::uuid;
  return result;
end $$;
revoke all on function public.submit_shop_order_account(text,text,text,text,text,text,jsonb,uuid,uuid,uuid,text,text,uuid[])
  from public,anon,authenticated;
grant execute on function public.submit_shop_order_account(text,text,text,text,text,text,jsonb,uuid,uuid,uuid,text,text,uuid[])
  to service_role;
commit;
