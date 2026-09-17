import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { GATES, createReport, recordCheck, outcome, renderReport, appendHistory, isReleaseOrigin, checkEnvironment } from '../scripts/release-report-core.mjs';
import { scanText } from '../scripts/release-security.mjs';

const sha = 'a'.repeat(40);
test('GitHub origin accepts checkout HTTPS with or without .git, not other destinations', () => {
  assert.equal(isReleaseOrigin('https://github.com/chenghanchen/tings-snack-house'), true);
  assert.equal(isReleaseOrigin('https://github.com/chenghanchen/tings-snack-house.git'), true);
  for (const remote of ['https://github.com/other/tings-snack-house', 'https://github.com/chenghanchen/tings-snack-house-extra',
    'https://github.com.evil.test/chenghanchen/tings-snack-house', 'https://user@github.com/chenghanchen/tings-snack-house',
    'http://github.com/chenghanchen/tings-snack-house', 'https://github.com/chenghanchen/tings-snack-house?query=1'])
    assert.equal(isReleaseOrigin(remote), false);
});

test('check children cannot publish fixture summaries or inherit platform credentials', () => {
  const original = { PATH: 'runtime', GITHUB_STEP_SUMMARY: 'parent-summary', CLOUDFLARE_API_TOKEN: 'test-only', SUPABASE_ACCESS_TOKEN: 'test-only' };
  assert.deepEqual(checkEnvironment(original), { PATH: 'runtime' });
  assert.equal(original.GITHUB_STEP_SUMMARY, 'parent-summary');
});
test('missing evidence is INCOMPLETE, any failure wins, all checks required for HEALTHY', () => {
  const report = createReport(sha, 'main', 'Example');
  assert.equal(outcome(report), 'INCOMPLETE');
  assert.doesNotMatch(renderReport(report), /Production: \*\*HEALTHY/);
  assert.throws(() => recordCheck(report, 'tests', 'PASS', ''), /evidence/);
  assert.throws(() => recordCheck(report, 'unknown', 'PASS', 'log'), /Known/);
  recordCheck(report, 'tests', 'FAIL', 'missing dependency');
  assert.equal(outcome(report), 'RELEASE FAILED');
  for (const key of Object.keys(GATES)) recordCheck(report, key, 'PASS', `Actual ${key} evidence`);
  assert.equal(outcome(report), 'INCOMPLETE', 'all checks cannot certify an unfinalized report');
  report.finalizedAt = new Date().toISOString();
  assert.equal(outcome(report), 'RELEASE SUCCESS');
  assert.match(renderReport(report), /Production: \*\*HEALTHY/);
  assert.equal(report.events[0].status, 'FAIL', 'retries preserve the failed event');
  delete report.checks.mobile;
  assert.throws(() => outcome(report), /Invalid check set/);
});

test('history includes failed releases once; finalized reports cannot be rewritten', () => {
  const report = createReport(sha, 'main', 'Failure | <script>\nheading');
  recordCheck(report, 'guestCheckout', 'FAIL', 'Probe rejected');
  assert.throws(() => appendHistory('# History', report), /Finalize/);
  report.finalizedAt = new Date().toISOString();
  const history = appendHistory('# History', report);
  assert.match(history, /FAILED/);
  assert.doesNotMatch(history, /<script>/);
  assert.equal(appendHistory(history, report), history);
  assert.throws(() => recordCheck(report, 'tests', 'PASS', 'log'), /immutable/);
});

test('secret scanner reports positions without exposing values; public anon is not a server secret', () => {
  const secret = ['sb', 'secret', 'X'.repeat(30)].join('_');
  const jwt = role => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'signature'].join('.');
  const findings = scanText(`first line\n${secret}\n${jwt('service_role')}`, 'fixture.txt');
  assert.deepEqual(findings.map(x => x.rule), ['supabase-secret', 'non-public-jwt']);
  assert.equal(findings[0].line, 2);
  assert.ok(!JSON.stringify(findings).includes(secret));
  assert.equal(scanText(jwt('anon'), 'public.js').length, 0);
});

