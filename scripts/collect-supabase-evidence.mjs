import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText } from './release-security.mjs';

export const PROJECT = 'ragqunnuxsfwhrfqpylg';
export const SLUGS = ['submit-order', 'admin-media-cleanup'];
const MAX_BYTES = 20 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const normalized = text => text.replace(/\r\n/g, '\n');
class EvidenceError extends Error {}
const unavailable = message => { throw new EvidenceError(message); };

async function request(slug, body, token, fetcher) {
  let response;
  try {
    response = await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}/functions/${slug}${body ? '/body' : ''}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, Accept: body ? 'multipart/form-data' : 'application/json' },
    });
  } catch { unavailable('Management API unavailable; no raw error retained'); }
  if (!response.ok) unavailable(`Management API HTTP ${response.status}`);
  // Bound memory even if the server omits Content-Length. Never persist raw API responses.
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) unavailable('Management response exceeds collection limit');
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), contentType: response.headers.get('content-type') || '' };
}

function metadata(bytes, slug) {
  let f;
  try { f = JSON.parse(bytes.toString('utf8')); } catch { unavailable('Unreadable function metadata'); }
  if (f.slug !== slug || !Number.isInteger(f.version) || f.version < 1 || typeof f.verify_jwt !== 'boolean')
    unavailable('Incomplete function identity/configuration');
  return { slug, version: f.version, active: f.status === 'ACTIVE', verifyJwt: f.verify_jwt,
    bundleSha256: /^[a-f0-9]{64}$/.test(f.ezbr_sha256 || '') ? f.ezbr_sha256 : null };
}

export async function collectFunction(slug, { token, sources, fetcher = fetch }) {
  if (!SLUGS.includes(slug)) throw new Error('Function outside fixed scope');
  if (!token) return { slug, collection: 'PENDING', reason: 'Missing SUPABASE_ACCESS_TOKEN' };
  try {
    const before = metadata((await request(slug, false, token, fetcher)).bytes, slug);
    const body = await request(slug, true, token, fetcher);
    const after = metadata((await request(slug, false, token, fetcher)).bytes, slug);
    if (JSON.stringify(before) !== JSON.stringify(after))
      return { slug, collection: 'PENDING', reason: 'Deployment changed during capture; retry required' };
    const base = { ...before, stableDuringCapture: true, bodyResponseSha256: hash(body.bytes), bodyBytes: body.bytes.length,
      configuration: before.active && before.verifyJwt ? 'PASS' : 'FAIL', review: 'PENDING' };
    if (!body.contentType.toLowerCase().startsWith('multipart/form-data'))
      return { ...base, collection: 'PENDING', reason: 'Unsupported body representation; raw body withheld' };
    let form;
    try { form = await new Response(body.bytes, { headers: { 'Content-Type': body.contentType } }).formData(); }
    catch { unavailable('Cannot parse function source response; raw body withheld'); }
    const expected = sources.filter(f => f.path.startsWith(`supabase/functions/${slug}/`) || f.path.startsWith('supabase/functions/_shared/'));
    const files = [];
    let unsafe = false;
    for (const [, part] of form.entries()) {
      if (typeof part === 'string') continue; // Body metadata is deliberately not exported.
      const bytes = Buffer.from(await part.arrayBuffer());
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { files.push({ ordinal: files.length + 1, sha256: hash(bytes), bytes: bytes.length, comparison: 'UNSUPPORTED_BINARY' }); continue; }
      if (text.includes(token) || scanText(text, 'production-source').length || /\bsbp_[A-Za-z0-9_-]{20,}/.test(text)) {
        unsafe = true;
        files.push({ ordinal: files.length + 1, comparison: 'WITHHELD_POTENTIAL_SECRET' });
        continue;
      }
      const matches = expected.filter(f => normalized(f.text) === normalized(text)).map(f => f.path);
      // Never export API-controlled filenames or source text. Matched paths come only from Git.
      files.push({ ordinal: files.length + 1, sha256: hash(bytes), normalizedSha256: hash(normalized(text)), bytes: bytes.length,
        comparison: matches.length ? 'MATCH' : 'UNMATCHED', matchingGitPaths: matches });
    }
    const covered = new Set(files.flatMap(f => f.matchingGitPaths || []));
    const missingGitPaths = expected.filter(f => !covered.has(f.path)).map(f => f.path);
    const sourceMatch = expected.length > 0 && files.length > 0 && !missingGitPaths.length && files.every(f => f.comparison === 'MATCH');
    return { ...base, collection: files.length && !unsafe ? 'COLLECTED' : 'PENDING',
      sourceComparison: sourceMatch ? 'MATCH' : 'PENDING', files, missingGitPaths,
      ...(unsafe ? { reason: 'Potential credential in production source; source and sensitive fingerprints withheld' } : {}) };
  } catch (error) {
    return { slug, collection: 'PENDING', reason: error instanceof EvidenceError ? error.message : 'Evidence processing failed; raw error withheld' };
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: MAX_BYTES }).trim();
  if (git('status', '--porcelain')) throw new Error('Evidence requires a clean committed checkout');
  const sourceCommit = git('rev-parse', 'HEAD');
  const sources = git('ls-files', 'supabase/functions').split('\n').filter(Boolean).map(file => ({
    path: file, text: execFileSync('git', ['show', `${sourceCommit}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: MAX_BYTES }),
  }));
  const report = { schemaVersion: 1, project: PROJECT, sourceCommit, collectedAt: new Date().toISOString(),
    purpose: 'Production source evidence only; not a reviewed baseline or release certification',
    releaseOutcome: 'INCOMPLETE', review: 'PENDING', migrationVerification: 'NOT_PERFORMED', functions: [] };
  for (const slug of SLUGS) report.functions.push(await collectFunction(slug, { token: process.env.SUPABASE_ACCESS_TOKEN, sources }));
  const directory = path.join(root, '.build', 'supabase-evidence');
  mkdirSync(directory, { recursive: true });
  const output = JSON.stringify(report, null, 2) + '\n';
  if (scanText(output, 'evidence').length || (process.env.SUPABASE_ACCESS_TOKEN && output.includes(process.env.SUPABASE_ACCESS_TOKEN)))
    throw new Error('Evidence withheld by secret scan');
  writeFileSync(path.join(directory, 'evidence.json'), output);
  const summary = `## Supabase production evidence\n\nCommit: ${sourceCommit}\n\n` +
    '| Function | Capture | Version | Active / JWT | Source vs Git | Review |\n| --- | --- | --- | --- | --- | --- |\n' +
    report.functions.map(f => `| ${f.slug} | ${f.collection} | ${f.version ?? 'unknown'} | ${f.active ?? 'unknown'} / ${f.verifyJwt ?? 'unknown'} | ${f.sourceComparison || 'PENDING'} | PENDING |`).join('\n') +
    '\n\nINCOMPLETE — evidence collection is not baseline approval or a full release. No function invocation, deployment, database query or mutation performed. Raw source is not uploaded.\n';
  writeFileSync(path.join(directory, 'summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  process.exitCode = report.functions.every(f => f.collection === 'COLLECTED' && f.configuration === 'PASS') ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Evidence collection incomplete; raw error withheld'); process.exitCode = 1; });
}
