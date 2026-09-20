import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { JOBS, evaluateGate, readAttemptJobs, verifyRun, contextFromEnvironment } from '../scripts/release-ci-gate.mjs';

const context = { repository: 'owner/repo', runId: '123', attempt: '2', checkoutSha: 'a'.repeat(40), apiSha: 'b'.repeat(40), event: 'pull_request' };
function fixture(level = 'L3') {
  const c = { ...context }, needs = {}, jobs = [];
  for (const [i, name] of JOBS.entries()) {
    const skipped = level !== 'L3' && i > 1;
    needs[name] = { result: skipped ? 'skipped' : 'success', outputs: skipped ? {} : {
      checkout_sha: c.checkoutSha, checkout_run_id: c.runId, checkout_run_attempt: c.attempt,
    } };
    jobs.push({ id: i+1, name, run_id: Number(c.runId), run_attempt: Number(c.attempt), head_sha: c.apiSha,
      status: 'completed', conclusion: needs[name].result });
  }
  Object.assign(needs.classify.outputs, { level, valid: 'true' });
  return { c, needs, jobs };
}
const verdict = f => evaluateGate(f.c, f.needs, f.jobs);
const response = (jobs, { total = jobs.length, link = '', ok = true, status = 200 } = {}) => ({
  ok, status, headers: { get: key => key === 'link' ? link : null }, json: async () => ({ total_count: total, jobs }),
});
const url = page => `https://api.github.com/repos/owner/repo/actions/runs/123/attempts/2/jobs?per_page=100&page=${page}`;

for (const level of ['L1', 'L2', 'L3']) test(`${level}: exact permitted status matrix passes`, () => {
  assert.equal(verdict(fixture(level)).pass, true);
  const f = fixture(level);
  for (const j of f.jobs) { j.conclusion = 'success'; f.needs[j.name] = { ...fixture().needs[j.name] }; }
  Object.assign(f.needs.classify.outputs, { level, valid: 'true' });
  assert.equal(verdict(f).pass, true);
});
for (const status of ['skipped', 'neutral', 'failure', 'cancelled', 'timed_out', 'action_required', 'stale', null, 'unknown'])
  test(`L3 every required job rejects ${status}`, () => {
    for (const name of JOBS) {
      const f = fixture(); f.jobs.find(j => j.name === name).conclusion = status; f.needs[name].result = status;
      assert.equal(verdict(f).pass, false, name);
    }
  });
