-- Store the destination address displayed in owner settings for new-order notifications.
alter table public.shop_settings add column if not exists new_order_email text;
