import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { deleteOrphanFilesSafely } from '../supabase/functions/admin-media-cleanup/media-cleanup-core.mjs';
const migration = readFileSync(new URL('../media-deletion-guard-migration.sql',import.meta.url),'utf8');
const retryMigration = readFileSync(new URL('../media-deletion-retry-migration.sql',import.meta.url),'utf8');
test('incremental retry function matches the full migration',()=>{
  const body=s=>s.slice(s.indexOf('create or replace function public.reserve_orphan_media'),s.indexOf('revoke all on function public.reserve_orphan_media'));
  assert.equal(body(migration),body(retryMigration));
});
const base='https://ragqunnuxsfwhrfqpylg.supabase.co/storage/v1/object/public/storefront-images/';

test('media reservation: real PostgreSQL guards every reference source and retains durable fences', async t => {
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table products(id integer primary key,image text); create table product_variants(id integer primary key,image text);
    create table shop_settings(id integer primary key,content jsonb); create table orders(id integer primary key,items jsonb);
    create schema storage;create table storage.objects(id integer primary key,bucket_id text,name text);
    grant usage on schema public to anon,authenticated,service_role;`);
  await db.exec(migration);await db.exec(migration);
  await db.exec(retryMigration);await db.exec(retryMigration);
  const reserve=async paths=>(await db.query('select reserve_orphan_media($1::text[]) paths',[paths])).rows[0].paths;
  await t.test('source URLs including nested JSON and percent encoding are protected before reservation',async()=>{
    await db.query('insert into products values(1,$1)',[base+'products/live.webp']);
    await db.query('insert into product_variants values(1,$1)',[base+'products/%E9%BA%BB%E8%BE%A3.webp?x=1']);
    await db.query('insert into shop_settings values(1,$1)',[JSON.stringify({nested:[{image:base+'settings.webp'}]})]);
    await db.query('insert into orders values(1,$1)',[JSON.stringify([{image:base+'order.webp'}])]);
    assert.deepEqual(await reserve(['products/live.webp','products/麻辣.webp','settings.webp','order.webp']),[]);
  });
  await t.test('reservation precedes deletion and rejects later references from every writer',async()=>{
    assert.deepEqual(await reserve(['products/retired.webp']),['products/retired.webp']);
    await assert.rejects(db.query('insert into products values(2,$1)',[base+'products/retired.webp']),/删除保护/);
    await assert.rejects(db.query('update product_variants set image=$1',[base+'products/retired.webp']),/删除保护/);
    await assert.rejects(db.query('update shop_settings set content=$1',[JSON.stringify({nested:{url:base+'products/%72etired.webp'}})]),/删除保护/);
    await assert.rejects(db.query('update orders set items=$1',[JSON.stringify([{image:base+'products/retired.webp'}])]),/删除保护/);
    assert.deepEqual(await reserve(['products/retired.webp']),[], 'an absent retired object is already complete');
  });
  await t.test('retired Storage paths cannot be recreated; unrelated buckets are unaffected',async()=>{
    await assert.rejects(db.query('insert into storage.objects values(1,$1,$2)',['storefront-images','products/retired.webp']),/不能覆盖/);
    await db.query('insert into storage.objects values(2,$1,$2)',['other-bucket','products/retired.webp']);
  });
  await t.test('final row is checked even if another BEFORE trigger rewrites its image',async()=>{
    await db.exec(`create function rewrite_test_image() returns trigger language plpgsql as $$
      begin new.image := '${base}products/retired.webp'; return new; end $$;
      create trigger z_test_rewrite before insert on products for each row execute function rewrite_test_image();`);
    await assert.rejects(db.query('insert into products values(4,$1)',[base+'safe.webp']),/删除保护/);
    await db.exec('drop trigger z_test_rewrite on products; drop function rewrite_test_image();');
  });
  await t.test('failed Storage operation does not release durable path reservation',async()=>{
    await db.query('insert into storage.objects values(10,$1,$2)',['storefront-images','retry.webp']);
    assert.deepEqual(await reserve(['retry.webp']),['retry.webp']);
    const before=(await db.query("select retired_at from media_retired_paths where path='retry.webp'")).rows;
    assert.deepEqual(await reserve(['retry.webp','retry.webp']),['retry.webp']);
    assert.deepEqual((await db.query("select retired_at from media_retired_paths where path='retry.webp'")).rows,before);
    await assert.rejects(db.query('insert into products values(3,$1)',[base+'retry.webp']),/删除保护/);
    await assert.rejects(db.query('update storage.objects set name=name where id=10'),/不能覆盖/);
    await db.query('delete from storage.objects where id=10');
    assert.deepEqual(await reserve(['retry.webp']),[]);
    await assert.rejects(db.query('insert into storage.objects values(10,$1,$2)',['storefront-images','retry.webp']),/不能覆盖/);
  });
  await t.test('retry rechecks references for an existing fence and present object',async()=>{
    await db.query('insert into storage.objects values(11,$1,$2)',['storefront-images','retry-conflict.webp']);
    assert.deepEqual(await reserve(['retry-conflict.webp']),['retry-conflict.webp']);
    // Deliberately inconsistent admin data; normal writes remain forbidden.
    await db.exec('alter table products disable trigger media_reference_guard');
    await db.query('insert into products values(9,$1)',[base+'retry-conflict.webp']);
    await db.exec('alter table products enable trigger media_reference_guard');
    assert.deepEqual(await reserve(['retry-conflict.webp']),[]);
    await db.query('delete from products where id=9');
    assert.deepEqual(await reserve(['retry-conflict.webp']),['retry-conflict.webp']);
    await db.query('delete from storage.objects where id=11');
  });
  await t.test('browser roles cannot reserve paths or read/mutate the fence table',async()=>{
    // API privileges are unchanged by the incremental fix.
    for(const role of ['anon','authenticated']){
      await db.exec('set role '+role);
      await assert.rejects(reserve(['not-allowed.webp']),/permission denied/);
      await assert.rejects(db.query('select * from media_retired_paths'),/permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');assert.deepEqual(await reserve(['service.webp']),['service.webp']);await db.exec('reset role');
  });
  await t.test('unsafe transaction snapshots fail closed and default files remain protected',async()=>{
    assert.deepEqual(await reserve(['defaults/a.webp','hero-snack-illustration-v1.webp']),[]);
    await assert.rejects(reserve(['../bad.webp']),/路径无效/);
    await db.exec('begin isolation level repeatable read');
    await assert.rejects(reserve(['stale.webp']),/READ COMMITTED/);await db.exec('rollback');
  });
  await t.test('normal workflow retries failed deletion and tolerates a lost success acknowledgement',async()=>{
    const path='workflow-retry.webp';let calls=0;
    await db.query('insert into storage.objects values(12,$1,$2)',['storefront-images',path]);
    const args={selectedPaths:[path],readReferences:async()=>new Set(),reserveFiles:reserve,
      listFiles:async()=>(await db.query('select name as path from storage.objects where id=12')).rows.map(x=>({...x,updatedAt:'2020-01-01'})),
      deleteFiles:async()=>{calls++;if(calls===1)throw new Error('Storage failure');await db.query('delete from storage.objects where id=12');throw new Error('Acknowledgement lost');}};
    await assert.rejects(deleteOrphanFilesSafely(args),/Storage failure/);
    const fence=(await db.query('select retired_at from media_retired_paths where path=$1',[path])).rows;
    await assert.rejects(deleteOrphanFilesSafely(args),/Acknowledgement lost/);
    assert.equal(calls,2);
    const complete=await deleteOrphanFilesSafely(args);
    assert.deepEqual(complete,{deleted:[],skipped:[{path,reason:'not_found'}]});
    assert.equal(calls,2);
    assert.deepEqual((await db.query('select retired_at from media_retired_paths where path=$1',[path])).rows,fence);
    await assert.rejects(db.query('insert into products values(12,$1)',[base+path]),/删除保护/);
  });
});
