-- Stack one automatic campaign with one entered coupon or owner-generated referral code.
create table if not exists public.referral_reward_settings (
  id integer primary key default 1 check (id=1),
  amount numeric(10,2) not null default 5 check (amount>0),
  min_spend numeric(10,2) not null default 35 check (min_spend>=0),
  valid_days integer not null default 0 check (valid_days>=0),
  updated_at timestamptz not null default now()
);
insert into public.referral_reward_settings(id,amount,min_spend,valid_days) values(1,5,35,0) on conflict(id) do nothing;
alter table public.referral_reward_settings enable row level security;
drop policy if exists "owner manages referral reward settings" on public.referral_reward_settings;
drop policy if exists "admin manages referral reward settings" on public.referral_reward_settings;
create policy "admin manages referral reward settings" on public.referral_reward_settings for all to anon, authenticated using (true) with check (true);
drop policy if exists "owner reads referrals" on public.customer_referrals;
drop policy if exists "owner manages referrals" on public.customer_referrals;
drop policy if exists "admin manages referrals" on public.customer_referrals;
create policy "admin manages referrals" on public.customer_referrals for all to anon, authenticated using (true) with check (true);

-- A coupon may independently prohibit combining with any applicable activity.
alter table public.marketing_coupons
  add column if not exists allow_campaign_stack boolean not null default true;

