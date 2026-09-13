-- Email-account referrals. Replaces the UNDEPLOYED manual-phone wallet draft.
-- Apply after customer accounts and address v2. Existing phone-linked data is not claimed.
begin;
do $$ begin
  if to_regclass('public.customer_phone_requests') is not null then
    raise exception 'Manual-phone wallet already installed: review existing claims before this migration';
  end if;
end $$;
alter table public.customer_referrals
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists referrer_user_id uuid references auth.users(id);
alter table public.customer_referrals drop constraint if exists customer_referrals_pkey;
alter table public.customer_referrals alter column phone drop not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.customer_referrals'::regclass and contype='p') then
    alter table public.customer_referrals add primary key(id);
  end if;
end $$;
create unique index if not exists customer_referral_user on public.customer_referrals(referrer_user_id) where referrer_user_id is not null;
create unique index if not exists customer_referral_legacy_phone on public.customer_referrals(phone) where phone is not null;

alter table public.marketing_coupons
  add column if not exists claimed_by_user_id uuid references auth.users(id),
  add column if not exists claimed_at timestamptz,
  add column if not exists source text not null default 'marketing',
  add column if not exists discount_kind text not null default 'fixed' check(discount_kind in ('fixed','percent')),
  add column if not exists customer_scope text not null default 'all',
  add column if not exists status text not null default 'published';
alter table public.coupon_redemptions add column if not exists user_id uuid references auth.users(id);
create index if not exists coupons_claimed_user on public.marketing_coupons(claimed_by_user_id);
create index if not exists redemptions_customer on public.coupon_redemptions(coupon_id,user_id);
create table if not exists public.referral_events (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id),
  referred_order_id uuid not null unique references public.orders(id),
  referred_user_id uuid references auth.users(id),
  referred_email_key text not null,
  contact_phone text not null,
  status text not null default 'pending' check(status in ('pending','rewarded','cancelled','revoked','ineligible')),
  reward_coupon_id uuid unique references public.marketing_coupons(id),
  reward_amount numeric not null default 5 check(reward_amount=5),
  reward_min_spend numeric not null default 30 check(reward_min_spend=30),
  reward_valid_days integer not null default 90 check(reward_valid_days=90),
  created_at timestamptz not null default now(), rewarded_at timestamptz,
  check(referrer_user_id is distinct from referred_user_id)
);
create unique index if not exists referral_once_email on public.referral_events(referred_email_key) where status in ('pending','rewarded','revoked');
create unique index if not exists referral_once_user on public.referral_events(referred_user_id) where referred_user_id is not null and status in ('pending','rewarded','revoked');
-- Conservative contact-based abuse signal, never an ownership or claim lookup.
create unique index if not exists referral_once_contact on public.referral_events(contact_phone) where status in ('pending','rewarded','revoked');
alter table public.referral_events enable row level security;
revoke all on public.referral_events from public,anon,authenticated;
grant select on public.referral_events to authenticated;
drop policy if exists owner_reads_referral_events on public.referral_events;
create policy owner_reads_referral_events on public.referral_events for select to authenticated using(public.is_shop_account_owner());

create or replace function public.keep_account_reward_owner() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_TABLE_NAME='marketing_coupons' then
    if OLD.claimed_by_user_id is not null and (NEW.claimed_by_user_id is distinct from OLD.claimed_by_user_id or NEW.source is distinct from OLD.source) then
      raise exception '账户奖励不可转让';
    end if;
  elsif OLD.referrer_user_id is not null and (NEW.referrer_user_id is distinct from OLD.referrer_user_id or NEW.referral_code is distinct from OLD.referral_code) then
    raise exception '账户推荐码不可转让或更换';
  end if;
  return NEW;
end $$;
revoke all on function public.keep_account_reward_owner() from public,anon,authenticated;
drop trigger if exists preserve_coupon_owner on public.marketing_coupons;
create trigger preserve_coupon_owner before update on public.marketing_coupons for each row execute function public.keep_account_reward_owner();
drop trigger if exists preserve_referrer_owner on public.customer_referrals;
create trigger preserve_referrer_owner before update on public.customer_referrals for each row execute function public.keep_account_reward_owner();

