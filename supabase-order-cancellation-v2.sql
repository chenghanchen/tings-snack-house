-- Customer lookup and cancellation-request workflow (v2).
alter table public.orders
  add column if not exists cancellation_reason text,
  add column if not exists cancellation_stage text,
  add column if not exists cancellation_rejected_at timestamptz,
  add column if not exists cancellation_rejected_stage text;

alter table public.orders
  drop constraint if exists orders_cancellation_reason_length_check;
alter table public.orders
  add constraint orders_cancellation_reason_length_check
  check (cancellation_reason is null or char_length(cancellation_reason) between 1 and 100);

-- One field may be either an order number or a 10-digit phone number.
create or replace function public.lookup_customer_orders(p_query text)
returns setof public.orders
language sql security definer set search_path=public as $$
  select *
  from public.orders
  where case
    when trim(coalesce(p_query,'')) ~ '^[0-9]{10}$' then phone=trim(p_query)
    else order_number=upper(trim(p_query))
  end
  order by created_at desc;
$$;

-- A customer must re-enter the matching phone number and provide a reason.
create or replace function public.request_order_cancellation_v2(
  p_order_number text,
  p_phone text,
  p_reason text
)
returns boolean
language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  if trim(coalesce(p_phone,'')) !~ '^[0-9]{10}$' then
    raise exception '请输入 10 位手机号码';
  end if;
  if char_length(trim(coalesce(p_reason,''))) not between 1 and 100 then
    raise exception '取消原因需要填写，且不能超过 100 字';
  end if;

  update public.orders
  set cancellation_requested=true,
      cancellation_requested_at=now(),
      cancellation_reason=trim(p_reason),
      cancellation_stage=status,
      cancellation_rejected_at=null,
      cancellation_rejected_stage=null
  where order_number=upper(trim(p_order_number))
    and phone=trim(p_phone)
    and status in ('待确认','已确认')
    and coalesce(cancellation_requested,false)=false;

  get diagnostics changed=row_count;
  return changed=1;
end $$;

-- Rejecting a request keeps the original order active and preserves a red history node.
create or replace function public.owner_reject_cancellation(p_order_id uuid)
returns boolean
language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  if (auth.jwt()->>'email') <> 'chenghanchen1@gmail.com' then
    raise exception '无权操作';
  end if;

  update public.orders
  set cancellation_requested=false,
      cancellation_requested_at=null,
      cancellation_rejected_at=now(),
      cancellation_rejected_stage=coalesce(cancellation_stage,status)
  where id=p_order_id
    and cancellation_requested=true
    and status in ('待确认','已确认','等待取单','配送中');

  get diagnostics changed=row_count;
  return changed=1;
end $$;

grant execute on function public.lookup_customer_orders(text) to anon, authenticated;
grant execute on function public.request_order_cancellation_v2(text,text,text) to anon, authenticated;
grant execute on function public.owner_reject_cancellation(uuid) to authenticated;
