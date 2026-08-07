-- Ting's Snack House: marketing center, promotions, coupons and referrals.
create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('full_reduction','product_discount','category_discount','holiday','free_shipping')),
  name text not null,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  discount_kind text not null default 'fixed' check (discount_kind in ('fixed','percent','free_shipping')),
  threshold numeric(10,2) not null default 0 check (threshold >= 0),
  amount numeric(10,2) not null default 0 check (amount >= 0),
  product_ids bigint[] not null default '{}',
  category_names text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  amount numeric(10,2) not null check (amount > 0),
  min_spend numeric(10,2) not null default 0 check (min_spend >= 0),
  total_quantity integer not null default 1 check (total_quantity > 0),
  per_phone_limit integer not null default 1 check (per_phone_limit > 0),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  recipient_phone text,
  is_referral_reward boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code = upper(code))
);

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.marketing_coupons(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  phone text not null,
  discount_amount numeric(10,2) not null,
  created_at timestamptz not null default now(),
  unique (coupon_id, order_id)
);
create index if not exists coupon_redemptions_coupon_phone_idx on public.coupon_redemptions(coupon_id, phone);

create table if not exists public.customer_referrals (
  phone text primary key check (phone ~ '^[0-9]{10}$'),
  referral_code text not null unique,
  referred_by_phone text,
  created_at timestamptz not null default now()
);

alter table public.orders add column if not exists discount_amount numeric(10,2) not null default 0;
alter table public.orders add column if not exists promotion_id uuid;
alter table public.orders add column if not exists promotion_kind text;
alter table public.orders add column if not exists promotion_name text;
alter table public.orders add column if not exists coupon_code text;
alter table public.orders add column if not exists promotion_snapshot jsonb not null default '{}'::jsonb;
alter table public.orders add column if not exists referral_source text;

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.customer_referrals enable row level security;
drop policy if exists "public reads active campaigns" on public.marketing_campaigns;
drop policy if exists "owner manages campaigns" on public.marketing_campaigns;
drop policy if exists "owner manages coupons" on public.marketing_coupons;
drop policy if exists "owner reads coupon redemptions" on public.coupon_redemptions;
drop policy if exists "owner reads referrals" on public.customer_referrals;
create policy "public reads active campaigns" on public.marketing_campaigns for select using (active=true and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()));
create policy "owner manages campaigns" on public.marketing_campaigns for all to authenticated using ((auth.jwt()->>'email')='chenghanchen1@gmail.com') with check ((auth.jwt()->>'email')='chenghanchen1@gmail.com');
create policy "owner manages coupons" on public.marketing_coupons for all to authenticated using ((auth.jwt()->>'email')='chenghanchen1@gmail.com') with check ((auth.jwt()->>'email')='chenghanchen1@gmail.com');
create policy "owner reads coupon redemptions" on public.coupon_redemptions for select to authenticated using ((auth.jwt()->>'email')='chenghanchen1@gmail.com');
create policy "owner reads referrals" on public.customer_referrals for select to authenticated using ((auth.jwt()->>'email')='chenghanchen1@gmail.com');

