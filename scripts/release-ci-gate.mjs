import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const JOBS = Object.freeze(['classify', 'test', 'edge-bundler', 'media-concurrency']);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const id = value => /^(?:[1-9][0-9]*)$/.test(String(value)) && Number.isSafeInteger(Number(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const retryHint = 'Re-run all jobs; evidence from other attempts is never reused';

export function validateContext(c) {
  if (!object(c) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(c.repository || '') ||
      !id(c.runId) || !id(c.attempt) || !sha(c.checkoutSha) || !sha(c.apiSha) ||
      !['pull_request', 'push', 'workflow_dispatch'].includes(c.event)) throw Error('Invalid run/attempt/event/SHA context');
  if (c.event !== 'pull_request' && c.apiSha !== c.checkoutSha) throw Error('Non-PR API SHA must equal GITHUB_SHA');
}

// Pure decision function; the CLI obtains evidence itself, never from a fixture
// file, artifact, an earlier attempt, or a caller-supplied classification level.
export function evaluateGate(c, needs, jobs) {
  const errors = [], lines = [];
  try { validateContext(c); } catch (e) { return { pass: false, errors: [e.message], lines, retryable: false }; }
  if (!object(needs) || Object.keys(needs).sort().join(',') !== [...JOBS].sort().join(','))
    errors.push('Missing/unknown needs dependencies');
  const classification = needs?.classify?.outputs?.level;
  lines.push(`classification=${classification ?? 'missing'}; valid=${needs?.classify?.outputs?.valid ?? 'missing'}`);
  lines.push(`run_id=${c.runId}; run_attempt=${c.attempt}; api_head_sha=${c.apiSha}; checkout_sha=${c.checkoutSha}`);
  if (!['L1', 'L2', 'L3'].includes(classification)) errors.push('Unknown/missing classification');
  if (needs?.classify?.outputs?.valid !== 'true') errors.push('classify.valid must be exactly true');
  if (!Array.isArray(jobs)) errors.push('Malformed API jobs evidence');
  let retryable = false;
  for (const name of JOBS) {
    const rows = Array.isArray(jobs) ? jobs.filter(j => j?.name === name) : [];
    if (rows.length !== 1) {
      errors.push(`${name}: expected exactly 1 current-attempt record, got ${rows.length}. ${retryHint}`);
      retryable ||= rows.length === 0;
      continue;
    }
    const j = rows[0], n = needs?.[name];
    if (!id(j.id) || String(j.run_id) !== String(c.runId) || String(j.run_attempt) !== String(c.attempt) || j.head_sha !== c.apiSha)
      errors.push(`${name}: wrong/missing job ID, run, attempt or API head SHA`);
    if (j.status !== 'completed') { errors.push(`${name}: status=${j.status ?? 'missing'} is not completed`); retryable = true; }
    const optional = ['L1', 'L2'].includes(classification) && ['edge-bundler', 'media-concurrency'].includes(name);
    const allowed = j.conclusion === 'success' || (optional && j.conclusion === 'skipped');
    const diagnostic = `${name}=${j.conclusion ?? 'missing'}`;
    lines.push(allowed ? `${diagnostic}${optional && j.conclusion === 'skipped' ? ' (permitted)' : ''}`
      : `${diagnostic} → ERROR: ${optional ? 'only success/skipped permitted' : `success required for ${classification ?? 'unknown level'}`}`);
    if (!allowed) errors.push(`${name}: disallowed conclusion ${j.conclusion ?? 'missing'}`);
    if (!object(n) || n.result !== j.conclusion) errors.push(`${name}: needs/API conclusion mismatch or missing result`);
    if (j.conclusion === 'success') {
      if (n?.outputs?.checkout_sha !== c.checkoutSha || n?.outputs?.checkout_run_id !== String(c.runId) ||
          n?.outputs?.checkout_run_attempt !== String(c.attempt))
        errors.push(`${name}: missing/mismatched current-attempt Git checkout proof. ${retryHint}`);
    } else if (j.conclusion === 'skipped' && object(n?.outputs) && Object.keys(n.outputs).length)
      errors.push(`${name}: skipped job must not carry stale outputs`);
  }
  return { pass: errors.length === 0, errors, lines, retryable };
}

// Request only the exact attempt endpoint. Pagination uses monotonically
// constructed URLs; Link headers may not redirect evidence to another scope.
export async function readAttemptJobs(c, { token, fetchImpl = fetch } = {}) {
  validateContext(c);
  if (!token) throw Error('Missing read-only GitHub token');
  const endpoint = `https://api.github.com/repos/${c.repository}/actions/runs/${c.runId}/attempts/${c.attempt}/jobs`;
  const jobs = [], seen = new Set(); let total;
  for (let page = 1; page <= 20; page++) {
    const url = `${endpoint}?per_page=100&page=${page}`;
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error(`GitHub jobs API failed: HTTP ${response.status}`);
    const data = await response.json();
    if (!object(data) || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || !Array.isArray(data.jobs) || data.jobs.length > 100)
      throw Error('Malformed pagination response');
    if (total !== undefined && total !== data.total_count) throw Error('Pagination total_count changed');
    total = data.total_count;
    for (const job of data.jobs) {
      if (!object(job) || !id(job.id) || seen.has(String(job.id))) throw Error('Duplicate/malformed job record in pagination');
      seen.add(String(job.id)); jobs.push(job);
    }
    if (jobs.length > total) throw Error('Pagination returned too many records');
    const link = response.headers.get('link') || '';
    const next = [...link.matchAll(/<([^>]+)>;\s*rel="next"/g)];
    if (next.length > 1) throw Error('Duplicate next-page links');
    if (next.length) {
      const actual = new URL(next[0][1]), expected = new URL(`${endpoint}?per_page=100&page=${page+1}`);
      actual.searchParams.sort(); expected.searchParams.sort();
      if (actual.href !== expected.href || jobs.length >= total || !data.jobs.length) throw Error('Invalid pagination scope/next link');
    } else {
      if (jobs.length !== total || /rel="next"/.test(link)) throw Error('Incomplete pagination');
      return jobs;
    }
  }
  throw Error('Pagination exceeded bounded page limit');
}

export async function verifyRun(c, needs, options = {}) {
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  // Three bounded snapshots, never combine their records. API/protocol failures
  // fail immediately; only missing/in-progress records may settle briefly.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const jobs = await readAttemptJobs(c, options);
      const result = evaluateGate(c, needs, jobs);
      if (result.pass || !result.retryable || attempt === 2) return result;
    } catch (e) { return { pass: false, lines: [], errors: [e.message], retryable: false }; }
    await sleep(2000);
  }
}