create or replace function public.ensure_account_referral(p_user_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare code text;
begin
  if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then return null; end if;
  insert into public.customer_referrals(referrer_user_id,referral_code,referral_amount,referral_min_spend,referral_valid_days,referral_max_uses)
    values(p_user_id,'TSHREF-'||upper(replace(gen_random_uuid()::text,'-','')),5,30,0,0)
    on conflict(referrer_user_id) where referrer_user_id is not null do nothing;
  select referral_code into code from public.customer_referrals where referrer_user_id=p_user_id;
  return code;
end $$;
revoke all on function public.ensure_account_referral(uuid) from public,anon,authenticated;
create or replace function public.on_verified_referral_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if NEW.email_confirmed_at is not null then perform public.ensure_account_referral(NEW.id); end if;
  return NEW;
end $$;
revoke all on function public.on_verified_referral_account() from public,anon,authenticated;
drop trigger if exists create_verified_account_referral on auth.users;
create trigger create_verified_account_referral after insert or update of email_confirmed_at on auth.users for each row execute function public.on_verified_referral_account();
select public.ensure_account_referral(id) from auth.users where email_confirmed_at is not null;

-- Private eligibility check: account identity comes from Auth, never supplied email.
create or replace function public.account_referral_eligible(p_referrer uuid,p_user uuid,p_email text,p_phone text,p_exclude_order uuid default null) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare email_value text:=lower(btrim(coalesce(p_email,'')));
begin
  if p_user is not null then select lower(btrim(email)) into email_value from auth.users where id=p_user and email_confirmed_at is not null; end if;
  if coalesce(email_value,'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(email_value)>254 then return false; end if;
  if p_referrer=p_user or exists(select 1 from auth.users where id=p_referrer and lower(btrim(email))=email_value) then return false; end if;
  if p_user is null and exists(select 1 from public.customer_profiles where user_id=p_referrer and phone=p_phone and phone<>'') then return false; end if;
  if exists(select 1 from public.orders o where o.id is distinct from p_exclude_order and o.status<>'已取消'
    and ((p_user is not null and o.user_id=p_user) or lower(btrim(o.email))=email_value or o.phone=p_phone)
    and (o.promotion_snapshot->>'code_kind'='referral' or exists(
      select 1 from public.coupon_redemptions d join public.marketing_coupons c on c.id=d.coupon_id
      where d.order_id=o.id and c.customer_scope='new'))) then return false; end if;
  if exists(select 1 from public.orders o where o.id is distinct from p_exclude_order and o.status in ('已完成','已取货','已配送')
    and ((p_user is not null and o.user_id=p_user) or lower(btrim(o.email))=email_value or o.phone=p_phone)) then return false; end if;
  if exists(select 1 from public.referral_events e where e.referred_order_id is distinct from p_exclude_order and e.status in ('pending','rewarded','revoked')
    and ((p_user is not null and e.referred_user_id=p_user) or e.referred_email_key=md5(email_value) or e.contact_phone=p_phone)) then return false; end if;
  return true;
end $$;
revoke all on function public.account_referral_eligible(uuid,uuid,text,text,uuid) from public,anon,authenticated;

create or replace function public.customer_coupon_allowed(p_coupon_id uuid,p_user_id uuid,p_phone text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare c public.marketing_coupons%rowtype; email_value text;
begin
  select * into c from public.marketing_coupons where id=p_coupon_id;
  if not found or not c.active or coalesce(c.status,'published')<>'published' or c.starts_at>now() or c.ends_at<now() or (c.discount_kind='percent' and c.amount>100) then return false; end if;
  if c.claimed_by_user_id is not null then
    if p_user_id is distinct from c.claimed_by_user_id then return false; end if;
  elsif c.source='referral' or c.is_referral_reward or nullif(c.recipient_phone,'') is not null then return false;
  end if;
  select lower(btrim(email)) into email_value from auth.users where id=p_user_id and email_confirmed_at is not null;
  if c.customer_scope='new' and (p_user_id is null or exists(select 1 from public.orders where status in ('已完成','已取货','已配送')
    and (user_id=p_user_id or lower(btrim(email))=email_value or phone=p_phone))) then return false; end if;
  if (select count(*) from public.coupon_redemptions where coupon_id=c.id)>=c.total_quantity then return false; end if;
  return (select count(*) from public.coupon_redemptions where coupon_id=c.id and
    ((p_user_id is not null and user_id=p_user_id) or phone=p_phone or c.claimed_by_user_id is not null))<c.per_phone_limit;
end $$;
revoke all on function public.customer_coupon_allowed(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.stamp_coupon_customer() returns trigger
language plpgsql security definer set search_path='' as $$
begin NEW.user_id:=nullif(current_setting('tings.checkout_user_id',true),'')::uuid; return NEW; end $$;
revoke all on function public.stamp_coupon_customer() from public,anon,authenticated;
drop trigger if exists coupon_customer_redemption on public.coupon_redemptions;
create trigger coupon_customer_redemption before insert on public.coupon_redemptions for each row execute function public.stamp_coupon_customer();

create or replace function public.settle_account_referral() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.referral_events%rowtype; coupon_id uuid;
begin
  select * into e from public.referral_events where referred_order_id=NEW.id for update;
  if not found then return NEW; end if;
  if NEW.status='已取消' then
    if e.reward_coupon_id is not null then
      update public.marketing_coupons set active=false,status='stopped' where id=e.reward_coupon_id;
      update public.referral_events set status='revoked' where id=e.id;
    else update public.referral_events set status='cancelled' where id=e.id; end if;
  elsif NEW.status in ('已完成','已取货','已配送') and e.status='pending' then
    if coalesce(NEW.cancellation_requested,false) then return NEW; end if;
    if not public.account_referral_eligible(e.referrer_user_id,e.referred_user_id,NEW.email,NEW.phone,NEW.id) then
      update public.referral_events set status='ineligible' where id=e.id; return NEW;
    end if;
    insert into public.marketing_coupons(code,name,amount,min_spend,total_quantity,per_phone_limit,
      claimed_by_user_id,claimed_at,source,is_referral_reward,ends_at,allow_campaign_stack)
      values('RWD-'||upper(replace(e.id::text,'-','')),'推荐奖励券',e.reward_amount,e.reward_min_spend,1,1,
        e.referrer_user_id,now(),'referral',true,now()+make_interval(days=>e.reward_valid_days),true) returning id into coupon_id;
    update public.referral_events set status='rewarded',reward_coupon_id=coupon_id,rewarded_at=now() where id=e.id;
  end if;
  return NEW;
end $$;
revoke all on function public.settle_account_referral() from public,anon,authenticated;
drop trigger if exists order_account_referral_settlement on public.orders;
create trigger order_account_referral_settlement after update of status,cancellation_requested on public.orders
  for each row when(OLD.status is distinct from NEW.status or OLD.cancellation_requested is distinct from NEW.cancellation_requested) execute function public.settle_account_referral();

create or replace function public.preview_account_offer(p_code text,p_email text,p_phone text,p_subtotal numeric,p_campaign_discount numeric default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.marketing_coupons%rowtype; r uuid; discount numeric;
begin
  select referrer_user_id into r from public.customer_referrals where referral_code=upper(btrim(p_code)) and referrer_user_id is not null;
  if found then
    if coalesce(p_subtotal,0)<30 or not public.account_referral_eligible(r,auth.uid(),p_email,p_phone) then return jsonb_build_object('valid',false,'discount',0); end if;
    return jsonb_build_object('valid',true,'is_referral',true,'discount',least(5,greatest(p_subtotal-coalesce(p_campaign_discount,0),0)),'name','推荐新客优惠','allow_campaign_stack',true);
  end if;
  select * into c from public.marketing_coupons where code=upper(btrim(p_code));
  if not found or not public.customer_coupon_allowed(c.id,auth.uid(),p_phone) or coalesce(p_subtotal,0)<c.min_spend then
    return jsonb_build_object('valid',false,'discount',0); end if;
  discount:=least(case when c.discount_kind='percent' then round(p_subtotal*c.amount/100,2) else c.amount end,greatest(p_subtotal-coalesce(p_campaign_discount,0),0));
  return jsonb_build_object('valid',true,'is_referral',false,'discount',discount,'name',c.name,'allow_campaign_stack',c.allow_campaign_stack);
end $$;
revoke all on function public.preview_account_offer(text,text,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.preview_account_offer(text,text,text,numeric,numeric) to anon,authenticated;

create or replace function public.get_my_customer_wallet() returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); coupons jsonb; history jsonb; code text;
begin
  if uid is null then raise exception '请先登录'; end if;
  code:=public.ensure_account_referral(uid);
  if code is null then raise exception '请先验证邮箱'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'code',c.code,'name',c.name,'amount',c.amount,'discount_kind',c.discount_kind,'min_spend',c.min_spend,
    'starts_at',c.starts_at,'ends_at',c.ends_at,'kind',case when c.source='referral' then 'referral' when c.customer_scope='new' then 'new' else 'regular' end,
    'allow_campaign_stack',c.allow_campaign_stack,
    'status',case when exists(select 1 from public.coupon_redemptions d where d.coupon_id=c.id and d.user_id=uid) and not public.customer_coupon_allowed(c.id,uid,null) then 'used'
      when c.ends_at<now() then 'expired' when public.customer_coupon_allowed(c.id,uid,null) then 'available' else 'unavailable' end,
    'uses',coalesce((select jsonb_agg(jsonb_build_object('used_at',d.created_at,'order_number',o.order_number)) from public.coupon_redemptions d join public.orders o on o.id=d.order_id where d.coupon_id=c.id and d.user_id=uid and o.user_id=uid),'[]'::jsonb)
  ) order by c.created_at desc,c.id),'[]'::jsonb) into coupons
  from public.marketing_coupons c where c.claimed_by_user_id=uid or
    (c.claimed_by_user_id is null and nullif(c.recipient_phone,'') is null and not c.is_referral_reward and c.source<>'referral' and c.active and coalesce(c.status,'published')='published');
  select coalesce(jsonb_agg(jsonb_build_object('created_at',created_at,'status',case status when 'pending' then '等待订单完成' when 'rewarded' then '奖励已发放' when 'cancelled' then '订单已取消，未发奖励' when 'revoked' then '订单取消，奖励已撤销' else '未满足奖励条件' end,
    'reward_amount',reward_amount) order by created_at desc),'[]'::jsonb) into history from public.referral_events where referrer_user_id=uid;
  return jsonb_build_object('coupons',coupons,'referral_codes',jsonb_build_array(jsonb_build_object('code',code,'amount',5,'min_spend',30)),'history',history);
end $$;
revoke all on function public.get_my_customer_wallet() from public,anon,authenticated;
grant execute on function public.get_my_customer_wallet() to authenticated;

-- Patch only exact reviewed legacy fragments; unknown pricing code aborts this transaction.
do $upgrade$
declare definition text;
begin
  select pg_get_functiondef('public.submit_shop_order(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[])'::regprocedure) into definition;
  definition:=replace(definition,chr(13),'');
  if position('account-referral-v1' in definition)=0 then
    if position($wallet_part$    select * into referral_owner from public.customer_referrals where referral_code=entered_code;
    if found then
      select count(*) into prior_orders from public.orders where phone=p_phone;
      if prior_orders>0 then raise exception '推荐码仅限新顾客首单使用'; end if;
      select coalesce(referral_owner.referral_amount,s.referral_amount,s.amount),coalesce(referral_owner.referral_min_spend,s.referral_min_spend,s.min_spend),coalesce(referral_owner.referral_valid_days,s.referral_valid_days,s.valid_days),coalesce(referral_owner.referral_max_uses,s.referral_max_uses,0),coalesce(s.reward_amount,s.amount),coalesce(s.reward_min_spend,s.min_spend),coalesce(s.reward_valid_days,s.valid_days)
      into referral_amount,referral_min,referral_days,referral_max_uses,reward_amount,reward_min,reward_days
      from public.referral_reward_settings s where s.id=1;
      if referral_days>0 and referral_owner.created_at+make_interval(days=>referral_days)<=now() then raise exception '推荐码已过期'; end if;
      select count(*) into referral_uses from public.orders where coupon_code=entered_code;
      if referral_max_uses>0 and referral_uses>=referral_max_uses then raise exception '推荐码使用次数已用完'; end if;
      if current_subtotal<referral_min then raise exception '未达到推荐奖励最低消费金额'; end if;
      code_discount:=least(referral_amount,current_subtotal-campaign_discount); selected_code_name:='推荐码奖励'; selected_code_kind:='referral';
$wallet_part$ in definition)=0 or position($wallet_part$  if selected_code_kind='referral' then
    reward_ends_at:=case when reward_days>0 then now()+make_interval(days=>reward_days) else null end;
    update public.orders set referral_source=referral_owner.phone where id=order_id;
    -- 新顾客在本次下单后获得的新推荐码，使用下单当刻的最新默认规则。
    select coalesce(s.referral_amount,s.amount),coalesce(s.referral_min_spend,s.min_spend),coalesce(s.referral_valid_days,s.valid_days),coalesce(s.referral_max_uses,0)
    into referral_amount,referral_min,referral_days,referral_max_uses
    from public.referral_reward_settings s where s.id=1;
    insert into public.customer_referrals(phone,referral_code,referred_by_phone,referral_amount,referral_min_spend,referral_valid_days,referral_max_uses) values(p_phone,'TSHREF-'||upper(substr(md5(p_phone||clock_timestamp()::text),1,8)),referral_owner.phone,referral_amount,referral_min,referral_days,referral_max_uses) on conflict(phone) do nothing;
    insert into public.marketing_coupons(code,name,amount,min_spend,total_quantity,per_phone_limit,recipient_phone,is_referral_reward,ends_at)
    values('REF-'||upper(substr(md5(order_id::text||'new'),1,8)),'推荐新客奖励',reward_amount,reward_min,1,1,p_phone,true,reward_ends_at),('REF-'||upper(substr(md5(order_id::text||'old'),1,8)),'推荐新客奖励',reward_amount,reward_min,1,1,referral_owner.phone,true,reward_ends_at);
  else
    select coalesce(s.referral_amount,s.amount),coalesce(s.referral_min_spend,s.min_spend),coalesce(s.referral_valid_days,s.valid_days),coalesce(s.referral_max_uses,0)
    into referral_amount,referral_min,referral_days,referral_max_uses
    from public.referral_reward_settings s where s.id=1;
    insert into public.customer_referrals(phone,referral_code,referral_amount,referral_min_spend,referral_valid_days,referral_max_uses) values(p_phone,'TSHREF-'||upper(substr(md5(p_phone||clock_timestamp()::text),1,8)),referral_amount,referral_min,referral_days,referral_max_uses) on conflict(phone) do nothing;
  end if;
$wallet_part$ in definition)=0
      or position('if coupon.recipient_phone is not null and coupon.recipient_phone<>p_phone then raise exception ''该优惠券不属于此电话号码''; end if;' in definition)=0
      then raise exception 'Unknown order engine: review account-referral upgrade'; end if;
    definition:=replace(definition,$wallet_part$    select * into referral_owner from public.customer_referrals where referral_code=entered_code;
    if found then
      select count(*) into prior_orders from public.orders where phone=p_phone;
      if prior_orders>0 then raise exception '推荐码仅限新顾客首单使用'; end if;
      select coalesce(referral_owner.referral_amount,s.referral_amount,s.amount),coalesce(referral_owner.referral_min_spend,s.referral_min_spend,s.min_spend),coalesce(referral_owner.referral_valid_days,s.referral_valid_days,s.valid_days),coalesce(referral_owner.referral_max_uses,s.referral_max_uses,0),coalesce(s.reward_amount,s.amount),coalesce(s.reward_min_spend,s.min_spend),coalesce(s.reward_valid_days,s.valid_days)
      into referral_amount,referral_min,referral_days,referral_max_uses,reward_amount,reward_min,reward_days
      from public.referral_reward_settings s where s.id=1;
      if referral_days>0 and referral_owner.created_at+make_interval(days=>referral_days)<=now() then raise exception '推荐码已过期'; end if;
      select count(*) into referral_uses from public.orders where coupon_code=entered_code;
      if referral_max_uses>0 and referral_uses>=referral_max_uses then raise exception '推荐码使用次数已用完'; end if;
      if current_subtotal<referral_min then raise exception '未达到推荐奖励最低消费金额'; end if;
      code_discount:=least(referral_amount,current_subtotal-campaign_discount); selected_code_name:='推荐码奖励'; selected_code_kind:='referral';
$wallet_part$,$wallet_part$    -- account-referral-v1: account identity only, no phone-owned referral codes.
    select * into referral_owner from public.customer_referrals where referral_code=entered_code and referrer_user_id is not null;
    if found then
      if not public.account_referral_eligible(referral_owner.referrer_user_id,nullif(current_setting('tings.checkout_user_id',true),'')::uuid,p_email,p_phone)
        then raise exception '推荐优惠仅限符合条件的新客，不能自荐或重复使用；游客请填写邮箱'; end if;
      if current_subtotal<30 then raise exception '推荐优惠需满 $30'; end if;
      code_discount:=least(5,current_subtotal-campaign_discount);
      if code_discount<=0 then raise exception '本单无需使用推荐优惠'; end if;
      selected_code_name:='推荐新客优惠'; selected_code_kind:='referral';
$wallet_part$);
    definition:=replace(definition,$wallet_part$  if selected_code_kind='referral' then
    reward_ends_at:=case when reward_days>0 then now()+make_interval(days=>reward_days) else null end;
    update public.orders set referral_source=referral_owner.phone where id=order_id;
    -- 新顾客在本次下单后获得的新推荐码，使用下单当刻的最新默认规则。
    select coalesce(s.referral_amount,s.amount),coalesce(s.referral_min_spend,s.min_spend),coalesce(s.referral_valid_days,s.valid_days),coalesce(s.referral_max_uses,0)
    into referral_amount,referral_min,referral_days,referral_max_uses
    from public.referral_reward_settings s where s.id=1;
    insert into public.customer_referrals(phone,referral_code,referred_by_phone,referral_amount,referral_min_spend,referral_valid_days,referral_max_uses) values(p_phone,'TSHREF-'||upper(substr(md5(p_phone||clock_timestamp()::text),1,8)),referral_owner.phone,referral_amount,referral_min,referral_days,referral_max_uses) on conflict(phone) do nothing;
    insert into public.marketing_coupons(code,name,amount,min_spend,total_quantity,per_phone_limit,recipient_phone,is_referral_reward,ends_at)
    values('REF-'||upper(substr(md5(order_id::text||'new'),1,8)),'推荐新客奖励',reward_amount,reward_min,1,1,p_phone,true,reward_ends_at),('REF-'||upper(substr(md5(order_id::text||'old'),1,8)),'推荐新客奖励',reward_amount,reward_min,1,1,referral_owner.phone,true,reward_ends_at);
  else
    select coalesce(s.referral_amount,s.amount),coalesce(s.referral_min_spend,s.min_spend),coalesce(s.referral_valid_days,s.valid_days),coalesce(s.referral_max_uses,0)
    into referral_amount,referral_min,referral_days,referral_max_uses
    from public.referral_reward_settings s where s.id=1;
    insert into public.customer_referrals(phone,referral_code,referral_amount,referral_min_spend,referral_valid_days,referral_max_uses) values(p_phone,'TSHREF-'||upper(substr(md5(p_phone||clock_timestamp()::text),1,8)),referral_amount,referral_min,referral_days,referral_max_uses) on conflict(phone) do nothing;
  end if;
$wallet_part$,$wallet_part$  if selected_code_kind='referral' then
    insert into public.referral_events(referrer_user_id,referred_order_id,referred_user_id,referred_email_key,contact_phone)
      values(referral_owner.referrer_user_id,order_id,nullif(current_setting('tings.checkout_user_id',true),'')::uuid,md5(lower(btrim(p_email))),p_phone);
  end if;
$wallet_part$);
    definition:=replace(definition,'if coupon.recipient_phone is not null and coupon.recipient_phone<>p_phone then raise exception ''该优惠券不属于此电话号码''; end if;',
      'if not public.customer_coupon_allowed(coupon.id,nullif(current_setting(''tings.checkout_user_id'',true),'''')::uuid,p_phone) then raise exception ''优惠券不属于此账户、已使用或暂不可用''; end if;');
    definition:=replace(definition,'code_discount:=least(coupon.amount,current_subtotal-campaign_discount);',
      'code_discount:=least(case when coupon.discount_kind=''percent'' then round(current_subtotal*coupon.amount/100,2) else coupon.amount end,current_subtotal-campaign_discount);');
    execute definition;
  end if;
end $upgrade$;

-- Remove the old success-page gift issuance/phone lookup entirely.
create or replace function public.submit_shop_order_with_referral_rewards(
  p_customer_name text,p_phone text,p_email text,p_fulfillment text,p_address text,p_note text,p_items jsonb,
  p_promotion_id uuid default null,p_coupon_code text default null,p_referral_value text default null,p_excluded_campaign_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; code text;
begin
  result:=public.submit_shop_order(p_customer_name,p_phone,p_email,p_fulfillment,p_address,p_note,p_items,p_promotion_id,p_coupon_code,p_referral_value,p_excluded_campaign_ids);
  select referral_code into code from public.customer_referrals where referrer_user_id=nullif(current_setting('tings.checkout_user_id',true),'')::uuid;
  return result||jsonb_build_object('referral_reward',jsonb_build_object(
    'account_only',true,'referral_code',code,'referral_amount',5,'referral_min_spend',30,'reward_amount',5,'reward_min_spend',30,'reward_valid_days',90,
    'pending',exists(select 1 from public.referral_events where referred_order_id=(result->>'id')::uuid)));
end $$;

create or replace function public.submit_shop_order_account(
  p_customer_name text,p_phone text,p_email text,p_fulfillment text,p_address text,p_note text,
  p_items jsonb,p_idempotency_key uuid,p_user_id uuid default null,p_promotion_id uuid default null,
  p_coupon_code text default null,p_referral_value text default null,p_excluded_campaign_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior_user uuid; result jsonb; previous_context text:=current_setting('tings.checkout_user_id',true);
  email_value text:=lower(btrim(coalesce(p_email,'')));
begin
  if p_idempotency_key is null then raise exception '缺少订单幂等键'; end if;
  if p_user_id is not null then
    select lower(btrim(email)) into email_value from auth.users where id=p_user_id and email_confirmed_at is not null;
    if not found then raise exception '请先验证邮箱'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,73));
  end if;
  -- Serialize across different keys sharing guest/account identity signals.
  perform pg_advisory_xact_lock(hashtextextended('email:'||email_value,74));
  perform pg_advisory_xact_lock(hashtextextended('contact:'||coalesce(p_phone,''),75));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,29));
  select o.user_id into prior_user from public.order_submission_idempotency i
    join public.orders o on o.id=i.order_id where i.idempotency_key=p_idempotency_key;
  if found and prior_user is distinct from p_user_id then raise exception '下单账户已改变，请关闭并重新打开结算窗口'; end if;
  perform set_config('tings.checkout_user_id',coalesce(p_user_id::text,''),true);
  result:=public.submit_shop_order_idempotent(p_customer_name,p_phone,email_value,p_fulfillment,
    p_address,p_note,p_items,p_idempotency_key,p_promotion_id,p_coupon_code,p_referral_value,p_excluded_campaign_ids);
  update public.orders set user_id=p_user_id where id=(result->>'id')::uuid;
  perform set_config('tings.checkout_user_id',coalesce(previous_context,''),true);
  return result;
end $$;
revoke all on function public.submit_shop_order_account(text,text,text,text,text,text,jsonb,uuid,uuid,uuid,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.submit_shop_order_account(text,text,text,text,text,text,jsonb,uuid,uuid,uuid,text,text,uuid[]) to service_role;
revoke all on function public.submit_shop_order_with_referral_rewards(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.submit_shop_order_with_referral_rewards(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[]) to service_role;
-- Prevent retired overloads from bypassing the new identity checks.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='submit_shop_order' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function public.submit_shop_order(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[]) to service_role;
-- Legacy public phone-code preview no longer recognizes any usable referral.
do $$ begin
  if to_regprocedure('public.preview_referral_offer(text,text,numeric,numeric)') is not null then
    execute 'revoke all on function public.preview_referral_offer(text,text,numeric,numeric) from public,anon,authenticated';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