drop function if exists public.submit_shop_order(text,text,text,text,text,text,jsonb);
create or replace function public.submit_shop_order(
  p_customer_name text, p_phone text, p_email text, p_fulfillment text,
  p_address text, p_note text, p_items jsonb, p_promotion_id uuid default null,
  p_coupon_code text default null, p_referral_value text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  line jsonb; product_row record; variant_row record; campaign record; coupon record; referrer record;
  lines jsonb := '[]'::jsonb; item_subtotal numeric(10,2):=0; eligible_subtotal numeric(10,2):=0;
  discount numeric(10,2):=0; fee numeric(10,2); tax numeric(10,2); total numeric(10,2);
  store_tax numeric(6,3); free_at numeric(10,2); base_fee numeric(10,2); order_id uuid; order_number text;
  selected_name text:=null; selected_kind text:=null; coupon_uses integer:=0; coupon_used boolean:=false; prior_orders integer:=0;
  referral_phone text:=null; referral_code text; taxable numeric(10,2);
begin
  if p_phone !~ '^[0-9]{10}$' then raise exception '请输入 10 位数字电话号码'; end if;
  if p_fulfillment not in ('delivery','pickup') then raise exception '取货方式无效'; end if;
  if p_fulfillment='delivery' and coalesce(trim(p_address),'')='' then raise exception '请填写配送地址'; end if;
  if coalesce(char_length(p_note),0)>300 then raise exception '备注不能超过 300 字'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception '购物车为空'; end if;
  if p_promotion_id is not null and nullif(trim(coalesce(p_coupon_code,'')),'') is not null then raise exception '一次订单只能使用一项优惠'; end if;
  select tax_rate,delivery_fee,free_delivery_threshold into store_tax,base_fee,free_at from public.shop_settings where id=1;
  for line in select value from jsonb_array_elements(p_items) loop
    if coalesce((line->>'qty')::integer,0)<1 then raise exception '商品数量无效'; end if;
    select * into product_row from public.products where id=(line->>'product_id')::bigint and is_active=true for update;
    if not found then raise exception '商品已下架'; end if;
    if nullif(line->>'variant_id','') is not null then
      select * into variant_row from public.product_variants where id=(line->>'variant_id')::bigint and product_id=product_row.id for update;
      if not found or variant_row.is_out_of_stock or variant_row.stock<(line->>'qty')::integer then raise exception '% 库存不足',product_row.name; end if;
      update public.product_variants set stock=stock-(line->>'qty')::integer,updated_at=now() where id=variant_row.id;
      lines:=lines||jsonb_build_array(jsonb_build_object('product_id',product_row.id,'variant_id',variant_row.id,'name',product_row.name,'category',product_row.type,'variant_label',coalesce((select string_agg(x->>'name',' / ') from jsonb_array_elements(variant_row.option_values) x),''),'price',variant_row.price,'qty',(line->>'qty')::integer,'line_total',variant_row.price*(line->>'qty')::integer,'image',coalesce(variant_row.image,product_row.image),'icon',product_row.icon));
      item_subtotal:=item_subtotal+variant_row.price*(line->>'qty')::integer;
    else
      if product_row.is_out_of_stock or product_row.stock<(line->>'qty')::integer then raise exception '% 库存不足',product_row.name; end if;
      update public.products set stock=stock-(line->>'qty')::integer,updated_at=now() where id=product_row.id;
      lines:=lines||jsonb_build_array(jsonb_build_object('product_id',product_row.id,'variant_id',null,'name',product_row.name,'category',product_row.type,'variant_label','','price',product_row.price,'qty',(line->>'qty')::integer,'line_total',product_row.price*(line->>'qty')::integer,'image',product_row.image,'icon',product_row.icon));
      item_subtotal:=item_subtotal+product_row.price*(line->>'qty')::integer;
    end if;
  end loop;
  if p_promotion_id is not null then
    select * into campaign from public.marketing_campaigns where id=p_promotion_id and active=true and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()) for update;
    if not found then raise exception '该活动已结束或不可用'; end if;
    selected_name:=campaign.name; selected_kind:=campaign.kind;
    if campaign.kind='full_reduction' then
      if item_subtotal<campaign.threshold then raise exception '未满足活动门槛'; end if;
      discount:=least(campaign.amount,item_subtotal);
    elsif campaign.kind in ('product_discount','category_discount','holiday') then
      select coalesce(sum((x->>'line_total')::numeric),0) into eligible_subtotal from jsonb_array_elements(lines) x
      where (cardinality(campaign.product_ids)>0 and (x->>'product_id')::bigint=any(campaign.product_ids))
         or (cardinality(campaign.category_names)>0 and (x->>'category')=any(campaign.category_names));
      if eligible_subtotal<=0 then raise exception '购物车没有符合该活动的商品'; end if;
      discount:=case when campaign.discount_kind='percent' then round(eligible_subtotal*campaign.amount/100,2) else least(campaign.amount,eligible_subtotal) end;
    elsif campaign.kind='free_shipping' then null;
    else raise exception '活动类型无效'; end if;
  elsif nullif(trim(coalesce(p_coupon_code,'')),'') is not null then
    select * into coupon from public.marketing_coupons where code=upper(trim(p_coupon_code)) and active=true and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()) for update;
    if not found then raise exception '优惠券无效或已过期'; end if;
    if coupon.recipient_phone is not null and coupon.recipient_phone<>p_phone then raise exception '该优惠券不属于此电话号码'; end if;
    if item_subtotal<coupon.min_spend then raise exception '未达到优惠券最低消费金额'; end if;
    select count(*) into coupon_uses from public.coupon_redemptions where coupon_id=coupon.id;
    if coupon_uses>=coupon.total_quantity then raise exception '该优惠券已领完'; end if;
    select count(*) into coupon_uses from public.coupon_redemptions where coupon_id=coupon.id and phone=p_phone;
    if coupon_uses>=coupon.per_phone_limit then raise exception '此电话号码已使用过该优惠券'; end if;
    discount:=least(coupon.amount,item_subtotal); selected_name:=coupon.name; selected_kind:='coupon'; coupon_used:=true;
  end if;
  fee:=case when p_fulfillment='pickup' or item_subtotal>=free_at or selected_kind='free_shipping' then 0 else base_fee end;
  taxable:=greatest(item_subtotal-discount,0); tax:=round(taxable*store_tax/100,2); total:=round(taxable+tax+fee,2);
  order_number:='TSH-'||to_char(clock_timestamp(),'YYMMDD')||'-'||upper(substr(md5(random()::text),1,5));
  insert into public.orders(order_number,customer_name,phone,email,fulfillment,address,customer_note,items,subtotal,discount_amount,promotion_id,promotion_kind,promotion_name,coupon_code,promotion_snapshot,tax_rate,tax_amount,delivery_fee,total_amount,status,archived)
  values(order_number,trim(p_customer_name),p_phone,nullif(trim(p_email),''),p_fulfillment,nullif(trim(p_address),''),nullif(trim(p_note),''),lines,item_subtotal,discount,p_promotion_id,selected_kind,selected_name,case when coupon_used then coupon.code else null end,jsonb_build_object('name',selected_name,'kind',selected_kind,'discount_amount',discount),store_tax,tax,fee,total,'待确认',false) returning id into order_id;
  if coupon_used then insert into public.coupon_redemptions(coupon_id,order_id,phone,discount_amount) values(coupon.id,order_id,p_phone,discount); end if;
  select count(*) into prior_orders from public.orders where phone=p_phone and id<>order_id;
  if prior_orders=0 and nullif(trim(coalesce(p_referral_value,'')),'') is not null then
    select phone into referral_phone from public.customer_referrals where referral_code=upper(trim(p_referral_value)) or phone=trim(p_referral_value) limit 1;
    if referral_phone is null or referral_phone=p_phone or not exists(select 1 from public.orders where phone=referral_phone and id<>order_id) then raise exception '推荐人不存在或尚未完成首次下单'; end if;
    update public.orders set referral_source=referral_phone where id=order_id;
    insert into public.customer_referrals(phone,referral_code,referred_by_phone) values(p_phone,'TSHREF-'||upper(substr(md5(p_phone||clock_timestamp()::text),1,8)),referral_phone) on conflict(phone) do nothing;
    insert into public.customer_referrals(phone,referral_code) values(referral_phone,'TSHREF-'||upper(substr(md5(referral_phone||clock_timestamp()::text),1,8))) on conflict(phone) do nothing;
    insert into public.marketing_coupons(code,name,amount,min_spend,total_quantity,per_phone_limit,recipient_phone,is_referral_reward)
    values('REF-'||upper(substr(md5(order_id::text||'new'),1,8)),'推荐新客奖励',5,35,1,1,p_phone,true),('REF-'||upper(substr(md5(order_id::text||'old'),1,8)),'推荐新客奖励',5,35,1,1,referral_phone,true);
  else
    insert into public.customer_referrals(phone,referral_code) values(p_phone,'TSHREF-'||upper(substr(md5(p_phone||clock_timestamp()::text),1,8))) on conflict(phone) do nothing;
  end if;
  return jsonb_build_object('id',order_id,'order_number',order_number,'subtotal',item_subtotal,'discount_amount',discount,'promotion_name',selected_name,'tax_rate',store_tax,'tax_amount',tax,'delivery_fee',fee,'total_amount',total);