export function contextFromEnvironment(env, event, checkoutHead) {
  const c = { repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
    event: env.GITHUB_EVENT_NAME, checkoutSha: env.GITHUB_SHA,
    apiSha: env.GITHUB_EVENT_NAME === 'pull_request' ? event?.pull_request?.head?.sha : env.GITHUB_SHA };
  validateContext(c);
  if (checkoutHead !== c.checkoutSha) throw Error('release-gate checkout HEAD != GITHUB_SHA');
  return c;
}

async function main() {
  let result;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const checkoutHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const c = contextFromEnvironment(process.env, event, checkoutHead);
    const needs = JSON.parse(process.env.RELEASE_NEEDS_JSON || 'null');
    result = await verifyRun(c, needs, { token: process.env.GITHUB_TOKEN });
  } catch (e) { result = { pass: false, lines: [], errors: [e.message] }; }
  const report = [...result.lines, ...result.errors.map(e => `ERROR: ${e}`), `release-gate=${result.pass ? 'PASS' : 'FAIL'}`].join('\n');
  // Prevent untrusted text from becoming runner commands/Markdown or spilling a token.
  const safe = report.replaceAll(process.env.GITHUB_TOKEN || '\0', '[redacted]').replaceAll('::', ': :');
  console.log(safe);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### release-gate\n\n\`\`\`text\n${safe.replaceAll('`', "'")}\n\`\`\`\n`);
  if (!result.pass) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
