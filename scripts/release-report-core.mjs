import { validateClassification } from './release-level.mjs';

export const GATES = Object.freeze({
  workingTree: 'Git', tests: 'Tests', database: 'Database', security: 'Security',
  github: 'GitHub', cloudflare: 'Cloudflare', supabase: 'Supabase',
  desktop: 'Desktop', mobile: 'Mobile', guestCheckout: 'Guest checkout', production: 'Production smoke test',
  releaseReport: 'Release Report', releaseHistory: 'Release History',
});
export const L3_GATES = Object.freeze({ frozenVersion: 'Frozen version', edgeBundler: 'Edge bundler integrity', productionApproval: 'Production human approval', productionMatch: 'Frozen production MATCH' });
export const reportGates = report => report.schemaVersion === 3 ? { ...GATES, ...L3_GATES } : GATES;
export const isGateRequired = (report, gate) => {
  if (!Object.hasOwn(reportGates(report), gate)) throw Error('Unknown check gate');
  if (report.schemaVersion !== 3) return true;
  validateClassification(report.classification);
  return report.classification.requiredGates.includes(gate);
};

export function isReleaseOrigin(remote) {
  // actions/checkout uses HTTPS without .git; keep the repository allowlist exact.
  return ['https://github.com/chenghanchen/tings-snack-house',
    'https://github.com/chenghanchen/tings-snack-house.git'].includes(remote);
}

export function checkEnvironment(env) {
  const isolated = { ...env };
  // Test fixture reports must not publish to the real CI summary or inherit management tokens.
  for (const name of ['GITHUB_STEP_SUMMARY', 'CLOUDFLARE_API_TOKEN', 'SUPABASE_ACCESS_TOKEN', 'RELEASE_BASE_SHA', 'RELEASE_GATE_FLOOR']) delete isolated[name];
  return isolated;
}

export function createReport(version, branch, title, now = new Date().toISOString(), classification = null) {
  if (!/^[0-9a-f]{40}$/.test(version)) throw new Error('Full commit SHA required');
  if (!title?.trim() || !branch?.trim()) throw new Error('Title and branch required');
  if (classification) { validateClassification(classification); if (classification.head !== version) throw Error('Classification version mismatch'); }
  return { schemaVersion: classification ? 3 : 2, version, branch, title, createdAt: now, updatedAt: now,
    ...(classification ? { classification } : {}),
    checks: Object.fromEntries(Object.keys(classification ? { ...GATES, ...L3_GATES } : GATES).map(key => [key,
      classification && !classification.requiredGates.includes(key)
        ? { status: 'NOT_REQUIRED', evidence: `${classification.level}: outside classified release scope`, checkedAt: now }
        : { status: 'PENDING', evidence: '', checkedAt: null }])),
    events: [], finalizedAt: null };
}

export function validateReport(report) {
  if (![2, 3].includes(report?.schemaVersion) || !/^[0-9a-f]{40}$/.test(report.version || '') || !report.branch || !report.title)
    throw new Error('Invalid report identity');
  if (report.schemaVersion === 3) { validateClassification(report.classification); if (report.classification.head !== report.version) throw Error('Classification version mismatch'); }
  if (Object.keys(report.checks || {}).length !== Object.keys(reportGates(report)).length) throw new Error('Invalid check set');
  for (const key of Object.keys(reportGates(report))) {
    const check = report.checks[key];
    if (!check || !['PASS', 'FAIL', 'PENDING', ...(report.schemaVersion === 3 ? ['NOT_REQUIRED'] : [])].includes(check.status)) throw new Error(`Invalid gate: ${key}`);
    if (check.status === 'NOT_REQUIRED' && isGateRequired(report, key)) throw Error(`Required gate cannot be skipped: ${key}`);
    if (report.schemaVersion === 3 && Object.hasOwn(L3_GATES, key) && check.status === 'PASS')
      throw Error(`Unverified L3 evidence: ${key}; audited evidence importer is not implemented`);
    if (check.status !== 'PENDING' && (!check.evidence?.trim() || !Number.isFinite(Date.parse(check.checkedAt))))
      throw new Error(`Missing evidence/date: ${key}`);
  }
  return report;
}

