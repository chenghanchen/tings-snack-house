-- Lock referral tables to the owner and expose only a minimal, read-only
-- referral-code preview RPC to the public storefront.
-- Run this migration before publishing the matching app.js version.

alter table public.referral_reward_settings enable row level security;
alter table public.customer_referrals enable row level security;

drop policy if exists "owner manages referral reward settings"
  on public.referral_reward_settings;
drop policy if exists "admin manages referral reward settings"
  on public.referral_reward_settings;
drop policy if exists "owner reads referrals"
  on public.customer_referrals;
drop policy if exists "owner manages referrals"
  on public.customer_referrals;
drop policy if exists "admin manages referrals"
  on public.customer_referrals;

-- Table access is denied to signed-out visitors. Signed-in users retain the
-- SQL grants required by PostgREST, while RLS limits every row operation to
-- the configured owner account.
revoke all on table public.referral_reward_settings from public, anon, authenticated;
revoke all on table public.customer_referrals from public, anon, authenticated;

grant select, insert, update, delete
  on table public.referral_reward_settings to authenticated;
grant select, insert, update, delete
  on table public.customer_referrals to authenticated;

create policy "owner manages referral reward settings"
on public.referral_reward_settings
for all
to authenticated
using ((select auth.jwt() ->> 'email') = 'chenghanchen1@gmail.com')
with check ((select auth.jwt() ->> 'email') = 'chenghanchen1@gmail.com');

create policy "owner manages referrals"
on public.customer_referrals
for all
to authenticated
using ((select auth.jwt() ->> 'email') = 'chenghanchen1@gmail.com')
with check ((select auth.jwt() ->> 'email') = 'chenghanchen1@gmail.com');

create or replace function public.preview_referral_offer(
  p_code text,
  p_phone text,
  p_subtotal numeric,
  p_campaign_discount numeric default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cleaned_code text := upper(trim(coalesce(p_code, '')));
  cleaned_phone text := trim(coalesce(p_phone, ''));
  safe_subtotal numeric := greatest(coalesce(p_subtotal, 0), 0);
  safe_campaign_discount numeric := greatest(coalesce(p_campaign_discount, 0), 0);
  referral_row record;
  prior_orders bigint := 0;
  referral_uses bigint := 0;
  eligible boolean := false;
  discount_value numeric := 0;
begin
  -- Generated referral codes use this exact format. Reject unrelated input
  -- before touching protected tables.
  if cleaned_code !~ '^TSHREF-[A-F0-9]{8}$' then
    return jsonb_build_object(
      'is_referral', false,
      'valid', false,
      'discount', 0
    );
  end if;

  select
    r.created_at,
    coalesce(r.referral_amount, s.referral_amount, s.amount, 5) as amount,
    coalesce(r.referral_min_spend, s.referral_min_spend, s.min_spend, 35) as min_spend,
    coalesce(r.referral_valid_days, s.referral_valid_days, s.valid_days, 0) as valid_days,
    coalesce(r.referral_max_uses, s.referral_max_uses, 0) as max_uses
  into referral_row
  from public.customer_referrals as r
  cross join public.referral_reward_settings as s
  where s.id = 1
    and r.referral_code = cleaned_code
  limit 1;

  if not found then
    return jsonb_build_object(
      'is_referral', false,
      'valid', false,
      'discount', 0
    );
  end if;

  if cleaned_phone ~ '^[0-9]{10}$' then
    select count(*)
      into prior_orders
      from public.orders
      where phone = cleaned_phone;

    select count(*)
      into referral_uses
      from public.orders
      where coupon_code = cleaned_code;

    eligible :=
      prior_orders = 0
      and (
        referral_row.valid_days <= 0
        or referral_row.created_at
          + make_interval(days => referral_row.valid_days) > now()
      )
      and (
        referral_row.max_uses <= 0
        or referral_uses < referral_row.max_uses
      )
      and safe_subtotal >= referral_row.min_spend;
  end if;

  if eligible then
    discount_value := least(
      referral_row.amount,
      greatest(safe_subtotal - safe_campaign_discount, 0)
    );
  end if;

  return jsonb_build_object(
    'is_referral', true,
    'valid', eligible,
    'discount', round(discount_value, 2)
  );
end;
$$;

-- PostgreSQL grants function execution to PUBLIC by default. Remove that
-- implicit access first, then explicitly expose only this narrow RPC.
revoke execute on function public.preview_referral_offer(text, text, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.preview_referral_offer(text, text, numeric, numeric)
  to anon, authenticated;
