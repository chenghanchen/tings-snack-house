import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDependencyPolicy, validateToolchain } from '../scripts/check-edge-dependencies.mjs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const policy = JSON.parse(read('supabase/edge-toolchain.json'));
const fixture = slug => {
  const base = `supabase/functions/${slug}`;
  return [JSON.parse(read(`${base}/deno.json`)), JSON.parse(read(`${base}/deno.lock`)), read(`${base}/index.ts`), policy.supabaseJsVersion];
};
test('both functions pin Supabase JS with independent frozen integrity graphs', () => {
  assert.doesNotThrow(() => validateToolchain(policy));
  assert.throws(() => validateToolchain({ ...policy, functions: [] }));
  assert.throws(() => validateToolchain({ ...policy, functions: ['submit-order'] }));
  for (const slug of policy.functions) assert.doesNotThrow(() => validateDependencyPolicy(...fixture(slug)));
});
test('floating source, changed lock, missing transitive integrity and unfrozen config fail closed', () => {
  for (const change of [
    f => { f[0].lock.frozen = false; },
    f => { f[0].nodeModulesDir = 'auto'; },
    f => { f[2] = f[2].replace('@' + policy.supabaseJsVersion, '@2'); },
    f => { f[1].specifiers = {}; },
    f => { delete f[1].npm['tslib@2.8.1'].integrity; },
  ]) {
    const f = fixture('submit-order'); change(f);
    assert.throws(() => validateDependencyPolicy(...f));
  }
});
test('conditional Edge runner retains frozen Deno and actual Docker bundling', () => {
  const script = read('scripts/ci-check.mjs');
  assert.match(script, /check-edge-dependencies\.mjs/);
  assert.match(script, /if\(r.error\|\|r.status!==0\)throw Error/);
  assert.match(script, /mode==='edge'/);
  for (const file of ['release-check.yml']) {
    const workflow = read('.github/workflows/' + file);
    assert.ok(workflow.includes(`deno-version: v${policy.denoVersion}`));
    assert.match(workflow, /run: node scripts\/ci-check.mjs all/);
  }
  const config = read('supabase/config.toml');
  for (const slug of policy.functions) {
    assert.ok(config.includes(`static_files = ["./functions/${slug}/deno.lock"]`));
  }
  assert.match(script, /run\(\['scripts\/edge-bundle-proof\.mjs'\]/);
  assert.match(script, /assertProof\([^\n]+,6,checkoutSha\)/);
});
