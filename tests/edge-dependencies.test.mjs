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
test('L3 release Tests gate retains frozen Deno; both CI paths pin the same toolchain', () => {
  const script = read('scripts/release-check.mjs');
  assert.match(script, /check-edge-dependencies\.mjs/);
  assert.match(script, /if \(edge\.error \|\| edge\.status !== 0\) process\.exit/);
  assert.match(script, /if \(!frontendOnly && !businessOnly\)/);
  for (const file of ['release-check.yml', 'release-production.yml']) {
    const workflow = read('.github/workflows/' + file);
    assert.ok(workflow.includes(`deno-version: v${policy.denoVersion}`));
    assert.match(workflow, /outputs\.level != 'L1' && .*outputs\.level != 'L2'/);
  }
  const config = read('supabase/config.toml');
  for (const slug of policy.functions) {
    assert.ok(config.includes(`static_files = ["./functions/${slug}/deno.lock"]`));
  }
  assert.match(read('.github/workflows/release-check.yml'), /node scripts\/edge-bundle-proof\.mjs/);
});