function fixture({ uiOnly = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'tings-release-test-'));
  mkdirSync(path.join(root, 'scripts'));
  for (const file of ['release-report.mjs', 'release-report-core.mjs', 'release-security.mjs', 'release-live.mjs', 'release-level.mjs'])
    copyFileSync(new URL(`../scripts/${file}`, import.meta.url), path.join(root, 'scripts', file));
  writeFileSync(path.join(root, '.gitignore'), '.build/\n');
  writeFileSync(path.join(root, 'RELEASE-HISTORY.md'), '# Release history\n');
  writeFileSync(path.join(root, 'scripts/release-check.mjs'), "console.log('simulated test failure'); process.exit(1);\n");
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Fixture release base');
  let base = git('rev-parse', 'HEAD');
  git('add', '.');
  git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture');
  let version = git('rev-parse', 'HEAD');
  if (uiOnly) {
    base = version;
    writeFileSync(path.join(root, 'styles.css'), 'body { color: black; }');
    git('add', 'styles.css');
    git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'UI fixture');
    version = git('rev-parse', 'HEAD');
  }
  const run = (...args) => spawnSync(process.execPath, ['scripts/release-report.mjs', ...args, ...(args[0] === 'init' ? ['--base', base] : [])], { cwd: root, env: checkEnvironment(process.env), encoding: 'utf8' });
  const load = () => JSON.parse(readFileSync(path.join(root, '.build/releases', version, 'report.json'), 'utf8'));
  return { root, git, version, run, load };
}

test('CLI records failed checks, refuses manual automated PASS, renders and archives failure idempotently', () => {
  const f = fixture();
  assert.equal(f.run('init', '--version', 'HEAD').status, 0);
  assert.equal(f.run('init', '--version', 'HEAD').status, 1, 'must not reset existing evidence');
  assert.equal(f.run('check', '--version', 'HEAD', '--gate', 'workingTree').status, 0);
  assert.equal(f.run('check', '--version', 'HEAD', '--gate', 'tests').status, 1);
  assert.equal(f.load().checks.tests.status, 'FAIL');
  assert.equal(f.load().checks.releaseReport.status, 'PASS');
  assert.equal(f.load().checks.database.status, 'PENDING');
  assert.equal(f.load().checks.releaseHistory.status, 'PENDING');
  assert.equal(f.run('record', '--version', 'HEAD', '--gate', 'tests', '--status', 'PASS', '--evidence', 'pretend').status, 1);
  assert.equal(f.run('render', '--version', 'HEAD').status, 0, 'CI can publish a failure report');
  assert.equal(f.run('finalize', '--version', 'HEAD').status, 1, 'non-success must exit nonzero');
  const history = readFileSync(path.join(f.root, 'RELEASE-HISTORY.md'), 'utf8');
  assert.match(history, /FAILED/);
  assert.equal(f.load().checks.releaseHistory.status, 'PASS', 'failed verification must still archive honestly');
  assert.equal(f.run('finalize', '--version', 'HEAD').status, 1);
  assert.equal(readFileSync(path.join(f.root, 'RELEASE-HISTORY.md'), 'utf8'), history);
});

test('L1 success requires every selected gate plus actual report/history persistence; lost history blocks success', () => {
  const f = fixture({ uiOnly: true });
  assert.equal(f.run('init', '--version', 'HEAD').status, 0);
  const report = f.load();
  for (const gate of report.classification.requiredGates.filter(g => !['releaseHistory', 'mobile'].includes(g))) recordCheck(report, gate, 'PASS', 'Fixture evidence only');
  assert.equal(outcome(report), 'INCOMPLETE');
  recordCheck(report, 'mobile', 'PASS', 'Fixture mobile evidence');
  writeFileSync(path.join(f.root, '.build/releases', f.version, 'report.json'), JSON.stringify(report));
  assert.equal(f.run('render', '--version', 'HEAD').status, 0);
  assert.match(f.run('render', '--version', 'HEAD').stdout, /INCOMPLETE/);
  const finalized = f.run('finalize', '--version', 'HEAD');
  assert.equal(finalized.status, 0, finalized.stderr);
  assert.match(finalized.stdout, /RELEASE SUCCESS/);
  assert.match(readFileSync(path.join(f.root, 'RELEASE-HISTORY.md'), 'utf8'), /RELEASE SUCCESS/);
  writeFileSync(path.join(f.root, 'RELEASE-HISTORY.md'), '# History removed');
  const lost = f.run('render', '--version', 'HEAD');
  assert.equal(lost.status, 1);
  assert.match(lost.stderr, /RELEASE FAILED/);
  assert.doesNotMatch(lost.stdout, /RELEASE SUCCESS/);
});

