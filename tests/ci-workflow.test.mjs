import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const workflow=read('.github/workflows/release-check.yml');
function contract(y){
 assert.match(y,/^  pull_request:$/m);
 assert.match(y,/^    branches: \[main\]$/m);
 assert.deepEqual([...y.slice(y.indexOf('jobs:')).matchAll(/^  ([\w-]+):$/gm)].map(m=>m[1]),['release-gate']);
 assert.deepEqual(y.match(/^    name:.*$/gm),['    name: release-gate']);
 assert.doesNotMatch(y,/continue-on-error|^    if:|pull_request_target|paths-ignore|^\s+paths: \[|needs:|actions: write|contents: write/m);
 assert.match(y,/fetch-depth: 0/);assert.match(y,/persist-credentials: false/);
 assert.match(y,/CI_BASE_SHA: \$\{\{ github.event.pull_request.base.sha \|\| github.event.before \|\| inputs.base \}\}/);
 for(const command of ['npm ci --ignore-scripts --no-audit --no-fund','npx --no-install playwright install --with-deps chromium','node scripts/ci-check.mjs all'])
  assert.ok(y.split('\n').some(line=>line.trim().replace(/^- /,'')==='run: '+command));
 // No conditional test steps; only diagnostic upload may run under always().
 assert.deepEqual(y.match(/^        if:.*$/gm),['        if: always()']);
 assert.doesNotMatch(y,/^\s+- if:/m);
 assert.doesNotMatch(y,/release-(?:level|report|live|ci-gate)|ci-(?:shadow|trusted|requirements)|BOOTSTRAP_TRUST|GITHUB_TOKEN/);
}
test('one unconditional release-gate owns the entire PR verdict; no duplicate shadow workflow',()=>{
 contract(workflow);
 for(const f of readdirSync(new URL('../.github/workflows',import.meta.url)).filter(f=>f.endsWith('.yml')&&f!=='release-check.yml')){
  const y=read('.github/workflows/'+f);
  assert.doesNotMatch(y,/^\s+name: release-gate$|scripts\/ci-check.mjs|pull_request:/m,f);
 }
});
test('workflow mutations cannot hide failure, omit the runner or change the required identity',()=>{
 for(const bad of [
  workflow.replace('name: release-gate','name: release-gate-shadow'),
  workflow.replace('    runs-on:','    if: false\n    runs-on:'),
  workflow.replace('run: node scripts/ci-check.mjs all','run: echo PASS'),
  workflow.replace('run: node scripts/ci-check.mjs all','run: node scripts/ci-check.mjs all || true'),
  workflow.replace('      - name: Base','      - if: false\n        name: Base'),
  workflow+'\n    continue-on-error: true',
  workflow.replace('  pull_request:','  workflow_call:'),
 ])assert.throws(()=>contract(bad));
});
test('runner and selector contain no old framework runtime imports or GitHub evidence API',()=>{
 for(const f of ['scripts/ci-check.mjs','scripts/ci-select.mjs','scripts/cache-version-guard.mjs']){
  assert.doesNotMatch(read(f),/(?:from|import\()\s*['"][^'"]*release-(?:level|report|live|ci-gate)|api.github.com|BOOTSTRAP_TRUST/);
 }
 const runner=read('scripts/ci-check.mjs');
 assert.match(runner,/for\(const suite of selectedModes\(selection\)\)await check\(suite,base\)/);
 assert.match(runner,/if\(!selection.diffComplete\)throw Error/);
 assert.match(runner,/if\(!Number.isSafeInteger\(cases\)\|\|cases<=0\)throw Error/);
});
