// Separate mandatory gate: do not allow a missing suite or a skipped database test to pass.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suites = readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('-db.test.mjs')).sort();
for (const required of ['customer-accounts-db.test.mjs', 'customer-wallet-db.test.mjs', 'media-deletion-guard-db.test.mjs']) {
  if (!suites.includes(required)) throw new Error(`Required PGlite suite missing: ${required}`);
}
const run = spawnSync(process.execPath, ['--test', ...suites.map(name => path.join(root, 'tests', name))], {
  cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
});
const output = `${run.stdout || ''}\n${run.stderr || ''}`;
process.stdout.write(output);
const skipped = /(?:\bskipped|# skip)\s+[1-9]\d*/i.test(output);
if (run.error || run.status !== 0 || skipped) {
  console.error('Database FAIL: all PGlite suites must execute without skips or errors.');
  process.exitCode = 1;
} else console.log(`Database PASS: ${suites.length} real PGlite suites completed.`);
