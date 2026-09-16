-- Read-only readiness evidence. No customer rows, keys or Storage objects read.
-- Run in the intended project's SQL Editor before authorizing migration.
begin transaction read only;
set local statement_timeout = '10s';
select current_user as migration_role,
       current_setting('transaction_isolation') as isolation,
       has_schema_privilege(current_user, 'public', 'CREATE') as can_create_public;
select n.nspname as schema_name, c.relname as table_name,
       pg_get_userbyid(c.relowner) as table_owner,
       has_table_privilege(current_user, c.oid, 'TRIGGER') as can_create_trigger,
       has_table_privilege(current_user, c.oid, 'SELECT') as can_read_references
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where (n.nspname='public' and c.relname in ('products','product_variants','shop_settings','orders'))
   or (n.nspname='storage' and c.relname='objects')
order by schema_name,table_name;
select table_schema,table_name,column_name,data_type
from information_schema.columns
where (table_schema='public' and ((table_name in ('products','product_variants') and column_name='image')
  or (table_name='shop_settings' and column_name='content') or (table_name='orders' and column_name='items')))
  or (table_schema='storage' and table_name='objects' and column_name in ('name','bucket_id'))
order by table_schema,table_name,column_name;
select n.nspname as schema_name,c.relname as table_name,t.tgname,t.tgenabled
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where t.tgname in ('media_reference_lock','media_reference_guard','media_storage_write_guard')
order by schema_name,table_name,t.tgname;
select to_regclass('public.media_retired_paths') is not null as fence_table_present,
       to_regprocedure('public.reserve_orphan_media(text[])') is not null as reservation_rpc_present;
rollback;