create or replace function public.submit_shop_order(
  p_customer_name text, p_phone text, p_email text, p_fulfillment text,
  p_address text, p_note text, p_items jsonb, p_promotion_id uuid default null,
  p_coupon_code text default null, p_referral_value text default null,
  p_excluded_campaign_ids uuid[] default '{}'::uuid[]
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  line jsonb; product_row record; variant_row record; campaign record; coupon record; referral_owner record;
  lines jsonb := '[]'::jsonb; item_subtotal numeric(10,2):=0; current_subtotal numeric(10,2):=0; eligible_subtotal numeric(10,2):=0;
  direct_discount numeric(10,2):=0; campaign_discount numeric(10,2):=0; code_discount numeric(10,2):=0; total_discount numeric(10,2):=0;
  fee numeric(10,2); tax numeric(10,2); total numeric(10,2); store_tax numeric(6,3); free_at numeric(10,2); base_fee numeric(10,2); store_content jsonb; min_order numeric(10,2); min_delivery numeric(10,2);
  order_id uuid; order_number text; selected_campaign_name text:=null; selected_campaign_kind text:=null; selected_campaign_id uuid:=null;
  selected_campaign_benefit numeric(10,2):=0; candidate_benefit numeric(10,2); candidate_discount numeric(10,2); selected_free_shipping boolean:=false;
  selected_code_name text:=null; selected_code_kind text:=null; selected_coupon_id uuid:=null; entered_code text:=null; coupon_uses integer:=0;
  prior_orders integer:=0; referral_amount numeric(10,2); referral_min numeric(10,2); referral_days integer; reward_ends_at timestamptz; taxable numeric(10,2); blocked_campaign_names text; coupon_campaign_conflict boolean:=false;
begin
  if p_phone !~ '^[0-9]{10}$' then raise exception '请输入 10 位数字电话号码'; end if;
  if p_fulfillment not in ('delivery','pickup') then raise exception '取货方式无效'; end if;
  if p_fulfillment='delivery' and coalesce(trim(p_address),'')='' then raise exception '请填写配送地址'; end if;
  if coalesce(char_length(p_note),0)>300 then raise exception '备注不能超过 300 字'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception '购物车为空'; end if;
  select tax_rate,delivery_fee,free_delivery_threshold,content into store_tax,base_fee,free_at,store_content from public.shop_settings where id=1;
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
  -- Product and category discounts are reflected in every matching item's current price.
  select coalesce(sum(
    least((x->>'price')::numeric, coalesce((
      select max(case when c.discount_kind='percent' then round((x->>'price')::numeric*c.amount/100,2) else c.amount end)
      from public.marketing_campaigns c
      where c.active=true and (c.status is null or c.status='published')
        and not (c.id=any(coalesce(p_excluded_campaign_ids,'{}'::uuid[])))
        and c.kind in ('product_discount','category_discount')
        and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>=now())
        and (cardinality(c.product_ids)=0 and cardinality(c.category_names)=0
          or (cardinality(c.product_ids)>0 and (x->>'product_id')::bigint=any(c.product_ids))
          or (cardinality(c.category_names)>0 and (x->>'category')=any(c.category_names)))
    ),0)) * (x->>'qty')::integer
  ),0) into direct_discount from jsonb_array_elements(lines) x;
  current_subtotal:=greatest(item_subtotal-direct_discount,0);
  min_order:=coalesce(nullif(store_content->'storeSettings'->'order'->>'minOrder','')::numeric,20);
  min_delivery:=greatest(min_order,coalesce(nullif(store_content->'storeSettings'->'delivery'->>'minDelivery','')::numeric,30));
  if current_subtotal<min_order then raise exception '没有达到最低消费$%哦！请再挑一些吧！',to_char(min_order,'FM999999990.00'); end if;
  if p_fulfillment='delivery' and current_subtotal<min_delivery then raise exception '没有达到最低配送$%哦！请再挑一些吧！',to_char(min_delivery,'FM999999990.00'); end if;
  fee:=case when p_fulfillment='pickup' or current_subtotal>=free_at then 0 else base_fee end;
  for campaign in select * from public.marketing_campaigns where active=true and kind in ('full_reduction','free_shipping') and (status is null or status='published') and not (id=any(coalesce(p_excluded_campaign_ids,'{}'::uuid[]))) and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()) order by created_at,id loop
    candidate_benefit:=0; candidate_discount:=0;
    if campaign.kind='full_reduction' and current_subtotal>=campaign.threshold then
      candidate_discount:=least(campaign.amount,current_subtotal); candidate_benefit:=candidate_discount;
    elsif campaign.kind in ('product_discount','category_discount','holiday') then
      if cardinality(campaign.product_ids)=0 and cardinality(campaign.category_names)=0 then eligible_subtotal:=current_subtotal;
      else
        select coalesce(sum((x->>'line_total')::numeric),0) into eligible_subtotal from jsonb_array_elements(lines) x
        where (cardinality(campaign.product_ids)>0 and (x->>'product_id')::bigint=any(campaign.product_ids)) or (cardinality(campaign.category_names)>0 and (x->>'category')=any(campaign.category_names));
      end if;
      if eligible_subtotal>0 then
        if campaign.discount_kind='percent' then candidate_discount:=round(eligible_subtotal*campaign.amount/100,2);
        else
          select coalesce(sum(least(campaign.amount,(x->>'price')::numeric)*(x->>'qty')::integer),0) into candidate_discount from jsonb_array_elements(lines) x
          where cardinality(campaign.product_ids)=0 and cardinality(campaign.category_names)=0
             or (cardinality(campaign.product_ids)>0 and (x->>'product_id')::bigint=any(campaign.product_ids))
             or (cardinality(campaign.category_names)>0 and (x->>'category')=any(campaign.category_names));
        end if;
        candidate_benefit:=candidate_discount;
      end if;
    elsif campaign.kind='free_shipping' and p_fulfillment='delivery' and fee>0 then candidate_benefit:=fee; end if;
    if candidate_benefit>selected_campaign_benefit then
      selected_campaign_benefit:=candidate_benefit; campaign_discount:=candidate_discount; selected_free_shipping:=(campaign.kind='free_shipping'); selected_campaign_id:=campaign.id; selected_campaign_name:=campaign.name; selected_campaign_kind:=campaign.kind;
    end if;
  end loop;
  if selected_free_shipping then fee:=0; end if;
  entered_code:=upper(trim(coalesce(nullif(p_coupon_code,''),nullif(p_referral_value,''))));
  if entered_code is not null and entered_code<>'' then
    select string_agg(c.name,'、' order by c.created_at,c.id) into blocked_campaign_names
    from public.marketing_campaigns c
    where c.active=true and (c.status is null or c.status='published')
      and coalesce(c.allow_coupon_stack,true)=false
      and not (c.id=any(coalesce(p_excluded_campaign_ids,'{}'::uuid[])))
      and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>=now())
      and (
        (c.kind in ('product_discount','category_discount') and exists (
          select 1 from jsonb_array_elements(lines) x
          where (cardinality(c.product_ids)=0 and cardinality(c.category_names)=0)
            or (cardinality(c.product_ids)>0 and (x->>'product_id')::bigint=any(c.product_ids))
            or (cardinality(c.category_names)>0 and (x->>'category')=any(c.category_names))
        ))
        or (c.kind='full_reduction' and current_subtotal>=c.threshold)
        or (c.kind='free_shipping' and p_fulfillment='delivery' and base_fee>0 and current_subtotal<free_at)
      );
    if blocked_campaign_names is not null then
      raise exception '优惠券/推荐码不能与%活动同时参加使用',blocked_campaign_names;
    end if;
    select * into referral_owner from public.customer_referrals where referral_code=entered_code;
    if found then
      select count(*) into prior_orders from public.orders where phone=p_phone;
      if prior_orders>0 then raise exception '推荐码仅限新顾客首单使用'; end if;
      select amount,min_spend,valid_days into referral_amount,referral_min,referral_days from public.referral_reward_settings where id=1;
      if current_subtotal<referral_min then raise exception '未达到推荐奖励最低消费金额'; end if;
      code_discount:=least(referral_amount,current_subtotal-campaign_discount); selected_code_name:='推荐码奖励'; selected_code_kind:='referral';
    else
      select * into coupon from public.marketing_coupons where code=entered_code and active=true and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()) for update;
      if not found then raise exception '优惠券或推荐码无效或已过期'; end if;
      if coupon.recipient_phone is not null and coupon.recipient_phone<>p_phone then raise exception '该优惠券不属于此电话号码'; end if;
      if current_subtotal<coupon.min_spend then raise exception '未达到优惠券最低消费金额'; end if;
      select count(*) into coupon_uses from public.coupon_redemptions where coupon_id=coupon.id;
      if coupon_uses>=coupon.total_quantity then raise exception '该优惠券已领完'; end if;
      select count(*) into coupon_uses from public.coupon_redemptions where coupon_id=coupon.id and phone=p_phone;
      if coupon_uses>=coupon.per_phone_limit then raise exception '此电话号码已使用过该优惠券'; end if;
      if coalesce(coupon.allow_campaign_stack,true)=false then
        select exists(
          select 1 from public.marketing_campaigns c
          where c.active=true and (c.status is null or c.status='published')
            and not (c.id=any(coalesce(p_excluded_campaign_ids,'{}'::uuid[])))
            and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>=now())
            and (
              (c.kind in ('product_discount','category_discount') and exists (
                select 1 from jsonb_array_elements(lines) x
                where (cardinality(c.product_ids)=0 and cardinality(c.category_names)=0)
                  or (cardinality(c.product_ids)>0 and (x->>'product_id')::bigint=any(c.product_ids))
                  or (cardinality(c.category_names)>0 and (x->>'category')=any(c.category_names))
              ))
              or (c.kind='full_reduction' and current_subtotal>=c.threshold)
              or (c.kind='free_shipping' and p_fulfillment='delivery' and base_fee>0 and current_subtotal<free_at)
            )
        ) into coupon_campaign_conflict;
        if coupon_campaign_conflict then raise exception '优惠券/推荐码不能与活动同时参加使用'; end if;
      end if;
      code_discount:=least(coupon.amount,current_subtotal-campaign_discount); selected_code_name:=coupon.name; selected_code_kind:='coupon'; selected_coupon_id:=coupon.id;
    end if;
  end if;
  total_discount:=greatest(direct_discount+campaign_discount+code_discount,0); taxable:=greatest(current_subtotal-campaign_discount-code_discount,0); tax:=round(taxable*store_tax/100,2); total:=round(taxable+tax+fee,2);
  order_number:='TSH-'||to_char(clock_timestamp(),'YYMMDD')||'-'||upper(substr(md5(random()::text),1,5));
  insert into public.orders(order_number,customer_name,phone,email,fulfillment,address,customer_note,items,subtotal,discount_amount,promotion_id,promotion_kind,promotion_name,coupon_code,promotion_snapshot,tax_rate,tax_amount,delivery_fee,total_amount,status,archived)
  values(order_number,trim(p_customer_name),p_phone,nullif(trim(p_email),''),p_fulfillment,nullif(trim(p_address),''),nullif(trim(p_note),''),lines,current_subtotal,total_discount,selected_campaign_id,coalesce(selected_campaign_kind,selected_code_kind,case when direct_discount>0 then 'product_discount' else null end),concat_ws(' + ',case when direct_discount>0 then '商品／分类优惠' end,selected_campaign_name,selected_code_name),entered_code,jsonb_build_object('direct_discount',direct_discount,'campaign_name',selected_campaign_name,'campaign_kind',selected_campaign_kind,'campaign_discount',campaign_discount,'code_name',selected_code_name,'code_kind',selected_code_kind,'code_discount',code_discount),store_tax,tax,fee,total,'待确认',false) returning id into order_id;
  if selected_coupon_id is not null then insert into public.coupon_redemptions(coupon_id,order_id,phone,discount_amount) values(selected_coupon_id,order_id,p_phone,code_discount); end if;
  if selected_code_kind='referral' then
    reward_ends_at:=case when referral_days>0 then now()+make_interval(days=>referral_days) else null end;
    update public.orders set referral_source=referral_owner.phone where id=order_id;
    insert into public.customer_referrals(phone,referral_code,referred_by_phone) values(p_phone,'TSHREF-'||upper(substr(md5(p_phone||clock_timestamp()::text),1,8)),referral_owner.phone) on conflict(phone) do nothing;
    insert into public.marketing_coupons(code,name,amount,min_spend,total_quantity,per_phone_limit,recipient_phone,is_referral_reward,ends_at)
    values('REF-'||upper(substr(md5(order_id::text||'new'),1,8)),'推荐新客奖励',referral_amount,referral_min,1,1,p_phone,true,reward_ends_at),('REF-'||upper(substr(md5(order_id::text||'old'),1,8)),'推荐新客奖励',referral_amount,referral_min,1,1,referral_owner.phone,true,reward_ends_at);
  else
    insert into public.customer_referrals(phone,referral_code) values(p_phone,'TSHREF-'||upper(substr(md5(p_phone||clock_timestamp()::text),1,8))) on conflict(phone) do nothing;
  end if;
  return jsonb_build_object('id',order_id,'order_number',order_number,'subtotal',current_subtotal,'discount_amount',total_discount,'promotion_name',concat_ws(' + ',case when direct_discount>0 then '商品／分类优惠' end,selected_campaign_name,selected_code_name),'tax_rate',store_tax,'tax_amount',tax,'delivery_fee',fee,'total_amount',total);
end $$;
grant execute on function public.submit_shop_order(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[]) to anon, authenticated;
