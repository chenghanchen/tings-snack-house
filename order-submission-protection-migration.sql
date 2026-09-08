-- Run after success-referral-rewards-migration.sql.
-- Stage 1 adds atomic idempotency and rate-limit primitives. The old public
-- order RPCs remain available until the Edge Function and frontend are live.

create table if not exists public.order_submission_idempotency (
  idempotency_key uuid primary key,
  request_fingerprint text not null,
  order_id uuid not null unique references public.orders(id),
  response jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.order_submission_idempotency enable row level security;
revoke all on table public.order_submission_idempotency
  from public, anon, authenticated;
grant select, insert on table public.order_submission_idempotency to service_role;

create table if not exists public.order_submission_rate_limits (
  identifier_hash text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.order_submission_rate_limits enable row level security;
revoke all on table public.order_submission_rate_limits
  from public, anon, authenticated;
grant select, insert, update, delete on table public.order_submission_rate_limits
  to service_role;

create or replace function public.check_order_submission_rate_limit(
  p_identifier_hash text,
  p_max_requests integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.order_submission_rate_limits%rowtype;
begin
  if p_identifier_hash !~ '^[a-f0-9]{64}$'
    or p_max_requests < 1
    or p_window_seconds < 1 then
    raise exception '限流参数无效';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_identifier_hash, 17));
  select * into current_row
  from public.order_submission_rate_limits
  where identifier_hash = p_identifier_hash
  for update;

  if not found
    or current_row.window_started_at <= now() - make_interval(secs => p_window_seconds) then
    insert into public.order_submission_rate_limits(
      identifier_hash, window_started_at, request_count, updated_at
    ) values (p_identifier_hash, now(), 1, now())
    on conflict (identifier_hash) do update
      set window_started_at = excluded.window_started_at,
          request_count = 1,
          updated_at = excluded.updated_at;
    return true;
  end if;

  if current_row.request_count >= p_max_requests then
    return false;
  end if;

  update public.order_submission_rate_limits
  set request_count = request_count + 1, updated_at = now()
  where identifier_hash = p_identifier_hash;
  return true;
end;
$$;

revoke all on function public.check_order_submission_rate_limit(text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.check_order_submission_rate_limit(text,integer,integer)
  to service_role;

create or replace function public.submit_shop_order_idempotent(
  p_customer_name text,
  p_phone text,
  p_email text,
  p_fulfillment text,
  p_address text,
  p_note text,
  p_items jsonb,
  p_idempotency_key uuid,
  p_promotion_id uuid default null,
  p_coupon_code text default null,
  p_referral_value text default null,
  p_excluded_campaign_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  fingerprint text;
  prior public.order_submission_idempotency%rowtype;
  result jsonb;
begin
  if p_idempotency_key is null then
    raise exception '缺少订单幂等键';
  end if;

  fingerprint := md5(jsonb_build_object(
    'customer_name', p_customer_name,
    'phone', p_phone,
    'email', p_email,
    'fulfillment', p_fulfillment,
    'address', p_address,
    'note', p_note,
    'items', p_items,
    'promotion_id', p_promotion_id,
    'coupon_code', p_coupon_code,
    'referral_value', p_referral_value,
    'excluded_campaign_ids', p_excluded_campaign_ids
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 29));
  select * into prior
  from public.order_submission_idempotency
  where idempotency_key = p_idempotency_key;

  if found then
    if prior.request_fingerprint <> fingerprint then
      raise exception '该幂等键已用于其他订单';
    end if;
    return prior.response || jsonb_build_object('idempotent_replay', true);
  end if;

  result := public.submit_shop_order_with_referral_rewards(
    p_customer_name,
    p_phone,
    p_email,
    p_fulfillment,
    p_address,
    p_note,
    p_items,
    p_promotion_id,
    p_coupon_code,
    p_referral_value,
    p_excluded_campaign_ids
  );

  insert into public.order_submission_idempotency(
    idempotency_key, request_fingerprint, order_id, response
  ) values (
    p_idempotency_key,
    fingerprint,
    (result ->> 'id')::uuid,
    result
  );

  return result;
end;
$$;

revoke all on function public.submit_shop_order_idempotent(
  text,text,text,text,text,text,jsonb,uuid,uuid,text,text,uuid[]
) from public, anon, authenticated;
grant execute on function public.submit_shop_order_idempotent(
  text,text,text,text,text,text,jsonb,uuid,uuid,text,text,uuid[]
) to service_role;

