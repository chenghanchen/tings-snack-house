-- Apply after account-referral-six-digit-migration.sql. No historical orders are rewritten.
begin;
lock table public.orders,public.referral_events in share row exclusive mode;

create or replace function public.referral_normalize_email(value text) returns text
language sql immutable set search_path='' as $$
  select lower(regexp_replace(coalesce(value,''),'^[[:space:]]+|[[:space:]]+$','','g'))
$$;
create or replace function public.referral_normalize_phone(value text) returns text
language plpgsql immutable set search_path='' as $$
declare digits text;
begin
  value:=regexp_replace(coalesce(value,''),'^[[:space:]]+|[[:space:]]+$','','g');
  if value !~ '^[+]?[0-9()[:space:].-]+$' then return null; end if;
  digits:=regexp_replace(value,'[^0-9]','','g');
  if left(value,1)='+' and not (length(digits)=11 and left(digits,1)='1') then return null; end if;
  if length(digits)=11 and left(digits,1)='1' then digits:=substr(digits,2); end if;
  if length(digits)<>10 then return null; end if;
  return digits;
end $$;
revoke all on function public.referral_normalize_email(text),public.referral_normalize_phone(text) from public,anon,authenticated,service_role;

-- Completion is permanent even if an order is later refunded, cancelled or edited.
-- No FK cascade: historical identity evidence must not disappear with an account/order.
-- Email aliases (+tags/dots) are intentionally NOT merged.
create table if not exists public.customer_completed_identities(
  order_id uuid not null,
  identity_kind text not null check(identity_kind in ('account','email','phone')),
  identity_key text not null,
  primary key(order_id,identity_kind,identity_key)
);
create index if not exists customer_completed_identity_lookup
  on public.customer_completed_identities(identity_kind,identity_key);
alter table public.customer_completed_identities enable row level security;
revoke all on public.customer_completed_identities from public,anon,authenticated,service_role;

create or replace function public.remember_completed_customer(p_order uuid,p_user uuid,p_email text,p_phone text) returns void
language sql security definer set search_path='' as $$
  insert into public.customer_completed_identities(order_id,identity_kind,identity_key)
  select p_order,kind,key from (values
    ('account',p_user::text),
    ('email',case when public.referral_normalize_email(p_email)<>'' then md5(public.referral_normalize_email(p_email)) end),
    ('phone',public.referral_normalize_phone(p_phone))
  ) as identities(kind,key) where key is not null
  on conflict do nothing
$$;
revoke all on function public.remember_completed_customer(uuid,uuid,text,text) from public,anon,authenticated,service_role;

create or replace function public.capture_completed_customer() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='UPDATE' then
    if OLD.status in ('已完成','已取货','已配送') then
      perform public.remember_completed_customer(OLD.id,OLD.user_id,OLD.email,OLD.phone);
    end if;
  end if;
  if NEW.status in ('已完成','已取货','已配送') then
    perform public.remember_completed_customer(NEW.id,NEW.user_id,NEW.email,NEW.phone);
    insert into public.customer_completed_identities(order_id,identity_kind,identity_key)
    select e.referred_order_id,i.kind,i.key from public.referral_events e
    cross join lateral (values ('account',e.referred_user_id::text),('email',e.referred_email_key),
      ('phone',public.referral_normalize_phone(e.contact_phone))) i(kind,key)
    where e.referred_order_id=NEW.id and nullif(i.key,'') is not null on conflict do nothing;
  end if;
  return NEW;
end $$;
revoke all on function public.capture_completed_customer() from public,anon,authenticated,service_role;
drop trigger if exists order_customer_completed_identity on public.orders;
create trigger order_customer_completed_identity after insert or update on public.orders
  for each row execute function public.capture_completed_customer();

select public.remember_completed_customer(o.id,o.user_id,o.email,o.phone)
from public.orders o where o.status in ('已完成','已取货','已配送')
  or exists(select 1 from public.referral_events e where e.referred_order_id=o.id and e.status in ('rewarded','revoked'));
