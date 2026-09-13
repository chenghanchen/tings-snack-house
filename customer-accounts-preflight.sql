-- Read-only deployment audit. Returns schema/permission metadata, not order data,
-- user records, API keys, or function bodies. Export the single result row as CSV.
select jsonb_build_object(
  'tables_and_views', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', c.relname, 'kind', c.relkind,
      'rls', c.relrowsecurity, 'options', c.reloptions,
      'anon_read', has_table_privilege('anon', c.oid, 'SELECT'),
      'customer_read', has_table_privilege('authenticated', c.oid, 'SELECT'),
      'customer_insert', has_table_privilege('authenticated', c.oid, 'INSERT'),
      'customer_update', has_table_privilege('authenticated', c.oid, 'UPDATE'),
      'customer_delete', has_table_privilege('authenticated', c.oid, 'DELETE')
    ) order by n.nspname, c.relname), '[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','f')
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname, 'table', tablename, 'name', policyname,
      'mode', permissive, 'roles', roles, 'command', cmd,
      'using', qual, 'check', with_check
    ) order by schemaname, tablename, policyname), '[]'::jsonb)
    from pg_policies where schemaname in ('public','storage')
  ),
  'functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.proname, 'signature', p.oid::regprocedure::text,
      'result', pg_get_function_result(p.oid),
      'security_definer', p.prosecdef,
      'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'customer_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'mentions_orders', p.prosrc ~* '\morders\M',
      'owner_guard_recognized', case when p.proname like 'owner\_%' escape '\' then
        p.prosrc ~ '\(auth\.jwt\(\)\s*->>\s*''email''\)\s*<>\s*''chenghanchen1@gmail.com'''
        or position('public.is_shop_account_owner() is not true' in p.prosrc)>0
        else null end
    ) order by p.proname, p.oid::regprocedure::text), '[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
        and d.objid=p.oid and d.deptype='e')
  ),
  'order_columns', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', column_name, 'type', udt_name, 'nullable', is_nullable
    ) order by ordinal_position), '[]'::jsonb)
    from information_schema.columns where table_schema='public' and table_name='orders'
  ),
  'submission_function_ready', to_regprocedure(
    'public.submit_shop_order_idempotent(text,text,text,text,text,text,jsonb,uuid,uuid,text,text,uuid[])'
  ) is not null
) as account_preflight;