for (const level of ['L1', 'L2']) test(`${level}: required skips and optional failures are never hidden`, () => {
  for (const name of JOBS) for (const status of ['failure', 'neutral', 'cancelled', 'timed_out', 'action_required', 'stale', undefined, 'unknown', ...(['classify','test'].includes(name) ? ['skipped'] : [])]) {
    const f = fixture(level); f.jobs.find(j => j.name === name).conclusion = status; f.needs[name].result = status;
    assert.equal(verdict(f).pass, false, `${name}:${status}`);
  }
});
test('classification valid must be true and the level must be an exact known value', () => {
  for (const valid of [false, 'false', true, undefined, 'TRUE', '']) {
    const f = fixture(); f.needs.classify.outputs.valid = valid; assert.equal(verdict(f).pass, false);
  }
  for (const level of [undefined, '', 'L4', 'l1', 'L1\n', null]) {
    const f = fixture(); f.needs.classify.outputs.level = level; assert.equal(verdict(f).pass, false);
  }
  for (const name of JOBS) { const f = fixture(); delete f.needs[name]; assert.equal(verdict(f).pass, false); }
});
test('duplicate/missing jobs, incomplete statuses and needs disagreement fail closed', () => {
  for (const name of JOBS) {
    const f = fixture(); f.jobs = f.jobs.filter(j => j.name !== name);
    assert.match(verdict(f).errors.join('\n'), /Re-run all jobs/);
    const g = fixture(); g.jobs.push({ ...g.jobs.find(j => j.name === name), id: 99 }); assert.equal(verdict(g).pass, false);
    for (const status of ['queued','in_progress',undefined,'unknown']) {
      const h = fixture(); h.jobs.find(j => j.name === name).status = status; assert.equal(verdict(h).pass, false);
    }
    const h = fixture(); h.needs[name].result = 'skipped'; assert.equal(verdict(h).pass, false);
  }
});
test('wrong/missing run, attempt, API head and checkout evidence fail for every job', () => {
  for (const name of JOBS) {
    for (const field of ['run_id','run_attempt','head_sha','id']) for (const value of [undefined, field==='id'?0:999]) {
      const f = fixture(); f.jobs.find(j => j.name === name)[field] = value; assert.equal(verdict(f).pass, false);
    }
    for (const field of ['checkout_sha','checkout_run_id','checkout_run_attempt']) for (const value of [undefined,'old']) {
      const f = fixture(); f.needs[name].outputs[field] = value; assert.equal(verdict(f).pass, false);
    }
  }
  const f = fixture('L1'); f.needs['edge-bundler'].outputs = fixture().needs['edge-bundler'].outputs;
  assert.equal(verdict(f).pass, false, 'skipped job with old output');
});
test('dual SHA uses event PR head, never the artifact name or merge SHA as API head', () => {
  const env = { GITHUB_REPOSITORY: context.repository, GITHUB_RUN_ID: context.runId, GITHUB_RUN_ATTEMPT: context.attempt,
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: context.checkoutSha };
  const event = { pull_request: { head: { sha: context.apiSha } } };
  assert.deepEqual(contextFromEnvironment(env, event, context.checkoutSha), context);
  assert.throws(() => contextFromEnvironment(env, {}, context.checkoutSha));
  assert.throws(() => contextFromEnvironment(env, event, context.apiSha), /checkout HEAD/);
  for (const name of JOBS) { const f = fixture(); f.jobs.find(j=>j.name===name).head_sha = context.checkoutSha; assert.equal(verdict(f).pass, false); }
  for (const eventName of ['push','workflow_dispatch']) {
    const c = contextFromEnvironment({ ...env, GITHUB_EVENT_NAME: eventName }, {}, env.GITHUB_SHA);
    assert.equal(c.apiSha, env.GITHUB_SHA);
    const f = fixture(); f.c = c; f.jobs.forEach(j => j.head_sha = c.apiSha); assert.equal(verdict(f).pass, true);
  }
});
test('invalid context and malformed records never pass', () => {
  for (const extra of [{runId:'0'},{attempt:'0'},{event:'pull_request_target'},{apiSha:''},{checkoutSha:''},{repository:'../x'},{event:'push'}]) {
    const f = fixture(); f.c = { ...f.c, ...extra }; assert.equal(verdict(f).pass, false);
  }
  const f = fixture(); assert.equal(evaluateGate(f.c,null,null).pass,false);
  assert.equal(evaluateGate(f.c, { ...f.needs, extra: {} }, f.jobs).pass,false);
});
test('pagination consumes every page within the exact attempt endpoint', async () => {
  const f = fixture(), visited = [];
  const fetchImpl = async (u, options) => {
    visited.push(u); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    return visited.length === 1 ? response(f.jobs.slice(0,2), {total:4,link:`<${url(2)}>; rel="next"`}) : response(f.jobs.slice(2),{total:4});
  };
  assert.deepEqual(await readAttemptJobs(f.c,{token:'fixture-token',fetchImpl}),f.jobs);
  assert.deepEqual(visited,[url(1),url(2)]);
});
test('pagination protocol errors, duplicates and incomplete responses are rejected', async () => {
  const f = fixture();
  for (const r of [response(f.jobs.slice(0,2),{total:4}), response([...f.jobs,f.jobs[0]]),
    response(f.jobs,{total:3}), response(f.jobs,{total:4,link:`<${url(2)}>; rel="next"`}),
    response(f.jobs.slice(0,2),{total:4,link:`<${url(2).replace('/attempts/2/','/attempts/1/')}>; rel="next"`}),
    response(f.jobs.slice(0,2),{total:4,link:'<https://example.test/>; rel="next"'}),
    response(f.jobs.slice(0,2),{total:4,link:`<${url(2)}>; rel="next", <${url(2)}>; rel="next"`}),
    response([],{total:4,link:`<${url(2)}>; rel="next"`}), response(f.jobs,{total:-1}),
    {ok:true,headers:{get:()=>''},json:async()=>({total_count:4,jobs:null})}]) {
    await assert.rejects(readAttemptJobs(f.c,{token:'fixture',fetchImpl:async()=>r}));
  }
  let n=0;
  await assert.rejects(readAttemptJobs(f.c,{token:'fixture',fetchImpl:async()=>++n===1
    ? response(f.jobs.slice(0,2),{total:4,link:`<${url(2)}>; rel="next"`}) : response(f.jobs.slice(2),{total:5})}),/total_count changed/);
});
test('API failure, thrown request, malformed JSON and missing token all fail closed', async () => {
  const f=fixture();
  for(const fetchImpl of [async()=>response([],{ok:false,status:403}),async()=>{throw Error('timeout')},
    async()=>({ok:true,json:async()=>{throw Error('bad JSON')}})]) {
    const r=await verifyRun(f.c,f.needs,{token:'fixture',fetchImpl});assert.equal(r.pass,false);
  }
  assert.equal((await verifyRun(f.c,f.needs,{})).pass,false);
});
test('partial rerun cannot stitch snapshots or reuse previous-attempt success', async () => {
  const f=fixture();let calls=0,sleeps=0;
  const r=await verifyRun(f.c,f.needs,{token:'fixture',sleep:async()=>sleeps++,fetchImpl:async()=> {
    calls++;return response(calls%2 ? f.jobs.slice(0,2) : f.jobs.slice(2));
  }});
  assert.equal(r.pass,false);assert.equal(calls,3);assert.equal(sleeps,2);assert.match(r.errors.join('\n'),/Re-run all jobs/);
  const old=f.jobs.map(j=>({...j,run_attempt:1}));
  assert.equal((await verifyRun(f.c,f.needs,{token:'fixture',fetchImpl:async()=>response(old)})).pass,false);
});
test('bounded settling may pass only a fresh complete snapshot', async () => {
  const f=fixture();let n=0;
  const r=await verifyRun(f.c,f.needs,{token:'fixture',sleep:async()=>{},fetchImpl:async()=>response(++n===1?f.jobs.slice(0,1):f.jobs)});
  assert.equal(r.pass,true);assert.equal(n,2);
});