end $$;

create or replace function public.owner_update_order(p_order_id uuid,p_status text,p_fulfillment text,p_delivery_fee numeric) returns jsonb language plpgsql security definer set search_path=public as $$
declare order_row public.orders%rowtype; line jsonb; fee numeric(10,2); tax numeric(10,2); total numeric(10,2); archived_now boolean;
begin
  if (auth.jwt()->>'email')<>'chenghanchen1@gmail.com' then raise exception '无权操作'; end if;
  if p_status not in ('待确认','已确认','配送中','已取消','已完成') then raise exception '订单状态无效'; end if;
  select * into order_row from public.orders where id=p_order_id for update; if not found then raise exception '订单不存在'; end if;
  if p_fulfillment not in ('delivery','pickup') then raise exception '取货方式无效'; end if;
  if p_fulfillment='pickup' and p_status='配送中' then raise exception '自取订单不能设为配送中'; end if;
  fee:=case when p_fulfillment='pickup' then 0 else greatest(coalesce(p_delivery_fee,order_row.delivery_fee),0) end;
  if p_status='已取消' and order_row.status<>'已取消' then
    for line in select value from jsonb_array_elements(order_row.items) loop
      if nullif(line->>'variant_id','') is not null then update public.product_variants set stock=stock+coalesce((line->>'qty')::integer,0),updated_at=now() where id=(line->>'variant_id')::bigint;
      else update public.products set stock=stock+coalesce((line->>'qty')::integer,0),updated_at=now() where id=(line->>'product_id')::bigint; end if;
    end loop;
  end if;
  tax:=round(greatest(order_row.subtotal-coalesce(order_row.discount_amount,0),0)*order_row.tax_rate/100,2); total:=round(greatest(order_row.subtotal-coalesce(order_row.discount_amount,0),0)+tax+fee,2); archived_now:=p_status in ('已取消','已完成');
  update public.orders set status=p_status,fulfillment=p_fulfillment,delivery_fee=fee,tax_amount=tax,total_amount=total,archived=archived_now,archived_at=case when archived_now then now() else null end,cancellation_requested=case when p_status='已取消' then false else cancellation_requested end where id=p_order_id;
  return jsonb_build_object('total_amount',total,'archived',archived_now);
end $$;

grant execute on function public.submit_shop_order(text,text,text,text,text,text,jsonb,uuid,text,text) to anon, authenticated;
