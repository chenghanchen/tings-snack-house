import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
export function validateToolchain(policy) {
  if (!/^\d+\.\d+\.\d+$/.test(policy.denoVersion || '') ||
      JSON.stringify([...(policy.functions || [])].sort()) !== JSON.stringify(['admin-media-cleanup', 'submit-order']))
    throw new Error('Both production functions and an exact Deno version are required');
}
export function validateDependencyPolicy(config, lock, source, version) {
  if (config.lock?.frozen !== true || config.lock?.path !== './deno.lock' || config.nodeModulesDir !== 'none')
    throw new Error('Each function must use its own frozen deno.lock without node_modules fallback');
  const specifier = `npm:@supabase/supabase-js@${version}`;
  if (!/^\d+\.\d+\.\d+$/.test(version) || !source.includes(`from "${specifier}"`) ||
      lock.specifiers?.[specifier] !== version)
    throw new Error('Supabase JS source and lock must agree on the exact reviewed version');
  if (lock.version !== '5' || !lock.npm?.[`@supabase/supabase-js@${version}`])
    throw new Error('Missing supported Deno dependency graph');
  for (const [pkg, entry] of Object.entries(lock.npm)) {
    if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity || ''))
      throw new Error(`Missing SHA512 integrity for ${pkg}`);
  }
}

export function checkDependencies() {
  const policy = JSON.parse(read('supabase/edge-toolchain.json'));
  validateToolchain(policy);
  const deno = process.env.DENO_BIN || 'deno';
  // No application code is executed and no platform credentials are needed.
  const env = { ...process.env, DENO_NO_UPDATE_CHECK: '1' };
  for (const key of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|SERVICE_ROLE|ANON_KEY/i.test(key)) delete env[key];
  const version = spawnSync(deno, ['--version'], { cwd: root, env, encoding: 'utf8', timeout: 15000 });
  if (version.status !== 0 || /^deno (\d+\.\d+\.\d+)(?:\s|$)/.exec(version.stdout || '')?.[1] !== policy.denoVersion)
    throw new Error(`Deno ${policy.denoVersion} required; install it or set DENO_BIN. Check cannot be skipped.`);
  for (const slug of policy.functions) {
    const directory = `supabase/functions/${slug}`;
    const lockPath = `${directory}/deno.lock`;
    const before = read(lockPath);
    validateDependencyPolicy(JSON.parse(read(`${directory}/deno.json`)), JSON.parse(before), read(`${directory}/index.ts`), policy.supabaseJsVersion);
    // Fresh CI caches verify downloaded tarballs against the committed integrity.
    const run = spawnSync(deno, ['check', '--frozen', '--config', `${directory}/deno.json`, `${directory}/index.ts`], {
      cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    });
    process.stdout.write((run.stdout || '') + (run.stderr || ''));
    if (run.error || run.status !== 0 || read(lockPath) !== before)
      throw new Error(`${slug}: frozen dependency/type check failed (lockfile must not change)`);
    console.log(`Edge dependencies PASS: ${slug}; Supabase JS ${policy.supabaseJsVersion}; Deno ${policy.denoVersion}; frozen integrity lock`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkDependencies(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
