-- Automatically choose the best eligible offer at checkout.
create or replace function public.submit_shop_order(
  p_customer_name text, p_phone text, p_email text, p_fulfillment text,
  p_address text, p_note text, p_items jsonb, p_promotion_id uuid default null,
  p_coupon_code text default null, p_referral_value text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  line jsonb; product_row record; variant_row record; campaign record; coupon record;
  lines jsonb := '[]'::jsonb; item_subtotal numeric(10,2):=0; eligible_subtotal numeric(10,2):=0;
  item_discount numeric(10,2):=0; fee numeric(10,2); tax numeric(10,2); total numeric(10,2);
  store_tax numeric(6,3); free_at numeric(10,2); base_fee numeric(10,2); order_id uuid; order_number text;
  selected_name text:=null; selected_kind text:=null; selected_campaign_id uuid:=null; selected_coupon_id uuid:=null;
  selected_benefit numeric(10,2):=0; candidate_benefit numeric(10,2); candidate_discount numeric(10,2);
  candidate_free_shipping boolean:=false; selected_free_shipping boolean:=false; coupon_uses integer:=0; prior_orders integer:=0;
  referral_phone text:=null; taxable numeric(10,2);
begin
  if p_phone !~ '^[0-9]{10}$' then raise exception '请输入 10 位数字电话号码'; end if;
  if p_fulfillment not in ('delivery','pickup') then raise exception '取货方式无效'; end if;
  if p_fulfillment='delivery' and coalesce(trim(p_address),'')='' then raise exception '请填写配送地址'; end if;
  if coalesce(char_length(p_note),0)>300 then raise exception '备注不能超过 300 字'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception '购物车为空'; end if;
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

  fee:=case when p_fulfillment='pickup' or item_subtotal>=free_at then 0 else base_fee end;
  for campaign in select * from public.marketing_campaigns where active=true and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()) order by created_at,id loop
    candidate_benefit:=0; candidate_discount:=0; candidate_free_shipping:=false;
    if campaign.kind='full_reduction' and item_subtotal>=campaign.threshold then
      candidate_discount:=least(campaign.amount,item_subtotal); candidate_benefit:=candidate_discount;
    elsif campaign.kind in ('product_discount','category_discount','holiday') then
      if cardinality(campaign.product_ids)=0 and cardinality(campaign.category_names)=0 then
        eligible_subtotal:=item_subtotal;
      else
        select coalesce(sum((x->>'line_total')::numeric),0) into eligible_subtotal from jsonb_array_elements(lines) x
        where (cardinality(campaign.product_ids)>0 and (x->>'product_id')::bigint=any(campaign.product_ids))
           or (cardinality(campaign.category_names)>0 and (x->>'category')=any(campaign.category_names));
      end if;
      if eligible_subtotal>0 then
        candidate_discount:=case when campaign.discount_kind='percent' then round(eligible_subtotal*campaign.amount/100,2) else least(campaign.amount,eligible_subtotal) end;
        candidate_benefit:=candidate_discount;
      end if;
    elsif campaign.kind='free_shipping' and p_fulfillment='delivery' and fee>0 then
      candidate_free_shipping:=true; candidate_benefit:=fee;
    end if;
    if candidate_benefit>selected_benefit then
      selected_benefit:=candidate_benefit; item_discount:=candidate_discount; selected_free_shipping:=candidate_free_shipping;
      selected_campaign_id:=campaign.id; selected_coupon_id:=null; selected_name:=campaign.name; selected_kind:=campaign.kind;
    end if;
  end loop;

  if nullif(trim(coalesce(p_coupon_code,'')),'') is not null then
    select * into coupon from public.marketing_coupons where code=upper(trim(p_coupon_code)) and active=true and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()) for update;
    if not found then raise exception '优惠券无效或已过期'; end if;
    if coupon.recipient_phone is not null and coupon.recipient_phone<>p_phone then raise exception '该优惠券不属于此电话号码'; end if;
    if item_subtotal<coupon.min_spend then raise exception '未达到优惠券最低消费金额'; end if;
    select count(*) into coupon_uses from public.coupon_redemptions where coupon_id=coupon.id;
    if coupon_uses>=coupon.total_quantity then raise exception '该优惠券已领完'; end if;
    select count(*) into coupon_uses from public.coupon_redemptions where coupon_id=coupon.id and phone=p_phone;
    if coupon_uses>=coupon.per_phone_limit then raise exception '此电话号码已使用过该优惠券'; end if;
    candidate_benefit:=least(coupon.amount,item_subtotal);
    if candidate_benefit>selected_benefit then
      selected_benefit:=candidate_benefit; item_discount:=candidate_benefit; selected_free_shipping:=false;
      selected_campaign_id:=null; selected_coupon_id:=coupon.id; selected_name:=coupon.name; selected_kind:='coupon';
    end if;
  end if;
  if selected_free_shipping then fee:=0; end if;
  taxable:=greatest(item_subtotal-item_discount,0); tax:=round(taxable*store_tax/100,2); total:=round(taxable+tax+fee,2);
  order_number:='TSH-'||to_char(clock_timestamp(),'YYMMDD')||'-'||upper(substr(md5(random()::text),1,5));
  insert into public.orders(order_number,customer_name,phone,email,fulfillment,address,customer_note,items,subtotal,discount_amount,promotion_id,promotion_kind,promotion_name,coupon_code,promotion_snapshot,tax_rate,tax_amount,delivery_fee,total_amount,status,archived)
  values(order_number,trim(p_customer_name),p_phone,nullif(trim(p_email),''),p_fulfillment,nullif(trim(p_address),''),nullif(trim(p_note),''),lines,item_subtotal,item_discount,selected_campaign_id,selected_kind,selected_name,case when selected_coupon_id is not null then coupon.code else null end,jsonb_build_object('name',selected_name,'kind',selected_kind,'discount_amount',item_discount,'benefit_amount',selected_benefit),store_tax,tax,fee,total,'待确认',false) returning id into order_id;
  if selected_coupon_id is not null then insert into public.coupon_redemptions(coupon_id,order_id,phone,discount_amount) values(selected_coupon_id,order_id,p_phone,item_discount); end if;
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
  return jsonb_build_object('id',order_id,'order_number',order_number,'subtotal',item_subtotal,'discount_amount',item_discount,'promotion_name',selected_name,'tax_rate',store_tax,'tax_amount',tax,'delivery_fee',fee,'total_amount',total);
end $$;

grant execute on function public.submit_shop_order(text,text,text,text,text,text,jsonb,uuid,text,text) to anon, authenticated;
