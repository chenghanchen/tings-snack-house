-- Return only the new order's referral reward details to the submitting customer.
-- Run this once in the Supabase SQL editor before publishing the matching client code.
create or replace function public.submit_shop_order_with_referral_rewards(
  p_customer_name text, p_phone text, p_email text, p_fulfillment text,
  p_address text, p_note text, p_items jsonb, p_promotion_id uuid default null,
  p_coupon_code text default null, p_referral_value text default null,
  p_excluded_campaign_ids uuid[] default '{}'::uuid[]
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  result jsonb;
  placed_order public.orders%rowtype;
  referral public.customer_referrals%rowtype;
  reward_settings public.referral_reward_settings%rowtype;
  customer_coupon public.marketing_coupons%rowtype;
  referrer_coupon public.marketing_coupons%rowtype;
begin
  result := public.submit_shop_order(
    p_customer_name, p_phone, p_email, p_fulfillment, p_address, p_note,
    p_items, p_promotion_id, p_coupon_code, p_referral_value,
    p_excluded_campaign_ids
  );

  select * into placed_order from public.orders where id = (result->>'id')::uuid;
  select * into referral from public.customer_referrals where phone = p_phone;
  select * into reward_settings from public.referral_reward_settings where id = 1;

  if placed_order.promotion_kind = 'referral' then
    select * into customer_coupon from public.marketing_coupons
      where code = 'REF-' || upper(substr(md5(placed_order.id::text || 'new'), 1, 8));
    select * into referrer_coupon from public.marketing_coupons
      where code = 'REF-' || upper(substr(md5(placed_order.id::text || 'old'), 1, 8));
  end if;

  return result || jsonb_build_object(
    'referral_reward', jsonb_strip_nulls(jsonb_build_object(
      'referral_code', referral.referral_code,
      'referral_amount', referral.referral_amount,
      'referral_min_spend', referral.referral_min_spend,
      'referral_valid_days', referral.referral_valid_days,
      'reward_amount', coalesce(reward_settings.reward_amount, reward_settings.amount),
      'reward_min_spend', coalesce(reward_settings.reward_min_spend, reward_settings.min_spend),
      'reward_valid_days', coalesce(reward_settings.reward_valid_days, reward_settings.valid_days),
      'used_referral', placed_order.promotion_kind = 'referral',
      'your_reward_coupon', case when customer_coupon.code is not null then jsonb_build_object(
        'code', customer_coupon.code,
        'amount', customer_coupon.amount,
        'min_spend', customer_coupon.min_spend,
        'valid_days', case when customer_coupon.ends_at is null then 0 else greatest(0, ceil(extract(epoch from customer_coupon.ends_at - customer_coupon.created_at) / 86400))::integer end
      ) end,
      'referrer_reward_coupon', case when referrer_coupon.code is not null then jsonb_build_object(
        'code', referrer_coupon.code,
        'amount', referrer_coupon.amount,
        'min_spend', referrer_coupon.min_spend,
        'valid_days', case when referrer_coupon.ends_at is null then 0 else greatest(0, ceil(extract(epoch from referrer_coupon.ends_at - referrer_coupon.created_at) / 86400))::integer end
      ) end
    ))
  );
end $$;

grant execute on function public.submit_shop_order_with_referral_rewards(text,text,text,text,text,text,jsonb,uuid,text,text,uuid[]) to anon, authenticated;