-- Keep the event's original identities too, in case an order contact was edited later.
insert into public.customer_completed_identities(order_id,identity_kind,identity_key)
select e.referred_order_id,i.kind,i.key from public.referral_events e
cross join lateral (values ('account',e.referred_user_id::text),('email',e.referred_email_key),
  ('phone',public.referral_normalize_phone(e.contact_phone))) i(kind,key)
where (e.status in ('rewarded','revoked') or exists(select 1 from public.orders o
  where o.id=e.referred_order_id and o.status in ('已完成','已取货','已配送')))
  and nullif(i.key,'') is not null on conflict do nothing;

create or replace function public.account_referral_eligible(p_referrer uuid,p_user uuid,p_email text,p_phone text,p_exclude_order uuid default null) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare email_value text:=public.referral_normalize_email(p_email);
  phone_value text:=public.referral_normalize_phone(p_phone);
begin
  if p_user is not null then
    select public.referral_normalize_email(email) into email_value from auth.users where id=p_user and email_confirmed_at is not null;
  end if;
  if phone_value is null or coalesce(email_value,'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(email_value)>254 then return false; end if;
  if p_referrer=p_user or exists(select 1 from auth.users where id=p_referrer and public.referral_normalize_email(email)=email_value) then return false; end if;
  if exists(select 1 from public.customer_profiles where user_id=p_referrer and public.referral_normalize_phone(phone)=phone_value) then return false; end if;
  if exists(select 1 from public.customer_completed_identities i where i.order_id is distinct from p_exclude_order and (
    (i.identity_kind='account' and i.identity_key=p_user::text) or
    (i.identity_kind='email' and i.identity_key=md5(email_value)) or
    (i.identity_kind='phone' and i.identity_key=phone_value))) then return false; end if;
  if exists(select 1 from public.orders o where o.id is distinct from p_exclude_order
    and ((p_user is not null and o.user_id=p_user) or public.referral_normalize_email(o.email)=email_value or public.referral_normalize_phone(o.phone)=phone_value)
    and (o.status in ('已完成','已取货','已配送') or (o.status<>'已取消' and (
      o.promotion_snapshot->>'code_kind'='referral' or exists(
        select 1 from public.coupon_redemptions d join public.marketing_coupons c on c.id=d.coupon_id
        where d.order_id=o.id and c.customer_scope='new'))))) then return false; end if;
  if exists(select 1 from public.referral_events e where e.referred_order_id is distinct from p_exclude_order and e.status in ('pending','rewarded','revoked')
    and ((p_user is not null and e.referred_user_id=p_user) or e.referred_email_key=md5(email_value)
      or public.referral_normalize_phone(e.contact_phone)=phone_value)) then return false; end if;
  return true;
end $$;
revoke all on function public.account_referral_eligible(uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;

-- Normalize BEFORE identity locks, validation, idempotency and event insertion.
-- Preserve the verified Auth UUID/email authority in the existing checkout wrapper.
do $upgrade$
declare definition text;
begin
  select pg_get_functiondef('public.submit_shop_order_account(text,text,text,text,text,text,jsonb,uuid,uuid,uuid,text,text,uuid[])'::regprocedure) into definition;
  if position('p_phone:=public.referral_normalize_phone(p_phone)' in definition)=0 then
    if position('email_value text:=lower(btrim(coalesce(p_email,'''')))' in definition)=0
      or position('select lower(btrim(email)) into email_value' in definition)=0
      or position('if p_idempotency_key is null then' in definition)=0 then
      raise exception 'Unknown account checkout engine; lifetime migration rolled back';
    end if;
    definition:=replace(definition,'email_value text:=lower(btrim(coalesce(p_email,'''')))','email_value text:=public.referral_normalize_email(p_email)');
    definition:=replace(definition,'select lower(btrim(email)) into email_value','select public.referral_normalize_email(email) into email_value');
    definition:=replace(definition,'if p_idempotency_key is null then',
      'p_phone:=public.referral_normalize_phone(p_phone); if p_phone is null then raise exception ''请输入 10 位数字电话号码''; end if; if p_idempotency_key is null then');
    execute definition;
  end if;
end $upgrade$;
notify pgrst,'reload schema';
commit;
