-- Apply after customer-wallet-migration.sql. Existing coupons remain legacy; no backfill of claims.
begin;
alter table public.marketing_coupons
  add column if not exists requires_claim boolean not null default false,
  add column if not exists max_discount numeric(10,2),
  add column if not exists claim_valid_days integer;
alter table public.marketing_coupons drop constraint if exists marketing_coupons_discount_kind_check;
alter table public.marketing_coupons add constraint marketing_coupons_discount_kind_check check(discount_kind in ('fixed','percent','free_shipping'));
alter table public.marketing_coupons drop constraint if exists marketing_coupons_amount_check;
alter table public.marketing_coupons add constraint marketing_coupons_amount_check check((discount_kind='free_shipping' and amount=0) or (discount_kind<>'free_shipping' and amount>0));
create table if not exists public.customer_coupon_claims (
  coupon_id uuid not null references public.marketing_coupons(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key(coupon_id,user_id)
);
alter table public.customer_coupon_claims enable row level security;
revoke all on public.customer_coupon_claims from public,anon,authenticated;
grant select on public.customer_coupon_claims to authenticated;
drop policy if exists read_own_coupon_claims on public.customer_coupon_claims;
create policy read_own_coupon_claims on public.customer_coupon_claims for select to authenticated
  using(user_id=auth.uid() or public.is_shop_account_owner());

create or replace function public.enforce_coupon_v2_rules() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='INSERT' then
    -- Reward issuance is an existing trusted server flow, not a public claim template.
    NEW.requires_claim:=NEW.source='marketing' and NEW.claimed_by_user_id is null and not NEW.is_referral_reward;
  elsif NEW.requires_claim is distinct from OLD.requires_claim then
    raise exception '不可更改已有券的领取模式，请新建优惠券';
  end if;
  if NEW.requires_claim then
    if NEW.claim_valid_days is null or NEW.claim_valid_days not between 1 and 3650 then raise exception '请填写领取后有效天数（1–3650）'; end if;
    if NEW.discount_kind='percent' and (NEW.max_discount is null or NEW.max_discount<=0 or NEW.amount>100) then raise exception '新折扣券必须填写最高减免金额，比例不可超过100'; end if;
    if NEW.max_discount is not null and NEW.max_discount<=0 then raise exception '最高减免金额必须大于0'; end if;
    if NEW.per_phone_limit<>1 then raise exception '新券每账户限用一次'; end if;
    if NEW.recipient_phone is not null or NEW.claimed_by_user_id is not null or NEW.source<>'marketing' or NEW.is_referral_reward then raise exception '领券模板不能指定其他归属'; end if;
  end if;
  if TG_OP='UPDATE' and OLD.requires_claim and exists(select 1 from public.customer_coupon_claims where coupon_id=OLD.id) then
    if row(NEW.amount,NEW.discount_kind,NEW.min_spend,NEW.max_discount,NEW.claim_valid_days,NEW.starts_at,NEW.ends_at,NEW.customer_scope,NEW.allow_campaign_stack,NEW.code)
      is distinct from row(OLD.amount,OLD.discount_kind,OLD.min_spend,OLD.max_discount,OLD.claim_valid_days,OLD.starts_at,OLD.ends_at,OLD.customer_scope,OLD.allow_campaign_stack,OLD.code)
      then raise exception '已有用户领券，优惠与期限不可修改；请新建券。仍可停用或增加数量。'; end if;
    if NEW.total_quantity<(select count(*) from public.customer_coupon_claims where coupon_id=OLD.id) then raise exception '数量不能低于已领取数量'; end if;
  end if;
  return NEW;
end $$;
revoke all on function public.enforce_coupon_v2_rules() from public,anon,authenticated;
drop trigger if exists coupon_v2_rules on public.marketing_coupons;
create trigger coupon_v2_rules before insert or update on public.marketing_coupons for each row execute function public.enforce_coupon_v2_rules();

-- Private reason helper: never accepts a caller-selected identity through a public RPC.
create or replace function public.coupon_v2_reason(p_id uuid,p_user uuid,p_phone text,p_claim boolean default false) returns text
language plpgsql stable security definer set search_path='' as $$
declare c public.marketing_coupons%rowtype; cl public.customer_coupon_claims%rowtype; email_value text;
begin
  select * into c from public.marketing_coupons where id=p_id;
  if not found then return '优惠券不存在'; end if;
  if not c.active or coalesce(c.status,'published')<>'published' then return '优惠券已停用'; end if;
  if c.starts_at>now() then return '尚未开始'; end if;
  if c.ends_at<now() then return '优惠券已过期'; end if;
  if c.discount_kind='percent' and c.amount>100 then return '优惠规则无效'; end if;
  select lower(btrim(email)) into email_value from auth.users where id=p_user and email_confirmed_at is not null;
  if c.requires_claim and email_value is null then return '请先登录并验证邮箱'; end if;
  if c.claimed_by_user_id is not null then
    if p_user is distinct from c.claimed_by_user_id then return '优惠券不属于当前账户'; end if;
  elsif c.source='referral' or c.is_referral_reward or nullif(c.recipient_phone,'') is not null then return '优惠券不属于当前账户'; end if;
  if c.customer_scope='new' and (p_user is null or exists(select 1 from public.orders where status in ('已完成','已取货','已配送') and
    (user_id=p_user or lower(btrim(email))=email_value or phone=p_phone))) then return '仅限符合条件的新客'; end if;
  if c.requires_claim then
    select * into cl from public.customer_coupon_claims where coupon_id=c.id and user_id=p_user;
    if not found then
      if not p_claim then return '请先领取优惠券'; end if;
      if (select count(*) from public.customer_coupon_claims where coupon_id=c.id)>=c.total_quantity then return '优惠券已领完'; end if;
    elsif cl.expires_at<now() then return '领取的优惠券已过期'; end if;
    if exists(select 1 from public.coupon_redemptions where coupon_id=c.id and user_id=p_user) then return '此券已使用'; end if;
  else
    if (select count(*) from public.coupon_redemptions where coupon_id=c.id)>=c.total_quantity then return '优惠券次数已用完'; end if;
    if (select count(*) from public.coupon_redemptions where coupon_id=c.id and ((p_user is not null and user_id=p_user) or phone=p_phone or c.claimed_by_user_id is not null))>=c.per_phone_limit then return '此券已使用'; end if;
  end if;
  return null;
end $$;
revoke all on function public.coupon_v2_reason(uuid,uuid,text,boolean) from public,anon,authenticated;
create or replace function public.customer_coupon_allowed(p_coupon_id uuid,p_user_id uuid,p_phone text) returns boolean
language sql stable security definer set search_path='' as $$ select public.coupon_v2_reason(p_coupon_id,p_user_id,p_phone,false) is null $$;
revoke all on function public.customer_coupon_allowed(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.claim_customer_coupon(p_coupon_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c public.marketing_coupons%rowtype; reason text; expires timestamptz;
begin
  if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception '请先登录并验证邮箱'; end if;
  select * into c from public.marketing_coupons where id=p_coupon_id for update;
  if not found or not c.requires_claim then raise exception '此券无需手动领取或不存在'; end if;
  select expires_at into expires from public.customer_coupon_claims where coupon_id=c.id and user_id=uid;
  if found then return jsonb_build_object('claimed',true,'already_claimed',true,'expires_at',expires); end if;
  reason:=public.coupon_v2_reason(c.id,uid,null,true);
  if reason is not null then raise exception '%',reason; end if;
  expires:=least(now()+make_interval(days=>c.claim_valid_days),coalesce(c.ends_at,'infinity'::timestamptz));
  insert into public.customer_coupon_claims(coupon_id,user_id,expires_at) values(c.id,uid,expires);
  return jsonb_build_object('claimed',true,'already_claimed',false,'expires_at',expires);
end $$;
revoke all on function public.claim_customer_coupon(uuid) from public,anon,authenticated;
grant execute on function public.claim_customer_coupon(uuid) to authenticated;

-- Preserve the legacy response's referral details; replace only coupon presentation data.
do $$ begin
  if to_regprocedure('public.get_my_customer_wallet_legacy()') is null then alter function public.get_my_customer_wallet() rename to get_my_customer_wallet_legacy; end if;
end $$;
revoke all on function public.get_my_customer_wallet_legacy() from public,anon,authenticated;
create or replace function public.get_my_customer_wallet() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; coupons jsonb; uid uuid:=auth.uid();
begin
  result:=public.get_my_customer_wallet_legacy();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'code',c.code,'name',c.name,'amount',c.amount,'discount_kind',c.discount_kind,'min_spend',c.min_spend,
    'max_discount',c.max_discount,'requires_claim',c.requires_claim,'claim_valid_days',c.claim_valid_days,
    'claimed',cl.user_id is not null or c.claimed_by_user_id=uid,'claimed_at',coalesce(cl.claimed_at,c.claimed_at),
    'starts_at',c.starts_at,'ends_at',coalesce(cl.expires_at,c.ends_at),'per_user_limit',c.per_phone_limit,
    'kind',case when c.source='referral' then 'referral' when c.customer_scope='new' then 'new' else 'regular' end,
    'allow_campaign_stack',c.allow_campaign_stack,'customer_scope',c.customer_scope,
    'unavailable_reason',r.reason,'status',case when r.reason is not null then
      case when r.reason like '%过期%' then 'expired' when r.reason='此券已使用' then 'used' else 'unavailable' end
      when c.requires_claim and cl.user_id is null then 'claimable' else 'available' end,
    'uses',coalesce((select jsonb_agg(jsonb_build_object('used_at',d.created_at,'order_number',o.order_number)) from public.coupon_redemptions d join public.orders o on o.id=d.order_id where d.coupon_id=c.id and d.user_id=uid and o.user_id=uid),'[]'::jsonb)
  ) order by c.created_at desc,c.id),'[]'::jsonb) into coupons
  from public.marketing_coupons c left join public.customer_coupon_claims cl on cl.coupon_id=c.id and cl.user_id=uid
  cross join lateral (select public.coupon_v2_reason(c.id,uid,null,c.requires_claim and cl.user_id is null) reason) r
  where c.claimed_by_user_id=uid or cl.user_id is not null or
    (c.claimed_by_user_id is null and nullif(c.recipient_phone,'') is null and not c.is_referral_reward and c.source<>'referral' and c.active and coalesce(c.status,'published')='published');
  return result||jsonb_build_object('coupons',coupons,'coupon_schema',2);
