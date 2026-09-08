-- Run only after the submit-order Edge Function and frontend have been
-- deployed and verified. This prevents callers from bypassing rate limiting.

-- Historical 10-argument overload left by marketing-auto-best-migration.sql.
revoke all on function public.submit_shop_order(
  text,text,text,text,text,text,jsonb,uuid,text,text
) from public, anon, authenticated;

revoke all on function public.submit_shop_order(
  text,text,text,text,text,text,jsonb,uuid,text,text,uuid[]
) from public, anon, authenticated;

revoke all on function public.submit_shop_order_with_referral_rewards(
  text,text,text,text,text,text,jsonb,uuid,text,text,uuid[]
) from public, anon, authenticated;

grant execute on function public.submit_shop_order(
  text,text,text,text,text,text,jsonb,uuid,text,text
) to service_role;

grant execute on function public.submit_shop_order(
  text,text,text,text,text,text,jsonb,uuid,text,text,uuid[]
) to service_role;

grant execute on function public.submit_shop_order_with_referral_rewards(
  text,text,text,text,text,text,jsonb,uuid,text,text,uuid[]
) to service_role;
