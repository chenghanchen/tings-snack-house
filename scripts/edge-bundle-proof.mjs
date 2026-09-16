import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync, chmodSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Verified via Docker Hub registry manifest: official v1.74.3, Linux amd64.
// CLI v2.117.0 pins v1.74.3. Never execute a mutable image tag.
const image = 'supabase/edge-runtime@sha256:cc355c3d0e9c063a351cad56d1c4c52a3c4d85aff4e1fad9d91688e75f9aad09';
const packageKey = '@supabase/supabase-js@2.116.0';
export function classifyCase(mode, r) {
  if (r.error || r.signal || r.status === null || !r.lockUnchanged) return 'PENDING';
  if (mode !== 'tampered') return r.status === 0 && r.bundleBytes > 0 ? 'PASS' : 'FAIL';
  if (r.status === 0 || r.bundleBytes > 0) return 'FAIL';
  return /(?:integrity|checksum|hash)[\s\S]{0,120}(?:mismatch|check failed|does not match|did not match|verification failed|invalid)/i.test(r.log)
    && /@supabase\/supabase-js/.test(r.log) ? 'PASS' : 'PENDING';
}
function copySources(from, to, manifest, prefix = '') {
  mkdirSync(to, { recursive: true });
  for (const item of readdirSync(from, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('Symlinks forbidden');
    if (item.isDirectory()) {
      if (!item.name.startsWith('.') && item.name !== 'node_modules') copySources(path.join(from, item.name), path.join(to, item.name), manifest, prefix + item.name + '/');
    } else if (/\.(?:ts|mjs|json|lock)$/.test(item.name)) {
      const source = path.join(from, item.name);
      copyFileSync(source, path.join(to, item.name));
      manifest[prefix + item.name] = hash(readFileSync(source));
    }
  }
}
async function main() {
  const base = path.join(root, '.build/edge-bundle-proof');
  const evidence = path.join(base, 'evidence');
  mkdirSync(evidence, { recursive: true });
  const report = { schemaVersion: 1, scope: 'Isolated Docker bundler, NOT remote API bundler or production verification',
    commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, image, runtime: '1.74.3', cliReference: '2.117.0',
    startedAt: new Date().toISOString(), result: 'PENDING', cases: [] };
  const dockerConfig = path.join(base, 'empty-docker-config');
  mkdirSync(dockerConfig, { recursive: true });
  // Allowlist; no cloud token, .env, Docker credentials or host config passed.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_CONFIG: dockerConfig };
  function docker(args, label, timeout = 240000) {
    const r = spawnSync('docker', args, { cwd: root, env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
    const log = (r.stdout || '') + (r.stderr || '');
    writeFileSync(path.join(evidence, label + '.log'), log);
    return { status: r.status, signal: r.signal, error: r.error?.code, log };
  }
  try {
    if (process.platform !== 'linux') throw new Error('Requires Linux Docker; Deno check is not a substitute');
    if (docker(['pull', image], 'pull', 300000).status !== 0) throw new Error('Image pull failed');
    const inspect = docker(['image', 'inspect', image], 'image-inspect');
    if (inspect.status !== 0) throw new Error('Image inspection failed');
    report.imageId = JSON.parse(inspect.log)[0].Id;
    for (const slug of ['submit-order', 'admin-media-cleanup']) {
      for (const mode of ['normal', 'tampered', 'control']) {
        const label = `${slug}-${mode}`;
        const fixture = path.join(base, label);
        if (existsSync(fixture)) throw new Error('Stale fixture; use fresh checkout');
        const sources = path.join(fixture, 'functions');
        const sourceManifest = {};
        // Only source already authorized for this PUBLIC GitHub test branch.
        // No repository root, .env, credential directory or Docker socket mounted.
        copySources(path.join(root, 'supabase/functions'), sources, sourceManifest);
        const lock = path.join(sources, slug, 'deno.lock');
        const config = JSON.parse(readFileSync(path.join(sources, slug, 'deno.json'), 'utf8'));
        if (config.lock?.path !== './deno.lock' || config.lock?.frozen !== true) throw new Error('Expected explicit frozen lock');
        const original = readFileSync(lock);
        if (mode === 'tampered') {
          const parsed = JSON.parse(original);
          if (!parsed.npm?.[packageKey]?.integrity?.startsWith('sha512-')) throw new Error('Missing package integrity');
          const bad = 'sha512-' + Buffer.alloc(64).toString('base64');
          if (parsed.npm[packageKey].integrity === bad) throw new Error('Mutation must change integrity');
          parsed.npm[packageKey].integrity = bad;
          writeFileSync(lock, JSON.stringify(parsed, null, 2) + '\n');
        }
        const before = hash(readFileSync(lock));
        const output = path.join(fixture, 'output');
        mkdirSync(output, { recursive: true }); chmodSync(output, 0o777);
        const target = `/workspace/supabase/functions/${slug}`;
        const args = ['run', '--rm', '--pull=never', '--network=bridge', '--cap-drop=ALL', '--security-opt=no-new-privileges',
          '--mount', `type=bind,src=${sources},dst=/workspace/supabase/functions,readonly`,
          '--mount', `type=bind,src=${output},dst=/out`, '--workdir', '/workspace',
          '-e', 'DENO_DIR=/tmp/fresh-deno-cache', '-e', 'DENO_NO_PACKAGE_JSON=1', image,
          'bundle', '--entrypoint', `${target}/index.ts`, '--output', '/out/output.eszip',
          '--static', `${target}/deno.lock`, '--disable-module-cache', '--timeout', '180'];
        const outcome = docker(args, label);
        const bundle = path.join(output, 'output.eszip');
        const bytes = existsSync(bundle) ? readFileSync(bundle) : Buffer.alloc(0);
        const r = { slug, mode, sourceManifest, originalLockSha256: hash(original), lockSha256: before,
          lockUnchanged: hash(readFileSync(lock)) === before, command: ['docker', ...args],
          status: outcome.status, signal: outcome.signal, error: outcome.error, bundleBytes: bytes.length,
          bundleSha256: bytes.length ? hash(bytes) : null, logFile: label + '.log' };
        r.result = classifyCase(mode, { ...r, log: outcome.log });
        report.cases.push(r);
        console.log(`${label}: ${r.result}; exit=${r.status}; bundleBytes=${r.bundleBytes}`);
        if (r.result !== 'PASS' || mode === 'tampered') console.log(outcome.log);
      }
    }
    report.result = report.cases.some(r => r.result === 'FAIL') ? 'FAIL'
      : report.cases.length === 6 && report.cases.every(r => r.result === 'PASS') ? 'PASS' : 'PENDING';
  } catch (error) {
    report.error = error.message;
    if (report.cases.some(r => r.result === 'FAIL')) report.result = 'FAIL';
    console.error(error.message);
  } finally {
    report.finishedAt = new Date().toISOString();
    writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    const summary = `## Edge lockfile Docker proof: ${report.result}\n\nCommit: ${report.commit}\n\nImage: ${image}\n\n${report.scope}\n\n| Function | Case | Result | Exit | Bundle bytes |\n|---|---|---|---|---|\n` +
      report.cases.map(r => `| ${r.slug} | ${r.mode} | ${r.result} | ${r.status} | ${r.bundleBytes} |`).join('\n') +
      `\n\n${report.error || ''}\n\nNo deployment, production credentials or production requests.\n`;
    writeFileSync(path.join(evidence, 'SUMMARY.md'), summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    console.log(summary); process.exitCode = report.result === 'PASS' ? 0 : 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
