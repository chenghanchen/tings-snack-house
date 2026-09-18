import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { classifyChanges, detectRelease, FULL_GATES } from '../scripts/release-level.mjs';
import { createReport, recordCheck, outcome, validateReport, checkEnvironment, renderReport } from '../scripts/release-report-core.mjs';
import { productionPrerequisites } from '../scripts/release-live.mjs';
const base = 'a'.repeat(40), head = 'b'.repeat(40);
const change = (file, extra = {}) => ({ path: file, status: 'M', before: '', after: '', ...extra });
const classify = changes => classifyChanges(changes, { base, head });
// Immutable snapshot of the three uncommitted UI files, not the evolving worktree.
// Applying this test fixture only touches a disposable local Git repository.
let mobileFixture;
function currentMobileUiChanges() {
  if (mobileFixture) return mobileFixture;
  const f = gitFixture(), files = ['index.html', 'mobile-header.js', 'styles.css'];
  const changes = files.map(file => {
    const before = execFileSync('git', ['show', `d0efe8d4ac43d17ce4c104388df96a0b05b2bbfa:${file}`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    writeFileSync(path.join(f.root, file), before);
    return change(file, { before });
  });
  f.git('apply', '--unidiff-zero', '--', fileURLToPath(new URL('./fixtures/release-level/mobile-catalog.patch.txt', import.meta.url)));
  mobileFixture = changes.map(c => ({ ...c, after: readFileSync(path.join(f.root, c.path), 'utf8') }));
  return mobileFixture;
}

test('exact current mobile catalog/hero/search/scroll changes together are L1', () => {
  const changes = currentMobileUiChanges(), plan = classify(changes);
  assert.match(changes[0].before, /min-height: 560px/);
  assert.match(changes[0].after, /min-height: 400px/);
  assert.match(changes[1].after, /Array\.from\(buttons\)/);
  assert.match(changes[1].after, /filters\.scrollTo/);
  assert.equal(plan.level, 'L1'); assert.equal(plan.backendChanged, false);
  assert.deepEqual(plan.files.map(f => f.level), ['L1', 'L1', 'L1']);
  assert.equal(plan.databaseScope, 'none');
  for (const gate of ['database', 'supabase', 'productionApproval', 'productionMatch']) assert.ok(!plan.requiredGates.includes(gate));
  assert.equal(classify(changes.map(c => ({ ...c, before: c.before.replace(/\r?\n/g, '\r\n'), after: c.after.replace(/\r?\n/g, '\r\n') }))).level, 'L1');
  const f = gitFixture();
  for (const c of changes) writeFileSync(path.join(f.root, c.path), c.before);
  const b = f.commit();
  for (const c of changes) writeFileSync(path.join(f.root, c.path), c.after);
  assert.equal(detectRelease(f.root, { base: b, head: f.commit() }).level, 'L1');
});

test('HTML unchanged scripts do not escalate numeric presentation CSS; executable changes do', () => {
  const before = '<!doctype html><html><head><script src="app.js"></script><script>const buttons = [1];</script><style>\n.hero{\n  min-height: 560px;\n  padding: 60px 8vw;\n}\n</style></head><body><p onclick="openMenu()">Hello</p></body></html>';
  const after = before.replace('560px', '400px').replace('60px 8vw', '32px 8vw');
  const ui = change('index.html', { before, after });
  assert.equal(classify([ui]).level, 'L1');
  for (const mutated of [
    after.replace('app.js', 'other.js'), after.replace('[1]', '[2]'),
    after.replace('openMenu()', 'pay()'), after.replace('Hello', 'Changed'),
    after.replace('<script src=', '<script nonce="different" src='),
    after.replace('400px;', 'expression(fetch("/write"));'),
    after.replace('400px;', '400px; color:red;'),
    after.replace('</style>', '@import "https://example.test/a.css";</style>'),
    after.replace('<body>', '<body><form action="/pay">'),
    after.replace('<style>', '<style media="print">'), after.replace('</style>', ''),
  ]) assert.equal(classify([{ ...ui, after: mutated }]).level, 'L3', mutated);
  assert.equal(classify([{ ...ui, status: 'A' }]).level, 'L3');
  assert.equal(classify([{ ...ui, mode: '100755' }]).level, 'L3');
});

test('CSS-looking data inside scripts/attributes/comments/raw text cannot bypass HTML gates', () => {
  for (const before of [
    '<script>const css = `<style>\npadding: 60px;\n</style>`;</script>',
    '<div data-html="<style>\npadding: 60px;\n</style>"></div>',
    '<!-- <style>\npadding: 60px;\n</style> -->',
    ...['textarea', 'template', 'svg', 'math', 'noscript', 'title'].map(tag => `<${tag}><style>\npadding: 60px;\n</style></${tag}>`),
    '<style>\n.x{content:"\npadding: 60px;\n";}\n</style>',
    '<style>\n/*\npadding: 60px;\n*/\n</style>',
    '<style>\n.x{background:url(\npadding: 60px;\n)}\n</style>',
  ]) {
    // An unchanged real script also prevents the legacy plain-text-only HTML rule.
    const source = before + '<script src="app.js"></script>';
    assert.equal(classify([change('index.html', { before: source, after: source.replace('60px', '32px') })]).level, 'L3', before);
  }
});

test('reviewed UI JS does not confuse Array.from/buttons with backend operations; unknown versions fail closed', () => {
  const ui = currentMobileUiChanges()[1];
  assert.equal(classify([ui]).level, 'L1');
  for (const code of [
    'supabase.from("orders").insert({id:1});', 'client.from("orders").update({paid:true});',
    'db["from"]("orders")["delete"]();', 'const {from} = client; from("orders").upsert({id:1});',
    'supabase.rpc("charge_wallet");', 'supabase.auth.updateUser({password:"test"});',
    'supabase.storage.from("media").remove(["x"]);', 'fetch("/admin", {method:"POST"});',
    'const Array = db; Array.from("orders").delete();', 'window.location="https://example.test";',
    'unknownBusinessOperation();', '// benign but unreviewed future edit',
  ]) {
    for (const extra of [{ after: ui.after + '\n' + code }, { before: ui.before + '\n' + code }])
      assert.equal(classify([{ ...ui, ...extra }]).level, 'L3', code);
  }
  for (const extra of [{ status: 'A' }, { status: 'D' }, { mode: '100755' }, { oldMode: '100755' }, { path: 'other-ui.js' }])
    assert.equal(classify([{ ...ui, ...extra }]).level, 'L3');
});

test('current mobile UI mixed with sensitive or classifier infrastructure changes remains full L3', () => {
  const ui = currentMobileUiChanges();
  for (const file of ['app.js', 'supabase/functions/submit-order/index.ts', 'supabase/functions/admin-media-cleanup/index.ts',
    'supabase/migrations/new.sql', 'media-deletion-guard-migration.sql', 'auth/rls.sql', 'customer-account.js',
    'storage-delete.js', 'scripts/deploy.cjs', 'scripts/release-security.mjs', 'scripts/release-level.mjs',
    'tests/release-level.test.mjs', 'tests/fixtures/release-level/mobile-catalog.patch.txt', 'RELEASE-CHECKS.md',
    '.github/workflows/release-check.yml', 'unknown.js']) {
    const high = change(file, { status: 'A', after: ui[1].after });
    for (const changes of [[...ui, high], [high, ...ui]]) {
      const p = classify(changes); assert.equal(p.level, 'L3', file); assert.deepEqual(p.requiredGates, FULL_GATES);
    }
  }
  assert.equal(classifyChanges(ui, { base, head, minimumLevel: 'L3' }).level, 'L3');
});
function reviewedSuccessUiChanges() {
  const before = execFileSync('git', ['show', 'bc6f03dec64e898da40fa252d2e5e82db71ef45b:scripts/check-success-hero.cjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.ok(before.includes('Math.min(350.01, result.available)'));
  return [
    change('styles.css', { before: '.success-hero{width:min(350.01px,100%)}', after: '.success-hero{width:min(300px,100%)}' }),
    change('scripts/check-success-hero.cjs', { before, after: before.replace('Math.min(350.01, result.available)', 'Math.min(300, result.available)') }),
    change('scripts/check-success-dialog.cjs', { status: 'A', after: readFileSync(new URL('./fixtures/release-level/success-dialog.cjs.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n') }),
  ];
}

test('reviewed success CSS + hero update + offline dialog addition together are L1', () => {
  const changes = reviewedSuccessUiChanges();
  const plan = classify(changes);
  assert.equal(plan.level, 'L1'); assert.equal(plan.uncertainty, null);
  assert.deepEqual(plan.files.map(f => f.level), ['L1', 'L1', 'L1']);
  assert.equal(plan.databaseScope, 'none'); assert.equal(plan.testScope, 'frontend');
  assert.ok(!plan.requiredGates.includes('supabase'));
  const crlf = changes.map(c => ({ ...c, before: c.before.replace(/\r?\n/g, '\r\n'), after: c.after.replace(/\r?\n/g, '\r\n') }));
  assert.equal(classify(crlf).level, 'L1', 'Git checkout line endings do not invalidate reviewed content');
});

test('UI allowlist rejects unreviewed content, aliases, deletions and mode changes', () => {
  const scripts = reviewedSuccessUiChanges().slice(1);
  for (const script of scripts) {
    for (const after of ['', script.after + '\nprocess.exit(0);', script.after + '\nfetch("https://example.test/deploy", {method:"POST"});'])
      assert.equal(classify([{ ...script, after }]).level, 'L3', script.path);
    assert.equal(classify([{ ...script, status: 'M', before: 'unreviewed prior source' }]).level, 'L3');
    for (const extra of [{ status: 'D' }, { status: 'R' }, { mode: '120000' }, { mode: '100755' }, { oldMode: '100755' }])
      assert.equal(classify([{ ...script, ...extra }]).level, 'L3');
    for (const file of [script.path.replace('scripts/', 'scripts/nested/'), script.path + '.copy.cjs', 'scripts/check-other-ui.cjs'])
      assert.equal(classify([{ ...script, path: file }]).level, 'L3', file);
  }
  assert.equal(classify([{ ...scripts[1], status: 'M', before: scripts[1].after.replace(/\n/g, '\r\n') }]).level, 'L1');
});

test('reviewed UI never downgrades mixed database/Edge/migration/deploy/security/unknown script changes', () => {
  const ui = reviewedSuccessUiChanges();
  for (const file of ['schema.sql', 'media-deletion-guard-migration.sql', 'supabase/migrations/20260917.sql',
    'supabase/functions/submit-order/index.ts', 'supabase/functions/admin-media-cleanup/deno.lock',
    'scripts/release-level.mjs', 'scripts/release-report.mjs', 'scripts/release-security.mjs', 'scripts/release-database.mjs',
    'scripts/deploy.cjs', 'scripts/security-scan.cjs', 'scripts/unknown.cjs', 'scripts/check-unknown.cjs',
    '.github/workflows/release-check.yml', 'tests/release-level.test.mjs', 'RELEASE-CHECKS.md']) {
    const risk = change(file, { status: 'A', after: ui[2].after });
    for (const mixed of [[...ui, risk], [risk, ...ui]]) {
      const plan = classify(mixed);
      assert.equal(plan.level, 'L3', file); assert.deepEqual(plan.requiredGates, FULL_GATES, file);
    }
  }
  assert.equal(classifyChanges(ui, { base, head, minimumLevel: 'L3' }).level, 'L3');
});

test('complete Git diff of reviewed success UI is L1; renaming or modifying the fixture is L3', () => {
  const f = gitFixture(), changes = reviewedSuccessUiChanges();
  mkdirSync(path.join(f.root, 'scripts'));
  for (const c of changes.filter(c => c.status === 'M')) writeFileSync(path.join(f.root, c.path), c.before);
  const b = f.commit();
  for (const c of changes) writeFileSync(path.join(f.root, c.path), c.after);
  const h = f.commit();
  const plan = detectRelease(f.root, { base: b, head: h });
  assert.equal(plan.uncertainty, null); assert.equal(plan.level, 'L1');
  assert.equal(plan.files.length, 3);
  writeFileSync(path.join(f.root, changes[2].path), changes[2].after + '\nprocess.exit(0);');
  assert.equal(detectRelease(f.root, { base: h, head: f.commit() }).level, 'L3');
  f.git('mv', changes[2].path, 'scripts/unknown.cjs');
  assert.equal(detectRelease(f.root, { base: h, head: f.commit() }).level, 'L3');
});

test('styles plus allowlisted UI regression support are L1; no unrelated backend gates', () => {
  // The allowlist approves the historical fixture, not future edits to the same path.
  const fixture = execFileSync('git', ['show', 'bc6f03dec64e898da40fa252d2e5e82db71ef45b:scripts/check-success-hero.cjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  const p = classify([change('styles.css'), change('scripts/check-success-hero.cjs', { status: 'A', after: fixture })]);
  assert.equal(p.level, 'L1');
  assert.equal(p.testScope, 'frontend');
  for (const key of ['database', 'supabase', 'guestCheckout', 'edgeBundler', 'productionApproval']) assert.ok(!p.requiredGates.includes(key));
  assert.equal(classify([change('scripts/check-success-hero.cjs', { status: 'A', after: fixture + '\nprocess.exit(0);' })]).level, 'L3');
  assert.equal(classify([change('scripts/check-success-hero.cjs', { before: fixture, after: fixture + '\n' })]).level, 'L3');
  assert.equal(classify([change('tests/catalog-layout.test.mjs')]).level, 'L3');
});
test('ordinary business client logic is L2 with full unit and business smoke coverage', () => {
  const p = classify([change('activity-announcement.js', { after: 'function openMenu() {}' })]);
  assert.equal(p.level, 'L2'); assert.equal(p.testScope, 'full');
  assert.ok(p.requiredGates.includes('guestCheckout'));
  assert.equal(p.databaseScope, 'none'); assert.ok(!p.requiredGates.includes('supabase'));
});
test('mixed changes always use highest risk regardless of order', () => {
  for (const files of [ ['styles.css', 'activity-announcement.js'], ['activity-announcement.js', 'styles.css'] ]) assert.equal(classify(files.map(f => change(f))).level, 'L2');
  for (const files of [ ['styles.css', 'app.js'], ['app.js', 'styles.css'] ]) assert.equal(classify(files.map(f => change(f))).level, 'L3');
});
test('every financial/auth/permission/deletion/migration/Edge/release-control path is L3', () => {
  for (const file of ['app.js', 'customer-account.js', 'store-order-rules.js', 'admin-auth.js', 'media-cleanup.js',
    'price.js', 'payment.js', 'permission.js', 'auth/roles.js', 'x.sql', 'supabase/functions/submit-order/index.ts',
    'supabase/functions/submit-order/deno.lock', 'supabase/templates/customer-otp.html', 'package-lock.json',
    'scripts/release-level.mjs', '.github/workflows/release-check.yml', 'AGENTS.md', 'RELEASE-CHECKS.md',
    'unknown.js', '_headers', '_redirects', 'new.zip']) {
    assert.equal(classify([change(file)]).level, 'L3', file);
  }
});
test('ordinary module with backend or sensitive code escalates; no keyword-only downgrade', () => {
  for (const after of ['supabase.rpc("x")', 'price = 2', 'auth.role = "admin"', 'delete object.x']) assert.equal(classify([change('mobile-header.js', { after })]).level, 'L3');
});
test('CSS files can be UI even with checkout in filename; active imports escalate', () => {
  assert.equal(classify([change('checkout-layout.css')]).level, 'L1');
  assert.equal(classify([change('styles.css', { after: '@import "https://example.test/x.css";' })]).level, 'L3');
});
test('passive assets and text-only HTML are L1; executable/structural ambiguity is L3', () => {
  assert.equal(classify([change('assets/image.webp', { status: 'A' })]).level, 'L1');
  assert.equal(classify([change('index.html', { before: '<p class="old">Old</p>', after: '<p class="new">New</p>' })]).level, 'L1');
  for (const after of ['<script>pay()</script>', '<p onclick="pay()">New</p>', '<form action="/pay">New</form>']) assert.equal(classify([change('index.html', { before: '<p>Old</p>', after })]).level, 'L3');
});
test('unknown range, empty diff, deletion, symlink and submodule fail closed', () => {
  assert.equal(classifyChanges([change('styles.css')]).level, 'L3');
  assert.equal(classify([]).level, 'L3');
  for (const extra of [{ status: 'D' }, { status: 'T' }, { mode: '120000' }, { mode: '160000' }, { oldMode: '120000' }]) assert.equal(classify([change('styles.css', extra)]).level, 'L3');
});
test('L1 outcome is independent of absent baseline/db/Edge evidence, but required gates still fail', () => {
  const p = classify([change('styles.css')]);
  const r = createReport(head, 'main', 'L1 fixture', undefined, p);
  assert.equal(r.checks.supabase.status, 'NOT_REQUIRED');
  assert.deepEqual(productionPrerequisites(r), ['cloudflare', 'desktop', 'mobile']);
  assert.match(renderReport(r), /Level: \*\*L1/);
  for (const gate of p.requiredGates) recordCheck(r, gate, 'PASS', 'Synthetic unit fixture');
  assert.equal(outcome(r), 'INCOMPLETE');
  r.finalizedAt = new Date().toISOString();
  assert.equal(outcome(r), 'RELEASE SUCCESS');
  r.checks.mobile.status = 'PENDING'; assert.equal(outcome(r), 'INCOMPLETE');
  r.checks.mobile.status = 'FAIL'; assert.equal(outcome(r), 'RELEASE FAILED');
});
test('L3 keeps all gates, approval and MATCH mandatory; no skip or policy tampering', () => {
  const p = classify([change('supabase/functions/submit-order/index.ts')]);
  assert.deepEqual(p.requiredGates, FULL_GATES);
  const r = createReport(head, 'main', 'L3 fixture', undefined, p);
  assert.ok(productionPrerequisites(r).includes('guestCheckout'));
  const controls = ['frozenVersion', 'edgeBundler', 'productionApproval', 'productionMatch'];
  for (const gate of p.requiredGates.filter(g => !controls.includes(g))) recordCheck(r, gate, 'PASS', 'Synthetic unit fixture');
  for (const gate of controls) assert.throws(() => recordCheck(r, gate, 'PASS', 'Pretend proof'), /Unverified L3 evidence/);
  r.finalizedAt = new Date().toISOString(); assert.equal(outcome(r), 'INCOMPLETE');
  r.checks.productionApproval.status = 'NOT_REQUIRED'; assert.throws(() => validateReport(r), /cannot be skipped/);
  r.checks.productionApproval.status = 'PENDING'; r.classification.level = 'L1';
  assert.throws(() => validateReport(r), /policy mismatch|scope mismatch/);
});

function gitFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'release-level-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  const commit = () => { git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Local fixture'); return git('rev-parse', 'HEAD'); };
  return { root, git, commit };
}
test('Git range includes all commits, rename source and deleted risky paths', () => {
  const f = gitFixture(); writeFileSync(path.join(f.root, 'styles.css'), 'p{}'); const b = f.commit();
  writeFileSync(path.join(f.root, 'payment.js'), 'x=1'); const risk = f.commit();
  writeFileSync(path.join(f.root, 'styles.css'), 'p{color:red}'); const h = f.commit();
  assert.equal(detectRelease(f.root, { base: b, head: h }).level, 'L3');
  assert.equal(detectRelease(f.root, { base: risk, head: h }).level, 'L1');
  f.git('mv', 'payment.js', 'payment.css'); const renamed = f.commit();
  assert.equal(detectRelease(f.root, { base: h, head: renamed }).level, 'L3');
  assert.equal(detectRelease(f.root, { base: renamed, head: b }).level, 'L3');
  assert.equal(detectRelease(f.root, { head: h }).level, 'L3');
  assert.equal(detectRelease(f.root, { base: 'f'.repeat(40), head: h }).level, 'L3');
});
test('CLI skips unrelated APIs and DB execution for L1, and rejects edited classification', () => {
  const f = gitFixture(); mkdirSync(path.join(f.root, 'scripts'));
  for (const file of ['release-report.mjs', 'release-report-core.mjs', 'release-level.mjs', 'release-security.mjs', 'release-live.mjs']) copyFileSync(new URL('../scripts/' + file, import.meta.url), path.join(f.root, 'scripts', file));
  writeFileSync(path.join(f.root, '.gitignore'), '.build/\n'); writeFileSync(path.join(f.root, 'RELEASE-HISTORY.md'), '# History\n');
  writeFileSync(path.join(f.root, 'styles.css'), 'p{}'); const b = f.commit();
  writeFileSync(path.join(f.root, 'styles.css'), 'p{color:red}'); const h = f.commit();
  const run = (...args) => spawnSync(process.execPath, ['scripts/release-report.mjs', ...args], { cwd: f.root, env: checkEnvironment(process.env), encoding: 'utf8' });
  assert.equal(run('init', '--version', h, '--base', b).status, 0);
  for (const gate of ['database', 'supabase', 'edgeBundler', 'productionApproval']) {
    const r = run('check', '--version', h, '--gate', gate); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /NOT_REQUIRED/);
  }
  const file = path.join(f.root, '.build/releases', h, 'report.json');
  const report = JSON.parse(readFileSync(file, 'utf8')); report.classification.diffFingerprint = '0'.repeat(64); writeFileSync(file, JSON.stringify(report));
  assert.equal(run('check', '--version', h, '--gate', 'workingTree').status, 1);
  assert.equal(run('render', '--version', h).status, 1);
  assert.equal(run('finalize', '--version', h).status, 1);
});
test('real bc6f03d diff is L1 when complete known previous-main range is available', () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const p = detectRelease(decodeURIComponent(root), { base: 'fc29a0d1448bf4f834e93913a4596b37875fb6e0', head: 'bc6f03dec64e898da40fa252d2e5e82db71ef45b' });
  assert.equal(p.uncertainty, null, 'Historical L1 proof requires complete Git history; fallback is covered separately');
  assert.equal(p.level, 'L1'); assert.deepEqual(p.files.map(f => f.path).sort(), ['scripts/check-success-hero.cjs', 'styles.css']);
});

test('base policy evaluates explicit candidate root, not a replacement candidate classifier', () => {
  const f = gitFixture(); mkdirSync(path.join(f.root, 'scripts'));
  copyFileSync(new URL('../scripts/release-level.mjs', import.meta.url), path.join(f.root, 'scripts/release-level.mjs'));
  writeFileSync(path.join(f.root, 'styles.css'), 'p{}'); const b = f.commit();
  const policy = path.join(mkdtempSync(path.join(tmpdir(), 'trusted-policy-')), 'policy.mjs');
  writeFileSync(policy, f.git('show', `${b}:scripts/release-level.mjs`));
  writeFileSync(path.join(f.root, 'styles.css'), 'p{color:red}'); const ui = f.commit();
  const classifyHead = h => execFileSync(process.execPath, [policy, '--root', f.root, '--base', b, '--head', h, '--format', 'level'], { encoding: 'utf8' }).trim();
  assert.equal(classifyHead(ui), 'L1');
  writeFileSync(path.join(f.root, 'scripts/release-level.mjs'), "console.log('L1');"); const replaced = f.commit();
  assert.equal(classifyHead(replaced), 'L3');
});

test('CI uses complete Git history; classifier failure retains Docker/concurrency and production stays read-only', () => {
  const ci = readFileSync(new URL('../.github/workflows/release-check.yml', import.meta.url), 'utf8');
  const live = readFileSync(new URL('../.github/workflows/release-production.yml', import.meta.url), 'utf8');
  assert.match(ci, /fetch-depth: 0/);
  assert.match(ci, /github\.event\.before \|\| github\.event\.pull_request\.base\.sha \|\| inputs\.base/);
  for (const job of ['edge-bundler', 'media-concurrency']) {
    const start = ci.indexOf(`  ${job}:`); assert.ok(start >= 0);
    const next = ci.slice(start + 3).search(/^  [a-z][a-z-]*:/m);
    const block = next < 0 ? ci.slice(start) : ci.slice(start, start + 3 + next);
    assert.match(block, /needs: classify\s+if: \$\{\{ always\(\) && needs\.classify\.outputs\.level != 'L1' && needs\.classify\.outputs\.level != 'L2' \}\}/);
  }
  assert.match(live, /base:[\s\S]*?required: true/);
  assert.match(live, /frozenVersion edgeBundler productionApproval cloudflare supabase productionMatch/);
  assert.match(live, /environment: production-verification/);
  assert.doesNotMatch(ci + live, /supabase (?:functions deploy|db push)|wrangler .*deploy/);
  for (const workflow of [ci, live]) {
    assert.match(workflow, /git show "\$RELEASE_BASE_SHA:scripts\/release-level\.mjs"/);
    assert.match(workflow, /node "\$policy" --root "\$GITHUB_WORKSPACE"/);
    assert.doesNotMatch(workflow, /node scripts\/release-level\.mjs/);
    assert.match(workflow, /level=L3/);
    assert.doesNotMatch(workflow, /contents: write|pull_request_target/);
  }
});

test('trusted CI floor only escalates; absent/invalid/mixed scope cannot remove L3 gates', () => {
  for (const minimumLevel of ['L3', '', 'unknown']) {
    const p = classifyChanges([change('styles.css')], { base, head, minimumLevel });
    assert.equal(p.level, 'L3'); assert.deepEqual(p.requiredGates, FULL_GATES);
  }
  assert.equal(classifyChanges([change('app.js')], { base, head, minimumLevel: 'L1' }).level, 'L3');
  const r = createReport(head, 'main', 'L3 evidence cannot be fabricated', undefined, classify([change('app.js')]));
  r.checks.productionApproval = { status: 'PASS', checkedAt: new Date().toISOString(), evidence: 'hand-written' };
  assert.throws(() => validateReport(r), /Unverified L3 evidence/);
});
