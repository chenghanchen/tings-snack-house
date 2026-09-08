-- Ting's Snack House: one read-only payload for the public storefront.
-- Safe to run repeatedly. Coupon rows are intentionally excluded because their
-- codes and recipient restrictions are not public catalogue data.
create or replace function public.get_storefront_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with product_sales as (
    select
      (line.item->>'product_id')::bigint as product_id,
      sum(greatest(coalesce((line.item->>'qty')::integer, 0), 0))::bigint as units_sold
    from public.orders as orders
    cross join lateral jsonb_array_elements(coalesce(orders.items, '[]'::jsonb)) as line(item)
    where coalesce(orders.status, '待确认') <> '已取消'
      and line.item ? 'product_id'
      and (line.item->>'product_id') ~ '^[0-9]+$'
    group by (line.item->>'product_id')::bigint
  )
  select jsonb_build_object(
    'schema_version', 1,
    'generated_at', current_timestamp,
    'settings', coalesce(
      (
        select jsonb_build_object(
          'id', settings.id,
          'name', settings.name,
          'english', settings.english,
          'delivery', settings.delivery,
          'delivery_fee', settings.delivery_fee,
          'free_delivery_threshold', settings.free_delivery_threshold,
          'tax_rate', settings.tax_rate,
          'low_stock_threshold', settings.low_stock_threshold,
          'is_accepting_orders', settings.is_accepting_orders,
          'pickup_address', settings.pickup_address,
          'pickup_note', settings.pickup_note,
          'order_paused_until', settings.order_paused_until,
          'heroEyebrow', settings.content->>'heroEyebrow',
          'heroTitle', settings.content->>'heroTitle',
          'heroEmphasis', settings.content->>'heroEmphasis',
          'heroIntro', settings.content->>'heroIntro',
          'heroButton', settings.content->>'heroButton',
          'deliveryEyebrow', settings.content->>'deliveryEyebrow',
          'deliveryTitle', settings.content->>'deliveryTitle',
          'footerHours', settings.content->>'footerHours',
          'footerYear', settings.content->>'footerYear',
          'deliveryBackgroundColor', settings.content->>'deliveryBackgroundColor',
          'deliveryBackgroundImage', settings.content->>'deliveryBackgroundImage',
          'heroBackgroundImage', settings.content->>'heroBackgroundImage',
          'storyBackgroundImage', settings.content->>'storyBackgroundImage',
          'storeSettings', settings.content->'storeSettings',
          'siteAppearance', settings.content->'siteAppearance',
          'footerAppearance', settings.content->'footerAppearance',
          'activityAnnouncementImage', settings.content->>'activityAnnouncementImage'
        )
        from public.shop_settings as settings
        where settings.id = 1
      ),
      'null'::jsonb
    ),
    'products', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', product.id,
            'name', product.name,
            'note', product.note,
            'type', product.type,
            'price', product.price,
            'stock', product.stock,
            'is_out_of_stock', product.is_out_of_stock,
            'icon', product.icon,
            'color', product.color,
            'image', product.image,
            'position', product.position,
            'is_active', product.is_active
          )
          order by product.position, product.id
        )
        from public.products as product
        where product.is_active = true
      ),
      '[]'::jsonb
    ),
    'categories', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', category.id,
            'name', category.name,
            'position', category.position,
            'is_system', category.is_system
          )
          order by category.position, category.id
        )
        from public.categories as category
      ),
      '[]'::jsonb
    ),
    'option_groups', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', option_group.id,
            'product_id', option_group.product_id,
            'name', option_group.name,
            'position', option_group.position
          )
          order by option_group.position, option_group.id
        )
        from public.product_option_groups as option_group
        join public.products as product
          on product.id = option_group.product_id
         and product.is_active = true
      ),
      '[]'::jsonb
    ),
    'option_values', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', option_value.id,
            'group_id', option_value.group_id,
            'name', option_value.name,
            'position', option_value.position
          )
          order by option_value.position, option_value.id
        )
        from public.product_option_values as option_value
        join public.product_option_groups as option_group
          on option_group.id = option_value.group_id
        join public.products as product
          on product.id = option_group.product_id
         and product.is_active = true
      ),
      '[]'::jsonb
    ),
    'variants', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', variant.id,
            'product_id', variant.product_id,
            'option_key', variant.option_key,
            'option_values', variant.option_values,
            'price', variant.price,
            'stock', variant.stock,
            'is_out_of_stock', variant.is_out_of_stock,
            'image', variant.image,
            'position', variant.position
          )
          order by variant.position, variant.id
        )
        from public.product_variants as variant
        join public.products as product
          on product.id = variant.product_id
         and product.is_active = true
      ),
      '[]'::jsonb
    ),
    'product_sales', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'product_id', sales.product_id,
            'units_sold', sales.units_sold
          )
          order by sales.product_id
        )
        from product_sales as sales
        join public.products as product
          on product.id = sales.product_id
         and product.is_active = true
      ),
      '[]'::jsonb
    ),
    'campaigns', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', campaign.id,
            'kind', campaign.kind,
            'name', campaign.name,
            'active', campaign.active,
            'starts_at', campaign.starts_at,
            'ends_at', campaign.ends_at,
            'discount_kind', campaign.discount_kind,
            'threshold', campaign.threshold,
            'amount', campaign.amount,
            'product_ids', campaign.product_ids,
            'category_names', campaign.category_names,
            'status', to_jsonb(campaign)->'status',
            'customer_scope', to_jsonb(campaign)->'customer_scope',
            'allow_coupon_stack', to_jsonb(campaign)->'allow_coupon_stack'
          )
          order by campaign.created_at, campaign.id
        )
        from public.marketing_campaigns as campaign
        where campaign.active = true
          and coalesce(to_jsonb(campaign)->>'status', 'published') = 'published'
          and (campaign.starts_at is null or campaign.starts_at <= current_timestamp)
          and (campaign.ends_at is null or campaign.ends_at >= current_timestamp)
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.get_storefront_snapshot() is
  'Read-only public storefront data. Explicitly excludes coupon and customer data.';

revoke all on function public.get_storefront_snapshot() from public;
grant execute on function public.get_storefront_snapshot() to anon, authenticated;
