-- Retire holiday and temporary free-delivery campaigns without changing order history.
update public.marketing_campaigns
set active = false, updated_at = now()
where kind in ('holiday', 'free_shipping') and active = true;
