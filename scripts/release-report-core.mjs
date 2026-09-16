export const GATES = Object.freeze({
  workingTree: 'Git', tests: 'Tests', database: 'Database', security: 'Security',
  github: 'GitHub', cloudflare: 'Cloudflare', supabase: 'Supabase',
  desktop: 'Desktop', mobile: 'Mobile', guestCheckout: 'Guest checkout', production: 'Production smoke test',
  releaseReport: 'Release Report', releaseHistory: 'Release History',
});

export function createReport(version, branch, title, now = new Date().toISOString()) {
  if (!/^[0-9a-f]{40}$/.test(version)) throw new Error('Full commit SHA required');
  if (!title?.trim() || !branch?.trim()) throw new Error('Title and branch required');
  return { schemaVersion: 2, version, branch, title, createdAt: now, updatedAt: now,
    checks: Object.fromEntries(Object.keys(GATES).map(key => [key, { status: 'PENDING', evidence: '', checkedAt: null }])),
    events: [], finalizedAt: null };
}

export function validateReport(report) {
  if (report?.schemaVersion !== 2 || !/^[0-9a-f]{40}$/.test(report.version || '') || !report.branch || !report.title)
    throw new Error('Invalid report identity');
  if (Object.keys(report.checks || {}).length !== Object.keys(GATES).length) throw new Error('Invalid check set');
  for (const key of Object.keys(GATES)) {
    const check = report.checks[key];
    if (!check || !['PASS', 'FAIL', 'PENDING'].includes(check.status)) throw new Error(`Invalid gate: ${key}`);
    if (check.status !== 'PENDING' && (!check.evidence?.trim() || !Number.isFinite(Date.parse(check.checkedAt))))
      throw new Error(`Missing evidence/date: ${key}`);
  }
  return report;
}

export function recordCheck(report, key, status, evidence, now = new Date().toISOString()) {
  validateReport(report);
  if (report.finalizedAt) throw new Error('Finalized report is immutable; create a new release commit to retry');
  if (!Object.hasOwn(GATES, key) || !['PASS', 'FAIL', 'PENDING'].includes(status) || !evidence?.trim())
    throw new Error('Known gate, PASS/FAIL/PENDING and nonempty evidence required');
  report.checks[key] = { status, evidence: evidence.trim(), checkedAt: now };
  report.events.push({ gate: key, ...report.checks[key] });
  report.updatedAt = now;
  return report;
}

export function outcome(report) {
  validateReport(report);
  const checks = Object.values(report.checks);
  if (checks.some(check => check.status === 'FAIL')) return 'RELEASE FAILED';
  if (checks.some(check => check.status !== 'PASS')) return 'INCOMPLETE';
  if (!report.finalizedAt) return 'INCOMPLETE';
  return 'RELEASE SUCCESS';
}

const inline = value => String(value).replace(/[\r\n|]/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function renderReport(report) {
  const status = outcome(report);
  return `## ${report.createdAt.slice(0, 10)} · ${report.version.slice(0, 7)} · ${inline(report.title)}\n\n` +
    `**${status}${status === 'RELEASE SUCCESS' ? ' ✓' : status === 'RELEASE FAILED' ? ' ✕' : ''}**\n\nVersion: \`${report.version}\`\n\nBranch: \`${inline(report.branch)}\`\n\n` +
    `Updated: ${report.updatedAt}\n\n| Check | Result | Evidence | Checked at |\n| --- | --- | --- | --- |\n` +
    Object.entries(GATES).map(([key, label]) => {
      const check = report.checks[key];
      return `| ${label} | ${check.status} | ${inline(check.evidence || '未验证')} | ${check.checkedAt || '—'} |`;
    }).join('\n') + `\n\nProduction: **${status === 'RELEASE SUCCESS' ? 'HEALTHY' : 'NOT VERIFIED HEALTHY'}**\n\n` +
    (status === 'RELEASE SUCCESS' ? '全部必需门禁已有通过证据，报告及历史已归档。HEALTHY 仅限报告列明的验证范围。\n' : '发布未标记为成功；失败或缺失的检查必须处理，不能推断生产健康。\n');
}

export function appendHistory(history, report) {
  if (!report.finalizedAt) throw new Error('Finalize before appending history');
  const marker = `<!-- release:${report.version} -->`;
  if (history.includes(marker)) return history;
  return history.trimEnd() + '\n\n' + marker + '\n' + renderReport(report);
}
