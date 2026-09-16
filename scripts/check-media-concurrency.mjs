// Disposable PostgreSQL only. No connection string, host credentials or production mode.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = 'postgres@sha256:45cd22f8d32e189d245403954882f88e7a8714301fda80dab6da90f1265b25a3'; // 17.6-bookworm amd64
const container = `media-guard-proof-${process.pid}-${Date.now()}`;
const folder = path.join(root, '.build/media-concurrency');
mkdirSync(folder, { recursive: true });
const env = { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_CONFIG: path.join(folder, 'empty-docker-config') };
mkdirSync(env.DOCKER_CONFIG, { recursive: true });
const migration = readFileSync(path.join(root, 'media-deletion-guard-migration.sql'), 'utf8');
const report = { scope: 'Disposable PostgreSQL, NOT hosted Supabase or production', commit: process.env.GITHUB_SHA,
  image, migrationSha256: createHash('sha256').update(migration).digest('hex'), cases: [], result: 'PENDING' };
const sessions = [];
let started = false;
function docker(args, input, timeout = 30000) {
  const r = spawnSync('docker', args, { env, input, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error((r.stderr || r.error?.message || 'Docker command failed').trim());
  return r.stdout.trim();
}
const sqlArgs = ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
const sql = text => docker(sqlArgs, text);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (check()) return; await sleep(80); }
  throw new Error(`Timed out: ${description}`);
}
function session(name) {
  const child = spawn('docker', sqlArgs, { env });
  const s = { name, child, output: '', errors: '', exit: null, ended: false };
  sessions.push(s);
  child.stdout.on('data', chunk => { s.output += chunk; });
  child.stderr.on('data', chunk => { s.errors += chunk; });
  child.on('error', error => { s.errors += error.message; s.ended = true; });
  child.on('close', code => { s.exit = code; s.ended = true; });
  s.send = text => child.stdin.write(text + '\n');
  s.finish = async text => {
    child.stdin.end(text + '\n');
    await until(() => s.ended, `${name} exited`);
  };
  s.send(`set application_name = '${name}'; set statement_timeout = '10s'; set lock_timeout = '8s';`);
  return s;
}
async function blocked(name) {
  await until(() => sql(`select count(*) from pg_locks l join pg_stat_activity a using(pid)
    where a.application_name='${name}' and l.locktype='advisory' and not l.granted;`) === '1', `${name} waits for real advisory lock`);
}
const base = 'https://example.invalid/storage/v1/object/public/storefront-images/';
try {
  if (process.platform !== 'linux') throw new Error('Linux Docker required');
  docker(['pull', image], undefined, 300000);
  docker(['run', '-d', '--name', container, '--network=none', '--label', 'purpose=media-concurrency-proof',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]); started = true;
  await until(() => {
    try { return docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).includes('accepting connections'); }
    catch { return false; }
  }, 'disposable database ready');
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.products(id integer primary key, image text);
    create table public.product_variants(id integer primary key, image text);
    create table public.shop_settings(id integer primary key, content jsonb);
    create table public.orders(id integer primary key, items jsonb);
    create schema storage;
    create table storage.objects(id integer primary key,bucket_id text,name text);`);
  sql(migration); sql(migration);
  report.cases.push({ name: 'migration applies and reapplies', result: 'PASS' });

  const writer = session('proof_reference_first');
  writer.send(`begin; insert into products values(1,'${base}reference-first.webp'); select 'READY';`);
  await until(() => writer.output.includes('READY'), 'writer holds transaction');
  const reserver = session('proof_reserve_waiter');
  reserver.send(`select 'RESERVED:' || cardinality(public.reserve_orphan_media(array['reference-first.webp']));`);
  await blocked(reserver.name);
  await writer.finish('commit;'); assert.equal(writer.exit, 0, writer.errors);
  await reserver.finish(''); assert.equal(reserver.exit, 0, reserver.errors);
  assert.match(reserver.output, /RESERVED:0/);
  assert.equal(sql("select count(*) from media_retired_paths where path='reference-first.webp';"), '0');
  report.cases.push({ name: 'reference first: reserve blocks then sees committed reference', result: 'PASS' });

  const first = session('proof_reservation_first');
  first.send("begin; select cardinality(public.reserve_orphan_media(array['reservation-first.webp'])); select 'READY';");
  await until(() => first.output.includes('READY'), 'reservation holds transaction');
  const late = session('proof_reference_waiter');
  late.send(`insert into products values(2,'${base}reservation-first.webp');`);
  await blocked(late.name);
  await first.finish('commit;'); assert.equal(first.exit, 0, first.errors);
  await until(() => late.ended, 'late reference rejected');
  assert.notEqual(late.exit, 0); assert.match(late.errors, /图片路径已进入删除保护/);
  assert.equal(sql('select count(*) from products where id=2;'), '0');
  assert.equal(sql("select count(*) from media_retired_paths where path='reservation-first.webp';"), '1');
  report.cases.push({ name: 'reservation first: reference blocks then rejects committed fence', result: 'PASS' });

  const storageFirst = session('proof_storage_reservation');
  storageFirst.send("begin; select public.reserve_orphan_media(array['storage-retired.webp']); select 'READY';");
  await until(() => storageFirst.output.includes('READY'), 'storage fence held');
  const storageLate = session('proof_storage_waiter');
  storageLate.send("insert into storage.objects values(1,'storefront-images','storage-retired.webp');");
  await blocked(storageLate.name);
  await storageFirst.finish('commit;'); assert.equal(storageFirst.exit, 0, storageFirst.errors);
  await until(() => storageLate.ended, 'storage metadata rejected');
  assert.notEqual(storageLate.exit, 0); assert.match(storageLate.errors, /不能覆盖或重新上传/);
  assert.equal(sql('select count(*) from storage.objects where id=1;'), '0');
  report.cases.push({ name: 'storage metadata write waits and rejects retired path (not Storage API)', result: 'PASS' });
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.error = error.message; }
finally {
  for (const s of sessions) {
    if (!s.ended) s.child.stdin.end('rollback;\n');
    writeFileSync(path.join(folder, s.name + '.log'), s.output + s.errors);
  }
  if (started) {
    try { docker(['rm', '-f', '-v', container]); }
    catch (error) { report.cleanupError = error.message; report.result = 'FAIL'; }
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.result === 'PASS' ? 0 : 1;
}
