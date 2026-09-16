import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// High-confidence worktree secret scan, not a dependency/security audit.
// Report locations and rule names only; never print credential values.
export function scanText(source, file) {
  const findings = [];
  const rules = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ['supabase-secret', /\bsb_secret_[A-Za-z0-9_-]{16,}/g],
    ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
    ['stripe-secret', /\bsk_live_[A-Za-z0-9]{16,}/g],
    ['database-password', /postgres(?:ql)?:\/\/[^\s:'"/]+:[^\s@'"/]{8,}@/g],
    ['literal-server-secret', /(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN|CLOUDFLARE_API_TOKEN|ORDER_RATE_LIMIT_SALT)\s*[:=]\s*['"][A-Za-z0-9_\/.+=-]{24,}['"]/g],
  ];
  function add(rule, index) { findings.push({ file, line: source.slice(0, index).split('\n').length, rule }); }
  for (const [rule, pattern] of rules) for (const match of source.matchAll(pattern)) add(rule, match.index);
  for (const match of source.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      const claims = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString());
      if (claims.role !== 'anon' || claims.sub) add('non-public-jwt', match.index);
    } catch { add('unrecognized-jwt', match.index); }
  }
  return findings;
}

export function scanWorkspace(root) {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  const findings = [];
  let count = 0;
  for (const file of new Set(files.split('\0').filter(Boolean))) {
    let bytes;
    try { bytes = readFileSync(path.join(root, file)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    // Known binary assets are outside this source/config scan.
    if (/\.(?:png|webp|jpe?g|gif|ico|woff2?|ttf|mp4|zip|pdf)$/i.test(file)) continue;
    count++;
    findings.push(...scanText(bytes.toString('utf8'), file));
  }
  return { count, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = scanWorkspace(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
    for (const finding of result.findings) console.error(`${finding.file}:${finding.line} [${finding.rule}]`);
    console.log(`Secret scan: ${result.findings.length ? 'FAIL' : 'PASS'} (${result.count} source/config files; excludes ignored files and Git history)`);
    process.exitCode = result.findings.length ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
