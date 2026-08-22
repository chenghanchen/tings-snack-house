-- Public aggregate only: no customer details are exposed to the storefront.
create or replace function public.get_public_product_sales()
returns table(product_id bigint, units_sold bigint)
language sql
stable
security definer
set search_path=public
as $$
  select
    (line.item->>'product_id')::bigint as product_id,
    sum(greatest(coalesce((line.item->>'qty')::integer, 0), 0))::bigint as units_sold
  from public.orders as o
  cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) as line(item)
  where coalesce(o.status, '待确认') <> '已取消'
    and line.item ? 'product_id'
    and (line.item->>'product_id') ~ '^[0-9]+$'
  group by (line.item->>'product_id')::bigint;
$$;

grant execute on function public.get_public_product_sales() to anon, authenticated;
