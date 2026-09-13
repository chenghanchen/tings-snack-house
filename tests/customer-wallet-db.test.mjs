import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const {PGlite}=await import(process.env.TINGS_PGLITE_MODULE||'@electric-sql/pglite');
const source=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',owner='00000000-0000-4000-8000-000000000003';
test('account referrals: completion rewards, guest eligibility, ownership and atomic checkout',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    insert into auth.users values('${a}','a@example.test',now()),('${b}','b@example.test',now()),('${owner}','chenghanchen1@gmail.com',now());
    create table products(id bigint primary key,name text,price numeric,type text,image text,icon text,is_active boolean default true,is_out_of_stock boolean default false,stock integer default 100,updated_at timestamptz);
    create table product_variants(id bigint primary key,product_id bigint,price numeric,stock integer,is_out_of_stock boolean,option_values jsonb,image text,updated_at timestamptz);
    create table shop_settings(id integer primary key,tax_rate numeric,delivery_fee numeric,free_delivery_threshold numeric,content jsonb);
    insert into products(id,name,price,type) values(1,'Snack',40,'snack');
    insert into shop_settings values(1,0,4,60,'{"storeSettings":{"order":{"minOrder":0},"delivery":{"minDelivery":0}}}');
    create table orders(id uuid primary key default gen_random_uuid(),order_number text,created_at timestamptz default now(),
      customer_name text,phone text,email text,fulfillment text,address text,customer_note text,items jsonb,subtotal numeric,
      tax_rate numeric,tax_amount numeric,delivery_fee numeric,total_amount numeric,status text default '待确认',archived boolean,
      cancellation_requested boolean default false,cancellation_requested_at timestamptz,cancellation_reason text,
      cancellation_stage text,cancellation_rejected_at timestamptz,cancellation_rejected_stage text);
  `);
  for(const file of ['marketing-migration.sql','stacked-offers-referrals-migration.sql','success-referral-rewards-migration.sql','order-submission-protection-migration.sql','customer-accounts-migration.sql','customer-address-v2-migration.sql'])
    await db.exec(await source(file));
  await db.exec("alter table marketing_campaigns add column status text default 'published',add column allow_coupon_stack boolean default true");
  await db.exec(`insert into marketing_coupons(code,name,amount,min_spend,recipient_phone,is_referral_reward) values('REF-LEGACY','Legacy',5,30,'3125550123',true);
    insert into customer_referrals(phone,referral_code) values('3125550123','TSHREF-1234ABCD');`);
  await db.exec(await source('customer-wallet-migration.sql'));
  await db.exec(await source('customer-wallet-migration.sql'));
  const role=async(name,id=null)=>{
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(id?{sub:id,email:id===owner?'chenghanchen1@gmail.com':'customer@example.test'}:{})]);
    await db.exec('set role '+name);
  };
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
  const wallet=()=>scalar('select get_my_customer_wallet()');
  const submit=(code,user=b,email='guest@example.test',phone='3125550100',key=randomUUID())=>scalar(`select submit_shop_order_account(
    'Customer',$1,$2,'pickup','','','[{"product_id":1,"qty":1}]',$3,$4,null,$5)`,[phone,email,key,user,code]);
  const complete=async(id,status='已完成')=>{await db.exec('reset role');await db.query('update orders set status=$2 where id=$1',[id,status]);};
  const countRewards=async()=>{await db.exec('reset role');return Number(await scalar("select count(*) from marketing_coupons where source='referral'"));};
  await role('authenticated',a);const codeA=(await wallet()).referral_codes[0].code;
  await role('authenticated',b);const codeB=(await wallet()).referral_codes[0].code;
  let placed,reward;
  await t.test('verified accounts have one immutable code; shipping phones claim nothing',async()=>{
    assert.notEqual(codeA,codeB);assert.match(codeA,/^TSHREF-[A-F0-9]{32}$/);
    await role('authenticated',a);
    await scalar("select save_my_customer_details('A','3125550123','')");
    assert.equal((await wallet()).coupons.length,0);
    assert.equal((await wallet()).referral_codes[0].code,codeA);
    assert.equal('phone_masked' in await wallet(),false);
    await db.exec('reset role');
    assert.equal(await scalar("select referrer_user_id from customer_referrals where referral_code='TSHREF-1234ABCD'"),null);
    await assert.rejects(db.query("update customer_referrals set referrer_user_id=$1 where referral_code=$2",[b,codeA]),/不可转让/);
    const d=randomUUID();
    await db.query('insert into auth.users values($1,$2,null)',[d,'new@example.test']);
    assert.equal(Number(await scalar('select count(*) from customer_referrals where referrer_user_id=$1',[d])),0);
    await db.query('update auth.users set email_confirmed_at=now() where id=$1',[d]);
    assert.equal(Number(await scalar('select count(*) from customer_referrals where referrer_user_id=$1',[d])),1);
    await role('anon');await assert.rejects(wallet(),/permission denied/);
  });
  await t.test('self-referrals and legacy phone rewards are denied on the real order path',async()=>{
    await role('service_role');
    await assert.rejects(submit(codeA,a),/不能自荐/);
    await assert.rejects(submit(codeA,null,' A@EXAMPLE.TEST '),/不能自荐/);
    await assert.rejects(submit(codeA,null,''),/游客请填写邮箱/);
    await assert.rejects(submit('TSHREF-1234ABCD'),/无效/);
    await assert.rejects(submit('REF-LEGACY',a,'a@example.test','3125550123'),/不属于此账户/);
  });
  await t.test('authenticated order uses verified email; pending order grants discount but no reward',async()=>{
    await role('service_role');const key=randomUUID();
    placed=await submit(codeA,b,'forged@example.test','3125550100',key);
    assert.equal(Number(placed.discount_amount),5);assert.equal(Number(placed.total_amount),35);
    assert.equal(placed.referral_reward.pending,true);assert.equal(placed.referral_reward.referral_code,codeB);
    assert.equal((await submit(codeA,b,'forged@example.test','3125550100',key)).idempotent_replay,true);
    await assert.rejects(submit(codeA,b,'different@example.test','3125559999'),/重复使用/);
    await assert.rejects(submit(codeA,a,'forged@example.test','3125550100',key),/账户已改变/);
    assert.equal(await countRewards(),0);
    assert.equal(await scalar('select email from orders where id=$1',[placed.id]),'b@example.test');
    assert.equal(Number(await scalar('select count(*) from referral_events')),1);
  });
  await t.test('completion grants exactly one account-owned $5/$30 coupon for 90 days',async()=>{
    await complete(placed.id);
    assert.equal(await countRewards(),1);
    await complete(placed.id,'已配送');await complete(placed.id,'已取货');
    assert.equal(await countRewards(),1);
    reward=(await db.query("select * from marketing_coupons where source='referral'")).rows[0];
    assert.equal(reward.claimed_by_user_id,a);assert.equal(reward.recipient_phone,null);
    assert.equal(Number(reward.amount),5);assert.equal(Number(reward.min_spend),30);
    assert.ok(Math.abs((new Date(reward.ends_at)-new Date(reward.created_at))/86400000-90)<0.01);
    await role('authenticated',a);
    assert.equal((await wallet()).coupons[0].code,reward.code);
    assert.equal((await wallet()).history[0].status,'奖励已发放');
    assert.ok(!JSON.stringify(await wallet()).includes('b@example.test'));
    await role('authenticated',b);assert.equal((await wallet()).coupons.length,0);
    await role('service_role');
    await assert.rejects(submit(reward.code,b),/不属于此账户/);
    await assert.rejects(submit(reward.code,null,'other@example.test'),/不属于此账户/);
    const redeemed=await submit(reward.code,a,'ignored@example.test','7735550188');
    assert.equal(Number(redeemed.discount_amount),5);
    await assert.rejects(submit(reward.code,a,'ignored@example.test','7735550199'),/不属于此账户/);
    await role('authenticated',a);
    assert.equal((await wallet()).coupons[0].uses[0].order_number,redeemed.order_number);
    await scalar("select save_my_customer_details('A','9995550123','')");
    assert.equal((await wallet()).coupons[0].status,'used');
  });
  await t.test('guest is eligible without an account, gains no code; cancellation releases pending eligibility',async()=>{
    await role('service_role');
    const guest=await submit(codeA,null,'guest2@example.test','7735550111');
    assert.equal(guest.referral_reward.referral_code,null);
    await assert.rejects(submit(codeA,null,' GUEST2@EXAMPLE.TEST ','7735550112'),/重复使用/);
    await assert.rejects(submit(codeA,null,'other-guest@example.test','7735550111'),/重复使用/);
    await complete(guest.id,'已取消');
    assert.equal(await countRewards(),1);
    await role('service_role');
    const retry=await submit(codeA,null,'guest2@example.test','7735550111');
    await complete(retry.id,'已完成');
    assert.equal(await countRewards(),2);
    const guestReward=await scalar('select reward_coupon_id from referral_events where referred_order_id=$1',[retry.id]);
    await complete(retry.id,'已取消');
    assert.equal(await scalar('select active from marketing_coupons where id=$1',[guestReward]),false);
    await complete(retry.id,'已完成');
    assert.equal(await countRewards(),2);
    // Registering later generates a code but neither claims guest orders nor resets the benefit.
    const registered=randomUUID();
    await db.query('insert into auth.users values($1,$2,now())',[registered,'guest2@example.test']);
    assert.equal(await scalar('select user_id from orders where id=$1',[retry.id]),null);
    await role('service_role');
    await assert.rejects(submit(codeA,registered,'ignored@example.test','7735550666'),/重复使用/);
  });
  await t.test('previous completed orders block newcomer benefit even without a prior referral',async()=>{
    await role('service_role');
    const existing=await submit(null,null,'existing@example.test','7735550333');
    await complete(existing.id,'已完成');
    await role('service_role');
    await assert.rejects(submit(codeA,null,'EXISTING@example.test','7735550444'),/新客/);
    await assert.rejects(submit(codeA,null,'another@example.test','7735550333'),/新客/);
    await db.exec('reset role');
    await db.exec('update products set price=20 where id=1');
    const before=Number(await scalar('select stock from products where id=1'));
    await role('service_role');await assert.rejects(submit(codeA,null,'small@example.test','7735550888'),/满 \$30/);
    await db.exec('reset role');
    assert.equal(Number(await scalar('select stock from products where id=1')),before);
    await db.exec('update products set price=40 where id=1');
  });
  await t.test('published percentage coupons remain usable; account and endpoint guards hold',async()=>{
    await db.exec('reset role');
    await db.exec("insert into marketing_coupons(code,name,amount,min_spend,total_quantity,discount_kind) values('TENPCT','10 percent',10,30,10,'percent')");
    await role('authenticated',a);
    assert.equal(Number((await scalar("select preview_account_offer('TENPCT','','',40,0)")).discount),4);
    assert.equal((await db.query('select * from referral_events')).rows.length,0);
    await assert.rejects(db.query("update marketing_coupons set claimed_by_user_id=$1",[b]),/permission denied/);
    await assert.rejects(submit(codeB,a),/permission denied/);
    await role('service_role');
    assert.equal(Number((await submit('TENPCT',a)).discount_amount),4);
    await assert.rejects(submit('TENPCT',a,'new@example.test','2125550999'),/不属于此账户/);
    await role('anon');
    assert.equal((await scalar('select preview_account_offer($1,$2,$3,40,0)',[codeA,'a@example.test','2125550011'])).valid,false);
  });
});