export function recordCheck(report, key, status, evidence, now = new Date().toISOString(), requirements) {
  validateReport(report);
  if (report.finalizedAt) throw new Error('Finalized report is immutable; create a new release commit to retry');
  if (!Object.hasOwn(reportGates(report), key) || !['PASS', 'FAIL', 'PENDING'].includes(status) || !evidence?.trim())
    throw new Error('Known gate, PASS/FAIL/PENDING and nonempty evidence required');
  if (report.schemaVersion === 3 && Object.hasOwn(L3_GATES, key) && status === 'PASS')
    throw Error(`Unverified L3 evidence: ${key}; generic runner cannot grant approval or MATCH`);
  if (requirements) {
    if (!['cloudflare', 'supabase'].includes(key) || requirements.verificationRequired !== true || ![true, false, 'UNKNOWN'].includes(requirements.deploymentRequired))
      throw new Error('Invalid platform deployment/verification requirements');
  }
  report.checks[key] = { status, evidence: evidence.trim(), checkedAt: now, ...(requirements ? { requirements } : {}) };
  report.events.push({ gate: key, ...report.checks[key] });
  report.updatedAt = now;
  return report;
}

export function outcome(report) {
  validateReport(report);
  const checks = Object.entries(report.checks).filter(([key]) => isGateRequired(report, key)).map(([, check]) => check);
  if (Object.values(report.checks).some(check => check.status === 'FAIL')) return 'RELEASE FAILED';
  if (report.schemaVersion === 3 && report.classification.uncertainty) return 'INCOMPLETE';
  if (checks.some(check => check.status !== 'PASS')) return 'INCOMPLETE';
  if (!report.finalizedAt) return 'INCOMPLETE';
  return 'RELEASE SUCCESS';
}

const inline = value => String(value).replace(/[\r\n|]/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function renderReport(report) {
  const status = outcome(report);
  return `## ${report.createdAt.slice(0, 10)} · ${report.version.slice(0, 7)} · ${inline(report.title)}\n\n` +
    `**${status}${status === 'RELEASE SUCCESS' ? ' ✓' : status === 'RELEASE FAILED' ? ' ✕' : ''}**\n\nVersion: \`${report.version}\`\n\nBranch: \`${inline(report.branch)}\`\n\n` +
    (report.schemaVersion === 3 ? `Level: **${report.classification.level}**; Base: \`${report.classification.base || 'UNKNOWN'}\`; Diff: \`${report.classification.diffFingerprint}\`\n\n` : '') +
    (report.classification?.override ? `Manual override: **${report.classification.override.status}**; ` +
      (report.classification.override.status === 'APPLIED'
        ? `ID: ${inline(report.classification.override.approval.id)}; trusted base: \`${report.classification.override.sourceBase}\`; expires: ${inline(report.classification.override.approval.expiresAt)}; original file levels retained in JSON.`
        : inline(report.classification.override.reason)) + '\n\n' : '') +
    `Updated: ${report.updatedAt}\n\n| Check | Result | Evidence | Checked at |\n| --- | --- | --- | --- |\n` +
    Object.entries(reportGates(report)).map(([key, label]) => {
      const check = report.checks[key];
      const requirementText = check.requirements ? `Deployment required: ${check.requirements.deploymentRequired}; Verification required: true; ` : '';
      return `| ${label} | ${check.status} | ${inline(requirementText + (check.evidence || '未验证'))} | ${check.checkedAt || '—'} |`;
    }).join('\n') + `\n\nProduction: **${status === 'RELEASE SUCCESS' ? 'HEALTHY' : 'NOT VERIFIED HEALTHY'}**\n\n` +
    (status === 'RELEASE SUCCESS' ? '全部必需门禁已有通过证据，报告及历史已归档。HEALTHY 仅限报告列明的验证范围。\n' : '发布未标记为成功；失败或缺失的检查必须处理，不能推断生产健康。\n');
}

export function appendHistory(history, report) {
  if (!report.finalizedAt) throw new Error('Finalize before appending history');
  const marker = `<!-- release:${report.version} -->`;
  if (history.includes(marker)) return history;
  return history.trimEnd() + '\n\n' + marker + '\n' + renderReport(report);
}
