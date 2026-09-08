import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const checkedAssets = new Set();

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
  ...walk(path.join(root, "scripts")).filter((name) => name.endsWith(".mjs")),
  ...walk(path.join(root, "tests")).filter((name) => name.endsWith(".mjs")),
  ...walk(path.join(root, "supabase", "functions", "_shared")).filter(
    (name) => name.endsWith(".mjs"),
  ),
  ...walk(path.join(root, "supabase", "functions")).filter(
    (name) => name.endsWith(".ts"),
  ),
];
for (const file of syntaxFiles) {
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

const tests = walk(path.join(root, "tests")).filter((name) =>
  name.endsWith(".test.mjs"),
);
const result = spawnSync(process.execPath, ["--test", ...tests], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status || 1);
console.log(`发布检查通过：${checkedAssets.size} 个资源引用、${syntaxFiles.length} 个脚本及 ${tests.length} 个测试文件。`);
