import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const checkedAssets = new Set();
const frontendOnly = process.argv.includes('--frontend-only');
const businessOnly = process.argv.includes('--business-only');

function localAsset(reference, source) {
  if (/^(?:https?:|data:|#|mailto:|tel:)/i.test(reference)) return;
  const clean = decodeURIComponent(reference.split(/[?#]/)[0]).replace(/^\//, "");
  if (!clean || checkedAssets.has(`${source}:${clean}`)) return;
  checkedAssets.add(`${source}:${clean}`);
  if (!existsSync(path.join(root, clean)))
    failures.push(`${source} 引用了不存在的本地资源：${clean}`);
}

for (const htmlName of ["index.html", "admin.html"]) {
  const html = readFileSync(path.join(root, htmlName), "utf8");
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi))
    localAsset(match[1], htmlName);
}

const adminAuth = readFileSync(path.join(root, "admin-auth.js"), "utf8");
for (const match of adminAuth.matchAll(/["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi))
  localAsset(match[1], "admin-auth.js");

function walk(folder) {
  return readdirSync(folder).flatMap((name) => {
    const target = path.join(folder, name);
    return statSync(target).isDirectory() ? walk(target) : [target];
  });
}

const syntaxFiles = [
  ...readdirSync(root)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(root, name)),
  ...walk(path.join(root, "scripts")).filter((name) => /\.[cm]js$/.test(name)),
  ...walk(path.join(root, "tests")).filter((name) => name.endsWith(".mjs")),
  ...walk(path.join(root, "supabase", "functions")).filter(
    (name) => name.endsWith(".ts") || name.endsWith(".mjs"),
  ),
];
let checkedScripts = 0;
for (const file of syntaxFiles) {
  if (frontendOnly && (file.startsWith(path.join(root, 'supabase') + path.sep) || file.startsWith(path.join(root, 'scripts') + path.sep) || file.startsWith(path.join(root, 'tests') + path.sep))) continue;
  checkedScripts++;
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bfrom\s+["'](\.\.?\/[^"']+)["']/g)) {
    const imported = path.resolve(path.dirname(file), match[1]);
    if (!existsSync(imported))
      failures.push(
        `${path.relative(root, file)} 引用了不存在的本地模块：${match[1]}`,
      );
  }
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0)
    failures.push(`${path.relative(root, file)} 语法检查失败：${result.stderr.trim()}`);
}

const whitespace = spawnSync("git", ["diff", "HEAD", "--check"], {
  cwd: root,
  encoding: "utf8",
});
if (whitespace.status !== 0)
  failures.push(`Git 空白检查失败：${(whitespace.stdout || whitespace.stderr).trim()}`);

if (failures.length) {
  console.error("发布检查未通过：");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

if (!frontendOnly && !businessOnly) {
const edge = spawnSync(process.execPath, [path.join(root, 'scripts/check-edge-dependencies.mjs')], {
  cwd: root, stdio: 'inherit', timeout: 260000,
});
if (edge.error || edge.status !== 0) process.exit(edge.status || 1);
}

const frontendTests = ['catalog-layout.test.mjs', 'footer-layout.test.mjs', 'browser-baseline.test.mjs'];
for (const required of frontendTests) if (frontendOnly && !existsSync(path.join(root, 'tests', required))) throw Error(`Missing frontend suite: ${required}`);
const tests = walk(path.join(root, "tests")).filter((name) =>
  name.endsWith(".test.mjs") && !((frontendOnly || businessOnly || process.argv.includes('--unit-only')) && name.endsWith('-db.test.mjs')) && (!frontendOnly || frontendTests.includes(path.basename(name))),
);
const result = spawnSync(process.execPath, ["--test", ...tests], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status || 1);
// The same offline browser baseline runs for every level. No live backend/production evidence.
const browser = spawnSync(process.execPath, [path.join(root, 'scripts/check-browser-baseline.cjs')], { cwd: root, stdio: 'inherit' });
if (browser.error || browser.status !== 0) process.exit(browser.status || 1);
console.log(`发布检查通过：${checkedAssets.size} 个资源引用、${checkedScripts} 个脚本及 ${tests.length} 个测试文件。`);
