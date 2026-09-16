import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReport, validateReport, recordCheck, renderReport, appendHistory, outcome, isReleaseOrigin, checkEnvironment } from './release-report-core.mjs';
import { scanText } from './release-security.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30_000 }).trim();
function options(args) {
  const result = {};
  while (args.length) {
    const key = args.shift();
    if (!/^--[a-z-]+$/.test(key) || !args.length || args[0].startsWith('--')) throw new Error('Options require --name value');
    if (Object.hasOwn(result, key.slice(2))) throw new Error('Duplicate option');
    result[key.slice(2)] = args.shift();
  }
  return result;
}
function assertClean() {
  if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('Working tree is dirty; evidence must describe the committed release, not uncommitted source');
}

try {
  const [command, ...args] = process.argv.slice(2);
  const opt = options(args);
  if (!['init', 'check', 'record', 'render', 'finalize', 'diagnose'].includes(command))
    throw new Error('Usage: release-report.mjs init|check|record|render|finalize --version <commit> [--gate ... --status PASS|FAIL --evidence ...]');
  if (!opt.version || !/^[A-Za-z0-9_./-]+$/.test(opt.version) || opt.version.startsWith('-')) throw new Error('--version is required');
  const version = git('rev-parse', '--verify', `${opt.version}^{commit}`);
  if (version !== git('rev-parse', 'HEAD')) throw new Error('Requested release is not checked out; refusing stale evidence');
  const directory = path.join(root, '.build', 'releases', command === 'diagnose' ? `diagnostic-${version}-${Date.now()}` : version);
  const reportFile = path.join(directory, 'report.json');
  let report;
  if (command === 'init' || command === 'diagnose') {
    if (command === 'init') assertClean();
    if (existsSync(reportFile)) throw new Error('Report already exists; it will not be overwritten');
    const branch = git('branch', '--show-current') || process.env.GITHUB_REF_NAME;
    report = createReport(version, branch, opt.title || git('log', '-1', '--format=%s'));
    mkdirSync(directory, { recursive: true });
  } else {
    report = validateReport(JSON.parse(readFileSync(reportFile, 'utf8')));
    if (report.version !== version) throw new Error('Report commit mismatch');
  }
  const save = () => {
    writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    writeFileSync(path.join(directory, 'report.md'), renderReport(report));
    if (JSON.stringify(JSON.parse(readFileSync(reportFile, 'utf8'))) !== JSON.stringify(report) || readFileSync(path.join(directory, 'report.md'), 'utf8') !== renderReport(report))
      throw new Error('Release Report read-back verification failed');
    if (!report.finalizedAt && report.checks.releaseReport.status !== 'PASS') {
      recordCheck(report, 'releaseReport', 'PASS', 'report.json and report.md generated and verified by read-back');
      save();
    }
  };
  if (command === 'diagnose') {
    report.title = `DIAGNOSTIC ONLY — ${report.title}`;
    recordCheck(report, 'workingTree', 'PENDING', 'Diagnostic run; uncommitted tooling permitted, not release certification and not appended to history');
    for (const [gate, script] of Object.entries({ tests: 'release-check.mjs', database: 'release-database.mjs', security: 'release-security.mjs', guestCheckout: 'check-guest-checkout-live.mjs' })) {
      const run = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...(gate === 'tests' ? ['--unit-only'] : [])], { cwd: root, env: checkEnvironment(process.env), encoding: 'utf8', timeout: 240_000, maxBuffer: 8 * 1024 * 1024 });
      const output = `${run.stdout || ''}\n${run.stderr || ''}`;
      const safe = scanText(output, 'diagnostic-output').length ? '[Output withheld: potential credential detected]' : output;
      writeFileSync(path.join(directory, `${gate}.log`), safe);
      const passed = run.status === 0 && !run.error && !(['tests', 'database'].includes(gate) && /(?:\bskipped|# skip)\s+[1-9]\d*/i.test(output));
      recordCheck(report, gate, passed ? 'PASS' : 'FAIL', `Diagnostic ${script}; exit=${run.status}; log=${gate}.log; tests/security describe current working source, not a certified release`);
      save();
    }
    const { liveCheck } = await import('./release-live.mjs');
    for (const gate of ['cloudflare', 'supabase', 'desktop', 'mobile', 'production']) {
      const check = await liveCheck(gate, { root, version, directory, report });
      if (scanText(check.evidence, 'diagnostic-evidence').length) { check.status = 'FAIL'; check.evidence = 'Evidence withheld: potential credential detected'; }
      recordCheck(report, gate, check.status, check.evidence, undefined, check.requirements);
      save();
      console.log(`${gate}: ${check.status} — ${check.evidence}`);
    }
    console.log(`Diagnostic artifacts: ${directory}`);
    process.exitCode = outcome(report) === 'RELEASE SUCCESS' ? 0 : 1;
  }
  if (command === 'check') {
    if (report.finalizedAt) throw new Error('Finalized report cannot be changed');
    let status = 'PASS';
    let evidence;
    let requirements;
    try {
      assertClean();
      if (opt.gate === 'workingTree') evidence = 'git status --porcelain: clean; HEAD matches full report SHA';
      else if (opt.gate === 'github') {
        const remote = git('remote', 'get-url', 'origin');
        if (!isReleaseOrigin(remote)) throw new Error('Unexpected origin; verify destination manually');
        if (report.branch !== 'main') throw new Error('Production release must target main');
        const result = git('ls-remote', '--exit-code', 'origin', 'refs/heads/main');
        if (result.split(/\s+/)[0] !== version) throw new Error('GitHub main does not match the release SHA');
        evidence = 'Read-only ls-remote verified origin/main equals the full release SHA';
      } else if (['cloudflare', 'supabase', 'desktop', 'mobile', 'production'].includes(opt.gate)) {
        const { liveCheck } = await import('./release-live.mjs');
        ({ status, evidence, requirements } = await liveCheck(opt.gate, { root, version, directory, report }));
        if (scanText(evidence, 'live-evidence').length) throw new Error('Live evidence withheld: potential credential detected');
      } else {
        const scripts = { security: 'release-security.mjs', tests: 'release-check.mjs', database: 'release-database.mjs', guestCheckout: 'check-guest-checkout-live.mjs' };
        if (!Object.hasOwn(scripts, opt.gate)) throw new Error('Unknown check gate; report/history are verified during save/finalize');
        const run = spawnSync(process.execPath, [path.join(root, 'scripts', scripts[opt.gate]), ...(opt.gate === 'tests' ? ['--unit-only'] : [])], {
          cwd: root, env: checkEnvironment(process.env), encoding: 'utf8', timeout: 240_000, maxBuffer: 8 * 1024 * 1024,
        });
        const output = `${run.stdout || ''}\n${run.stderr || ''}`;
        // Do not persist credential-bearing output to an uploaded artifact.
        const safeOutput = scanText(output, 'check-output').length ? '[Output withheld: potential credential detected]\n' : output;
        const logName = `${opt.gate}-${Date.now()}.log`;
        writeFileSync(path.join(directory, logName), safeOutput);
        const skippedTests = ['tests', 'database'].includes(opt.gate) && /(?:\bskipped|# skip)\s+[1-9]\d*/i.test(output);
        status = run.status === 0 && !run.error && !skippedTests ? 'PASS' : 'FAIL';
        evidence = `node scripts/${scripts[opt.gate]}; exit=${run.status ?? 'no exit'}; log=${logName}`;
        if (run.error) evidence += `; error=${run.error.code || 'execution failed'}`;
        if (skippedTests) evidence += '; skipped tests are not a complete pass';
      }
      assertClean();
    } catch (error) { status = 'FAIL'; evidence = error.message; }
    recordCheck(report, opt.gate, status, evidence, undefined, requirements);
    if (status !== 'PASS') process.exitCode = 1;
  }
  if (command === 'record') {
    throw new Error('This gate is automated; use check, not a manual PASS');
  }
  if (command === 'finalize') {
    const historyFile = path.join(root, 'RELEASE-HISTORY.md');
    if (!report.finalizedAt) {
      assertClean();
      // Refresh the clean-tree gate at the final boundary; appending history is
      // the one intentional post-release source change, documented separately.
      recordCheck(report, 'workingTree', 'PASS', 'Clean release checkout confirmed immediately before history append');
      save();
      const original = structuredClone(report);
      let history, wroteHistory = false;
      try {
        history = readFileSync(historyFile, 'utf8');
        if (history.includes(`<!-- release:${version} -->`)) throw new Error('History already contains this SHA; refusing conflicting archive');
        recordCheck(report, 'releaseHistory', 'PASS', 'RELEASE-HISTORY.md archived with version marker and exact report; read-back verified');
        report.finalizedAt = new Date().toISOString();
        report.updatedAt = report.finalizedAt;
        // Persist report, then archive it; never emit success before both read-back checks.
        save();
        const archived = appendHistory(history, report);
        writeFileSync(historyFile, archived);
        wroteHistory = true;
        if (readFileSync(historyFile, 'utf8') !== archived) throw new Error('Release History read-back verification failed');
      } catch (error) {
        if (wroteHistory) writeFileSync(historyFile, history);
        report = original;
        recordCheck(report, 'releaseHistory', 'FAIL', `History archival failed: ${error.code || error.message}`);
        save();
        process.exitCode = 1;
      }
    }
    if (outcome(report) !== 'RELEASE SUCCESS') process.exitCode = 1;
  }
  if (report.finalizedAt) {
    // Also enforce this on render/retry: a lost or interrupted archive is not success.
    const history = readFileSync(path.join(root, 'RELEASE-HISTORY.md'), 'utf8');
    if (!history.includes(`<!-- release:${version} -->\n${renderReport(report)}`))
      throw new Error('Release History missing or inconsistent with finalized report');
  }
  save();
  const markdown = renderReport(report);
  console.log(markdown);
  if (command === 'render' && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
} catch (error) {
  console.error(`RELEASE FAILED: ${error.message}`);
  process.exitCode = 1;
}
