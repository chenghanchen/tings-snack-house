import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {SUITES,WIDTHS,assertComplete,allowedURL,options,matrixFor}=require('../scripts/browser/policy.cjs');
test('deduplicated account matrices preserve EVERY previous scene width across touch/desktop runs',()=>{
  const source=readFileSync(new URL('../scripts/check-customer-account.cjs',import.meta.url),'utf8');
  const lists=[...source.matchAll(/responsiveWidths\((\[[\d,\s]+\])\)/g)].map(m=>JSON.parse(m[1]));
  assert.equal(lists.length,22,'All 22 former account layout loops remain represented');
  const before=execFileSync('git',['show','c803325768044fa06379b5a3977aea0a239b3374:scripts/check-customer-account.cjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  const previous=[...before.matchAll(/for\s*\(const width of (\[[\d,\s]+\])\)/g)].map(m=>JSON.parse(m[1]));
  assert.deepEqual(lists,previous,'Do not silently remove/change the audited legacy matrix while deduplicating');
  for(const legacy of lists){const mobile=matrixFor(390,legacy),desktop=matrixFor(1710,legacy),union=[...mobile,...desktop];assert.equal(new Set(union).size,union.length);for(const w of legacy)assert.ok(union.includes(w),`Lost ${w}px`)}
});
test('browser manifest fails closed for missing, duplicated, zero and failed mandatory suites',()=>{
  const valid=SUITES.map(name=>({name,status:'PASS',cases:1}));assertComplete(valid);
  for(const rows of [[],valid.slice(1),[...valid,valid[0]],valid.map((r,i)=>i? r:{...r,cases:0}),valid.map((r,i)=>i? r:{...r,status:'SKIP'})])assert.throws(()=>assertComplete(rows));
});
test('offline network policy allows only explicit origins/mocks and HTTP(S)',()=>{
  const origins=['http://localhost:9876'],mocks=['https://cdn.fixture.test/sdk.js'];
  for(const url of ['http://localhost:9876/a.css','https://cdn.fixture.test/sdk.js'])assert.equal(allowedURL(url,origins,mocks),true);
  for(const url of ['http://localhost:9877/','http://localhost.evil/','https://cdn.fixture.test/unknown','https://production.test/','ws://localhost:9876/','file:///tmp/a','ftp://localhost/a','broken'])assert.equal(allowedURL(url,origins,mocks),false,url);
});
test('responsive matrix uses mobile/touch contexts, not viewport-only emulation',()=>{
  assert.deepEqual(WIDTHS,[320,390,768,780,781,782,1023,1024,1710]);
  for(const width of WIDTHS){const o=options(width);assert.equal(o.hasTouch,width<=780);assert.equal(o.isMobile,width<=780);assert.equal(o.serviceWorkers,'block')}
});
test('release paths and CI install mandatory Chromium without changing gate scheduling',()=>{
  const source=readFileSync(new URL('../scripts/ci-check.mjs',import.meta.url),'utf8');
  assert.match(source,/'browser-baseline'/);
  assert.match(source,/run\(\['scripts\/check-browser-baseline.cjs'\]\)/);
  assert.match(source,/if\(r.error\|\|r.status!==0\)throw Error/);
  assert.match(source,/if\(browser.retries!==0\)throw Error/);
  const workflow=readFileSync(new URL('../.github/workflows/release-check.yml',import.meta.url),'utf8');
  assert.match(workflow,/name: Install offline Chromium\r?\n        run: npx --no-install playwright install --with-deps chromium/);
});
