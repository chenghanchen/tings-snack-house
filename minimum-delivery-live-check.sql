-- Production-safe verification for the server-side minimum-delivery guard.
-- Run in the Supabase SQL Editor. The attempted order must fail, its statement
-- changes are rolled back by PostgreSQL, and the outer transaction is rolled
-- back as a final safety net.

begin;

do $check$
declare
  min_order numeric(10, 2);
  min_delivery numeric(10, 2);
  candidate record;
  stock_before integer;
  stock_after integer;
  test_key uuid := gen_random_uuid();
  test_note text := 'minimum-delivery-preflight:' || test_key::text;
  server_error text;
begin
  select
    coalesce(nullif(content->'storeSettings'->'order'->>'minOrder', '')::numeric, 20),
    greatest(
      coalesce(nullif(content->'storeSettings'->'order'->>'minOrder', '')::numeric, 20),
      coalesce(nullif(content->'storeSettings'->'delivery'->>'minDelivery', '')::numeric, 30)
    )
  into min_order, min_delivery
  from public.shop_settings
  where id = 1;

  if min_delivery <= min_order then
    raise exception 'CHECK SETUP FAILED: minimum delivery (%) must exceed minimum order (%)',
      min_delivery, min_order;
  end if;

  with priced as (
    select
      p.id,
      p.name,
      p.price,
      p.stock,
      greatest(p.price - coalesce((
        select max(least(p.price, case
          when c.discount_kind = 'percent' then round(p.price * c.amount / 100, 2)
          else c.amount
        end))
        from public.marketing_campaigns c
        where c.active = true
          and (c.status is null or c.status = 'published')
          and c.kind in ('product_discount', 'category_discount')
          and (c.starts_at is null or c.starts_at <= now())
          and (c.ends_at is null or c.ends_at >= now())
          and (
            cardinality(c.product_ids) = 0 and cardinality(c.category_names) = 0
            or cardinality(c.product_ids) > 0 and p.id = any(c.product_ids)
            or cardinality(c.category_names) > 0 and p.type = any(c.category_names)
          )
      ), 0), 0) as effective_price
    from public.products p
    where p.is_active = true
      and coalesce(p.is_out_of_stock, false) = false
      and p.stock > 0
      and p.price > 0
  ), candidates as (
    select priced.*, ceil(min_order / effective_price)::integer as qty
    from priced
    where effective_price > 0
  )
  select id, name, price, effective_price, stock, qty
  into candidate
  from candidates
  where qty >= 1
    and stock >= qty
    and effective_price * qty >= min_order
    and effective_price * qty < min_delivery
  order by effective_price desc, id
  limit 1;

  if not found then
    raise exception 'CHECK SETUP FAILED: no in-stock item quantity produces a subtotal between % and %',
      min_order, min_delivery;
  end if;

  stock_before := candidate.stock;

  begin
    perform public.submit_shop_order_account(
      p_customer_name => 'Minimum delivery preflight',
      p_phone => '3125550199',
      p_email => 'preflight@example.invalid',
      p_fulfillment => 'delivery',
      p_address => 'Preflight only; transaction is rolled back',
      p_note => test_note,
      p_items => jsonb_build_array(jsonb_build_object(
        'product_id', candidate.id,
        'qty', candidate.qty
      )),
      p_idempotency_key => test_key,
      p_user_id => null,
      p_promotion_id => null,
      p_coupon_code => null,
      p_referral_value => null,
      p_excluded_campaign_ids => '{}'::uuid[]
    );
  exception when others then
    server_error := sqlerrm;
  end;

  if server_error is null then
    raise exception 'CHECK FAILED: server accepted a delivery order below %', min_delivery;
  end if;
  if position('没有达到最低配送$' in server_error) <> 1 then
    raise exception 'CHECK FAILED: unexpected server response: %', server_error;
  end if;

  select stock into stock_after
  from public.products
  where id = candidate.id;

  if stock_after is distinct from stock_before then
    raise exception 'CHECK FAILED: product stock changed from % to %', stock_before, stock_after;
  end if;
  if exists (
    select 1 from public.order_submission_idempotency
    where idempotency_key = test_key
  ) then
    raise exception 'CHECK FAILED: idempotency record was persisted';
  end if;
  if exists (
    select 1 from public.orders
    where customer_note = test_note
  ) then
    raise exception 'CHECK FAILED: test order was persisted';
  end if;

  raise notice 'PASS: server rejected % ($% x %) below delivery minimum $%; no order, idempotency record, or stock change persisted.',
    candidate.name, candidate.effective_price, candidate.qty, min_delivery;
end
$check$;

rollback;