end $$;
revoke all on function public.get_my_customer_wallet() from public,anon,authenticated;
grant execute on function public.get_my_customer_wallet() to authenticated;

create or replace function public.coupon_money_discount(p_kind text,p_amount numeric,p_cap numeric,p_subtotal numeric,p_campaign_discount numeric) returns numeric
language sql immutable set search_path='' as $$
  select greatest(0,least(case when p_kind='percent' then least(round(p_subtotal*p_amount/100,2),coalesce(p_cap,'Infinity'::numeric))
    when p_kind='free_shipping' then 0 else p_amount end,greatest(p_subtotal-coalesce(p_campaign_discount,0),0)))
$$;
revoke all on function public.coupon_money_discount(text,numeric,numeric,numeric,numeric) from public,anon,authenticated;

-- Keep the old RPC signature safe for cached clients; only v2 previews shipping coupons.
do $$ begin
  if to_regprocedure('public.preview_account_offer_legacy(text,text,text,numeric,numeric)') is null then
    alter function public.preview_account_offer(text,text,text,numeric,numeric) rename to preview_account_offer_legacy;
  end if;
end $$;
revoke all on function public.preview_account_offer_legacy(text,text,text,numeric,numeric) from public,anon,authenticated;
create or replace function public.preview_account_offer_v2(p_code text,p_email text,p_phone text,p_subtotal numeric,p_campaign_discount numeric default 0,p_fulfillment text default 'pickup',p_campaign_free_shipping boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.marketing_coupons%rowtype; reason text; fee numeric; threshold numeric; s public.shop_settings%rowtype; benefit numeric;
begin
  select * into c from public.marketing_coupons where code=upper(btrim(p_code));
  if not found then return public.preview_account_offer_legacy(p_code,p_email,p_phone,p_subtotal,p_campaign_discount); end if;
  reason:=public.coupon_v2_reason(c.id,auth.uid(),p_phone,false);
  if reason is null and (p_subtotal is null or p_subtotal<c.min_spend) then reason:='未达到优惠券最低消费：满 $'||c.min_spend||' 可用'; end if;
  if reason is null and c.discount_kind='free_shipping' then
    select * into s from public.shop_settings where id=1;
    threshold:=greatest(coalesce(nullif(s.content->'storeSettings'->'order'->>'minOrder','')::numeric,20),coalesce(nullif(s.content->'storeSettings'->'delivery'->>'minDelivery','')::numeric,30));
    fee:=case when p_subtotal>=s.free_delivery_threshold or p_campaign_free_shipping then 0 else s.delivery_fee end;
    if p_fulfillment is distinct from 'delivery' then reason:='仅配送订单可用';
    elsif p_subtotal<threshold then reason:='未达到店铺最低配送消费';
    elsif coalesce(fee,0)<=0 then reason:='本单配送费已免，无需使用此券'; end if;
  end if;
  if reason is not null then return jsonb_build_object('valid',false,'discount',0,'reason',reason); end if;
  benefit:=public.coupon_money_discount(c.discount_kind,c.amount,c.max_discount,p_subtotal,p_campaign_discount);
  return jsonb_build_object('valid',true,'is_referral',false,'discount',benefit,'name',c.name,'allow_campaign_stack',c.allow_campaign_stack,
    'free_shipping',c.discount_kind='free_shipping','shipping_discount',case when c.discount_kind='free_shipping' then fee else 0 end);
end $$;
revoke all on function public.preview_account_offer_v2(text,text,text,numeric,numeric,text,boolean) from public,anon,authenticated;
grant execute on function public.preview_account_offer_v2(text,text,text,numeric,numeric,text,boolean) to anon,authenticated;
create or replace function public.preview_account_offer(p_code text,p_email text,p_phone text,p_subtotal numeric,p_campaign_discount numeric default 0) returns jsonb
language sql stable security definer set search_path='' as $$
  select public.preview_account_offer_v2(p_code,p_email,p_phone,p_subtotal,p_campaign_discount,'pickup',false)
$$;
revoke all on function public.preview_account_offer(text,text,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.preview_account_offer(text,text,text,numeric,numeric) to anon,authenticated;

-- Patch reviewed fragments only; preserve identity, locks, stock, tax, RLS and idempotency wrappers.
do $upgrade$
declare definition text; old_fragment text; new_fragment text; pair text[];
begin
  select replace(pg_get_functiondef('public.submit_shop_order(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[])'::regprocedure),chr(13),'') into definition;
  if position('coupon-claims-v2' in definition)=0 then
    foreach pair slice 1 in array array[
      array['  line jsonb;', '  -- coupon-claims-v2'||chr(10)||'  coupon_shipping_discount numeric(10,2):=0;'||chr(10)||'  line jsonb;'],
      array[$old$code_discount:=least(case when coupon.discount_kind='percent' then round(current_subtotal*coupon.amount/100,2) else coupon.amount end,current_subtotal-campaign_discount);$old$,
        $new$if coupon.discount_kind='free_shipping' then
        if p_fulfillment<>'delivery' then raise exception '仅配送订单可用'; end if;
        if coalesce(fee,0)<=0 then raise exception '本单配送费已免，无需使用此券'; end if;
        coupon_shipping_discount:=fee; fee:=0; code_discount:=0;
      else
        code_discount:=public.coupon_money_discount(coupon.discount_kind,coupon.amount,coupon.max_discount,current_subtotal,campaign_discount);
      end if;$new$],
      array[$old$if coupon_uses>=coupon.per_phone_limit then raise exception '此电话号码已使用过该优惠券'; end if;$old$,
        $new$if not coupon.requires_claim and coupon_uses>=coupon.per_phone_limit then raise exception '此电话号码已使用过该优惠券'; end if;$new$],
      array[$old$'code_discount',code_discount)$old$,$new$'code_discount',code_discount,'coupon_shipping_discount',coupon_shipping_discount,'coupon_max_discount',case when selected_coupon_id is not null then coupon.max_discount else null end)$new$],
      array[$old$values(selected_coupon_id,order_id,p_phone,code_discount);$old$,$new$values(selected_coupon_id,order_id,p_phone,code_discount+coupon_shipping_discount);$new$]
    ] loop
      old_fragment:=pair[1]; new_fragment:=pair[2];
      if position(old_fragment in definition)=0 then raise exception '订单核算代码不匹配，迁移已停止：%',old_fragment; end if;
      definition:=replace(definition,old_fragment,new_fragment);
    end loop;
    execute definition;
  end if;
end $upgrade$;
notify pgrst,'reload schema';
commit;
