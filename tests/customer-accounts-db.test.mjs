import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite} = await import(process.env.TINGS_PGLITE_MODULE || '@electric-sql/pglite');
const source = (name) => readFile(new URL('../'+name, import.meta.url),'utf8');
const a='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000002';
const owner='00000000-0000-4000-8000-000000000003';

test('account migration: real PostgreSQL RLS, ownership, guest isolation, cancellation and replay checks', async t=>{
  const db=new PGlite();
  t.after(()=>db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    insert into auth.users values ('${a}','a@example.test',now()),('${b}','b@example.test',now()),
      ('${owner}','chenghanchen1@gmail.com',now());
    create table public.orders(id uuid primary key default gen_random_uuid(),order_number text,
      created_at timestamptz default now(),customer_name text,phone text,email text,fulfillment text,address text,
      items jsonb,subtotal numeric,discount_amount numeric default 0,tax_amount numeric default 0,
      delivery_fee numeric default 0,total_amount numeric,status text default '待确认',staff_note text,
      cancellation_requested boolean default false,cancellation_requested_at timestamptz,
      cancellation_reason text,cancellation_stage text,cancellation_rejected_at timestamptz,cancellation_rejected_stage text);
    create table public.products(id integer primary key,stock integer);
    insert into products values(1,100);
    grant select,insert,update,delete on public.orders,public.products to anon,authenticated;
    alter table orders enable row level security; alter table products enable row level security;
    create policy legacy_open_orders on orders for all using(true) with check(true);
    create policy legacy_open_products on products for all using(true) with check(true);
    -- These legacy SECURITY DEFINER endpoints were found in the live audit.
    create function public.cancel_customer_order(p_order_number text,p_phone text)
      returns boolean language plpgsql security definer as $$ begin
        update public.orders set status='已取消' where order_number=p_order_number and phone=p_phone;
        return found; end $$;
    create function public.lookup_customer_order(p_order_number text,p_phone text)
      returns setof public.orders language sql security definer as $$
        select * from public.orders where order_number=p_order_number and phone=p_phone $$;
    create function public.owner_update_order_note(p_order_id uuid,p_staff_note text) returns jsonb
      language plpgsql security definer as $$ begin
      if (auth.jwt()->>'email') <> 'chenghanchen1@gmail.com' then raise exception '无权操作'; end if;
      update public.orders set staff_note=p_staff_note where id=p_order_id;
      return '{}'::jsonb; end $$;
    create function public.submit_shop_order_with_referral_rewards(
      p_customer_name text,p_phone text,p_email text,p_fulfillment text,p_address text,p_note text,p_items jsonb,
      p_promotion_id uuid,p_coupon_code text,p_referral_value text,p_excluded_campaign_ids uuid[])
      returns jsonb language plpgsql security definer as $$ declare result_id uuid; begin
        update public.products set stock=stock-1 where id=1;
        insert into public.orders(order_number,customer_name,phone,email,fulfillment,address,items,subtotal,total_amount)
          values('TSH-'||gen_random_uuid(),p_customer_name,p_phone,p_email,p_fulfillment,p_address,p_items,5,5)
          returning id into result_id;
        return jsonb_build_object('id',result_id); end $$;
  `);
  await db.exec(await source('order-submission-protection-migration.sql'));
  const audit = (await db.query(await source('customer-accounts-preflight.sql'))).rows[0].account_preflight;
  assert.equal(audit.submission_function_ready, true);
  assert.ok(audit.order_columns.some(column => column.name === 'id'));
  assert.ok(audit.functions.some(fn => fn.name === 'owner_update_order_note' && fn.owner_guard_recognized));
  await db.exec(await source('customer-accounts-migration.sql'));
  // Additive migration is safe to rerun; no guest data is claimed or rewritten.
  await db.exec(await source('customer-accounts-migration.sql'));
  const role=async(name,id=null,email='')=>{
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(id?{sub:id,email}:{})]);
    await db.exec('set role '+name);
  };
  const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0]||{})[0];
  // Preserve a real v1 free-form address while installing v2, including safe reruns.
  await role('authenticated',a,'a@example.test');
  await db.query('select save_my_customer_details($1,$2,$3)',['Alice','3125550100','123 Legacy St, Chicago IL 60601']);
  await role('service_role');await db.exec('reset role');
  await db.exec(await source('customer-address-v2-migration.sql'));
  await db.exec(await source('customer-address-v2-migration.sql'));
  await role('authenticated',a,'a@example.test');
  assert.equal((await scalar('select get_my_customer_details()')).address,'123 Legacy St, Chicago IL 60601');
  await t.test('address v2: own fields only, read-only auth identity, validation and legacy compatibility',async()=>{
    const save='select save_my_customer_details_v2($1,$2,$3,$4,$5,$6,$7)';
    const fields=['Alice','3125550100','123 Main St','2B','Chicago','il','60601-1234'];
    const result=await scalar(save,fields);
    assert.deepEqual(result,{full_name:'Alice',phone:'3125550100',address:'123 Main St',unit:'2B',city:'Chicago',state:'IL',zip:'60601-1234'});
    for (const [index,value] of [[1,'bad'],[3,'X'.repeat(41)],[4,'X'.repeat(81)],[5,'ILL'],[6,'1234'],[2,'X'.repeat(500)]]) {
      const invalid=[...fields];invalid[index]=value;
      await assert.rejects(db.query(save,invalid),/格式不正确/);
      assert.deepEqual(await scalar('select get_my_customer_details()'),result);
    }
    await role('authenticated',b,'b@example.test');
    assert.equal((await scalar('select get_my_customer_details()')).unit,'');
    assert.equal((await db.query('select * from customer_addresses')).rows.length,0);
    await assert.rejects(db.query("update customer_addresses set zip='99999'"),/permission denied/);
    await assert.rejects(db.query("update auth.users set email='hacked@example.test'"),/permission denied/);
    await role('anon');
    for (const sql of ['select get_my_customer_orders(0)','select get_my_customer_details()',save])
      await assert.rejects(db.query(sql,sql===save?fields:[]),/permission denied/);
    await role('authenticated',a,'a@example.test');
    await db.query('select save_my_customer_details($1,$2,$3)',['Alice','3125550100','Legacy complete address']);
    assert.deepEqual(await scalar('select get_my_customer_details()'),{full_name:'Alice',phone:'3125550100',address:'Legacy complete address',unit:'',city:'',state:'',zip:''});
  });
  const submit=async(key,user)=>scalar(`select public.submit_shop_order_account(
    'Alice','3125550100','shared@example.test','delivery','Test address','',
    '[{"name":"Snack","qty":1}]'::jsonb,$1::uuid,$2::uuid)`,[key,user]);
  await t.test('retired cancellation and lookup endpoints reject both guests and customers',async()=>{
    for (const [name,id] of [['anon',null],['authenticated',a]]) {
      await role(name,id,'a@example.test');
      await assert.rejects(db.query('select cancel_customer_order($1,$2)',['TSH-ANY','3125550100']),/permission denied/);
      await assert.rejects(db.query('select * from lookup_customer_order($1,$2)',['TSH-ANY','3125550100']),/permission denied/);
      assert.equal(await scalar("select has_function_privilege(current_user,'public.submit_shop_order_idempotent(text,text,text,text,text,text,jsonb,uuid,uuid,text,text,uuid[])','EXECUTE')"),false);
    }
  });
  let orderA,orderB,guest;
  await t.test('verified owner stays owner; service alone assigns order identity',async()=>{
    await role('service_role');
    orderA=await submit('10000000-0000-4000-8000-000000000001',a);
    orderB=await submit('10000000-0000-4000-8000-000000000002',b);
    guest=await submit('10000000-0000-4000-8000-000000000003',null);
    await role('authenticated',a,'a@example.test');
    await assert.rejects(submit('10000000-0000-4000-8000-000000000004',b),/permission denied/);
    assert.equal(await scalar('select public.is_shop_account_owner()'),false);
    // Even forging the old email claim in this database test cannot become owner.
    await role('authenticated',a,'chenghanchen1@gmail.com');
    assert.equal(await scalar('select public.is_shop_account_owner()'),false);
    await assert.rejects(db.query('select owner_update_order_note($1,$2)',[orderB.id,'hacked']),/无权操作/);
    assert.equal((await db.query('update products set stock=999 returning id')).rows.length,0);
    await role('authenticated',owner,'chenghanchen1@gmail.com');
    assert.equal(await scalar('select public.is_shop_account_owner()'),true);
    await db.query('select owner_update_order_note($1,$2)',[orderA.id,'private note']);
  });
  await t.test('profiles and addresses are scoped by auth.uid, not supplied identity',async()=>{
    await role('authenticated',a,'a@example.test');
    await db.query('select save_my_customer_details($1,$2,$3)',['Alice','3125550100','A address']);
    await role('authenticated',b,'b@example.test');
    assert.deepEqual(await scalar('select get_my_customer_details()'),{full_name:'',phone:'',address:'',unit:'',city:'',state:'',zip:''});
    assert.equal((await db.query('select * from customer_profiles')).rows.length,0);
    assert.equal((await db.query('select * from customer_addresses')).rows.length,0);
    await assert.rejects(db.query('update customer_profiles set full_name=$1',['hacked']),/permission denied/);
    await assert.rejects(db.query('insert into shop_account_owners values($1)',[b]),/permission denied/);
    await assert.rejects(db.query('select save_my_customer_details($1,$2,$3)',['x','bad','']),/格式不正确/);
    await role('anon'); await assert.rejects(db.query('select get_my_customer_details()'),/permission denied/);
  });
  await t.test('own orders only; guest RPCs exclude account orders and empty lookup',async()=>{
    await role('authenticated',a,'a@example.test');
    const rows=await scalar('select get_my_customer_orders(0)');
    assert.deepEqual(rows.map(o=>o.id),[orderA.id]);
    assert.equal('staff_note' in rows[0],false);
    assert.equal((await db.query('select * from orders')).rows.length,0);
    await assert.rejects(db.query('select get_my_customer_orders(-1)'),/页码无效/);
    await role('anon');
    assert.deepEqual((await db.query("select id from lookup_customer_orders('3125550100')")).rows.map(o=>o.id),[guest.id]);
    assert.equal((await db.query("select id from lookup_customer_order_v2('','')")).rows.length,0);
    await assert.rejects(db.query('select owner_update_order_note($1,$2)',[guest.id,'hacked']),/permission denied/);
  });
  await t.test('account cancellation cannot cross users or use guest phone bypass',async()=>{
    await role('authenticated',b,'b@example.test');
    assert.equal(await scalar('select request_my_order_cancellation($1,$2)',[orderA.id,'test']),false);
    await role('authenticated',a,'a@example.test');
    assert.equal(await scalar('select request_my_order_cancellation($1,$2)',[orderA.id,'test']),true);
    assert.equal(await scalar('select request_my_order_cancellation($1,$2)',[orderA.id,'test']),false);
    await db.exec('reset role');
    const num=await scalar('select order_number from orders where id=$1',[orderB.id]);
    await role('anon');
    assert.equal(await scalar('select request_order_cancellation_v2($1,$2,$3)',[num,'3125550100','test']),false);
  });
  await t.test('idempotent replay preserves owner; account deletion does not turn orders public',async()=>{
    await role('service_role');
    const replay=await submit('10000000-0000-4000-8000-000000000001',a);
    assert.equal(replay.id,orderA.id); assert.equal(replay.idempotent_replay,true);
    for(const user of [b,null]) await assert.rejects(submit('10000000-0000-4000-8000-000000000001',user),/下单账户已改变/);
    await assert.rejects(submit('10000000-0000-4000-8000-000000000003',a),/下单账户已改变/);
    await db.exec('reset role');
    assert.equal(await scalar('select stock from products where id=1'),97);
    await assert.rejects(db.query('delete from auth.users where id=$1',[a]),/foreign key constraint/);
  });
});
