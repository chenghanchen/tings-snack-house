-- Timed pause for new orders. The shop automatically reopens when a customer or owner page next checks the setting.
alter table public.shop_settings add column if not exists order_paused_until timestamptz;

create or replace function public.refresh_shop_order_availability()
returns boolean language plpgsql security definer set search_path=public as $$
declare accepting boolean; paused_until timestamptz;
begin
  select is_accepting_orders, order_paused_until into accepting, paused_until
  from public.shop_settings where id=1 for update;
  if accepting=false and paused_until is not null and paused_until<=now() then
    update public.shop_settings set is_accepting_orders=true, order_paused_until=null, updated_at=now() where id=1;
    return true;
  end if;
  return coalesce(accepting,true);
end $$;

grant execute on function public.refresh_shop_order_availability() to anon, authenticated;