const workflow=readFileSync(new URL('../.github/workflows/release-check.yml',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function block(source,name) {
  const pieces=[...source.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|(?![\s\S]))/gm)];
  const matches=pieces.filter(m=>m[1]===name);assert.equal(matches.length,1,`one ${name} job`);return matches[0][2];
}
export function assertWorkflow(source) {
  const gate=block(source,'release-gate');
  assert.match(gate,/^    name: release-gate$/m);
  assert.match(gate,/^    needs: \[classify, test, edge-bundler, media-concurrency\]$/m);
  assert.deepEqual(gate.match(/^    if:.*$/gm),['    if: always()']);
  assert.doesNotMatch(gate,/continue-on-error|strategy:|environment:|paths:|paths-ignore:/);
  assert.match(gate,/^      actions: read$/m); assert.doesNotMatch(source,/permissions:[\s\S]*?\b(?:contents|actions|checks): write/);
  assert.match(gate,/run: node --test tests\/release-ci-gate.test.mjs/);
  assert.match(gate,/name: Verify current-attempt release evidence\n        if: always\(\)\n        env:\n          GITHUB_TOKEN: \$\{\{ github.token \}\}\n          RELEASE_NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}\n        run: node scripts\/release-ci-gate.mjs/);
  assert.doesNotMatch(source,/paths-ignore:|pull_request_target:/);
  for(const name of JOBS) {
    const job=block(source,name);assert.match(job,new RegExp(`^    name: ${name}$`,'m'));
    assert.doesNotMatch(job,/continue-on-error|strategy:/);
    for(const key of ['sha','run_id','run_attempt'])assert.ok(job.includes(`checkout_${key}: \${{ steps.checkout-proof.outputs.${key} }}`));
    assert.match(job,/id: checkout-proof\n        shell: bash\n        run: \|\n          set -euo pipefail\n          actual=\$\(git rev-parse HEAD\)\n          test "\$actual" = "\$GITHUB_SHA"\n          echo "sha=\$actual" >> "\$GITHUB_OUTPUT"\n          echo "run_id=\$GITHUB_RUN_ID" >> "\$GITHUB_OUTPUT"\n          echo "run_attempt=\$GITHUB_RUN_ATTEMPT" >> "\$GITHUB_OUTPUT"/);
  }
  const classify=block(source,'classify');assert.match(classify,/level=L3\n          valid=false/);
  assert.match(classify,/if result=\$\(node "\$policy"[^\n]+\); then\n              case "\$result" in L1\|L2\|L3\) level="\$result"; valid=true ;; esac/);
  assert.match(classify,/echo "valid=\$valid" >> "\$GITHUB_OUTPUT"/);
  for(const name of ['edge-bundler','media-concurrency']) assert.match(block(source,name),/needs: classify\n    if: \$\{\{ always\(\) && needs.classify.outputs.level != 'L1' && needs.classify.outputs.level != 'L2' \}\}/);
}
test('workflow gate has unconditional scheduling, fixed names, read-only permissions and checkout proofs',()=>assertWorkflow(workflow));
test('workflow mutation: skip conditions, soft failure and dynamic identities are rejected',()=>{
  for(const source of [workflow.replace('\n    if: always()','\n    if: success()'),
    workflow.replace('\n    if: always()','\n    if: always() && false'),
    workflow.replace('\n    if: always()','\n    if: always()\n    continue-on-error: true'),
    workflow.replace('\n    if: always()','\n    if: always()\n    continue-on-error: false'),
    workflow.replace('needs: [classify, test, edge-bundler, media-concurrency]','needs: [classify, test]'),
    workflow.replace('    name: release-gate','    name: release-gate-${{ matrix.x }}'),
    workflow.replace('        if: always()\n        env:\n          GITHUB_TOKEN','        if: success()\n        env:\n          GITHUB_TOKEN'),
    workflow.replace('valid=false','valid=true'),workflow.replace('test "$actual" = "$GITHUB_SHA"','true'),
    workflow.replace('    name: test','    name: test\n    continue-on-error: true')])assert.throws(()=>assertWorkflow(source));
});
test('actual classify shell only marks valid after successful exact trusted output',()=>{
  const gitExe=process.platform==='win32'?execFileSync('where.exe',['git'],{encoding:'utf8'}).trim().split(/\r?\n/)[0]:'';
  const bash=process.platform==='win32'?[path.resolve(path.dirname(gitExe),'../usr/bin/sh.exe'),'C:/Program Files/Git/bin/bash.exe'].find(existsSync):'/bin/bash';
  assert.ok(existsSync(bash),'bash required to test actual workflow classification');
  const code=block(workflow,'classify').split('      - id: level\n')[1].split('        run: |\n')[1].split('\n').map(s=>s.startsWith('          ')?s.slice(10):s).join('\n');
  const temp=mkdtempSync(path.join(tmpdir(),'ci-classify-valid-'));
  const shellPath=p=>process.platform==='win32'?p.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase()):p;
  for(const [output,status,valid,level] of [['L1',0,'true','L1'],['L2',0,'true','L2'],['L3',0,'true','L3'],['L1',1,'false','L3'],['unknown',0,'false','L3'],['',0,'false','L3'],['L1\nL2',0,'false','L3']]) {
    const out=path.join(temp,`output-${Math.random()}`);
    execFileSync(bash,['--noprofile','--norc','-c',`set -euo pipefail\ngit() { return 0; }\nnode() { printf '%s' "$MOCK_OUTPUT"; return "$MOCK_STATUS"; }\n${code}`],
      {env:{...process.env,MOCK_OUTPUT:output,MOCK_STATUS:String(status),RELEASE_BASE_SHA:'a'.repeat(40),RUNNER_TEMP:shellPath(temp),GITHUB_WORKSPACE:shellPath(temp),GITHUB_OUTPUT:shellPath(out)},stdio:'pipe'});
    assert.equal(readFileSync(out,'utf8'),`level=${level}\nvalid=${valid}\n`);
  }
});