test('history write prerequisite failure is recorded as FAIL, never successful archival', () => {
  const f = fixture();
  unlinkSync(path.join(f.root, 'RELEASE-HISTORY.md'));
  f.git('add', '-u');
  f.git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Missing history fixture');
  mkdirSync(path.join(f.root, 'RELEASE-HISTORY.md'));
  const version = f.git('rev-parse', 'HEAD');
  assert.equal(f.run('init', '--version', 'HEAD').status, 0);
  const final = f.run('finalize', '--version', 'HEAD');
  assert.equal(final.status, 1);
  assert.match(final.stdout, /RELEASE FAILED/);
  const report = JSON.parse(readFileSync(path.join(f.root, '.build/releases', version, 'report.json'), 'utf8'));
  assert.equal(report.checks.releaseHistory.status, 'FAIL');
  assert.equal(report.finalizedAt, null);
});

test('CLI refuses dirty initialization and stale commit evidence', () => {
  const f = fixture();
  writeFileSync(path.join(f.root, 'dirty.txt'), 'uncommitted');
  assert.equal(f.run('init', '--version', 'HEAD').status, 1);
  f.git('add', 'dirty.txt');
  f.git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Changed source');
  const result = f.run('init', '--version', f.version);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not checked out/);
});

test('CLI refuses to count skipped tests as a complete pass', () => {
  const f = fixture();
  writeFileSync(path.join(f.root, 'scripts/release-check.mjs'), "console.log('ℹ skipped 1');\n");
  f.git('add', '.');
  f.git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Skipped test fixture');
  assert.equal(f.run('init', '--version', 'HEAD').status, 0);
  const result = f.run('check', '--version', 'HEAD', '--gate', 'tests');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /skipped tests are not a complete pass/);
});

test('CLI automatically saves missing live credentials and rejects hand-written platform PASS', () => {
  const f = fixture();
  assert.equal(f.run('init', '--version', 'HEAD').status, 0);
  const run = spawnSync(process.execPath, ['scripts/release-report.mjs', 'check', '--version', 'HEAD', '--gate', 'cloudflare'], { cwd: f.root, encoding: 'utf8', env: { ...checkEnvironment(process.env), CLOUDFLARE_API_TOKEN: '' } });
  assert.equal(run.status, 1);
  assert.equal(f.load().checks.cloudflare.status, 'PENDING');
  assert.match(f.load().checks.cloudflare.evidence, /Missing CLOUDFLARE_API_TOKEN/);
  assert.ok(f.load().checks.cloudflare.checkedAt);
  assert.equal(f.run('record', '--version', 'HEAD', '--gate', 'cloudflare', '--status', 'PASS', '--evidence', 'pretend').status, 1);
});

test('workflow always preserves a report and does not grant repo write/deploy permissions', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release-check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /--gate security/);
  assert.match(workflow, /--gate tests/);
  assert.match(workflow, /--gate database/);
  assert.match(workflow, /if: always\(\)[\s\S]*upload-artifact/);
  assert.match(workflow, /include-hidden-files: true/);
  assert.match(workflow, /npm ci --ignore-scripts/);
});

test('CLI refuses forged L3 approval and legacy schema downgrade on every report path', () => {
  const f = fixture();
  assert.equal(f.run('init', '--version', 'HEAD').status, 0);
  const file = path.join(f.root, '.build/releases', f.version, 'report.json');
  const initial = f.load();
  const forged = structuredClone(initial);
  forged.checks.productionApproval = { status: 'PASS', checkedAt: new Date().toISOString(), evidence: 'forged approval' };
  writeFileSync(file, JSON.stringify(forged));
  for (const command of ['render', 'finalize', 'check']) assert.equal(f.run(command, '--version', 'HEAD', '--gate', 'workingTree').status, 1);
  const legacy = createReport(f.version, 'main', 'Attempted downgrade');
  writeFileSync(file, JSON.stringify(legacy));
  for (const command of ['render', 'finalize', 'check']) assert.equal(f.run(command, '--version', 'HEAD', '--gate', 'workingTree').status, 1);
  writeFileSync(file, JSON.stringify(initial));
  const result = spawnSync(process.execPath, ['scripts/release-report.mjs', 'render', '--version', 'HEAD'], {
    cwd: f.root, encoding: 'utf8', env: { ...checkEnvironment(process.env), RELEASE_GATE_FLOOR: 'L3' },
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /gate floor differs/);
});
