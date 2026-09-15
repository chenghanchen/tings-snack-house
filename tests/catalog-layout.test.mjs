import test from "node:test";
import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import {runInNewContext} from "node:vm";

test("分类按钮：图标文案统一显示，保留原分类键与安全转义", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const code = source.slice(source.indexOf("function renderFilters()"), source.indexOf("function qtyControl("));
  const output = {innerHTML:""};
  const labels = [["新品","🌟 新品"],["热卖","🔥 热销"],["辣条","🌶️ 辣条"],["坚果","🥜 坚果"],["饼干","🍪 饼干"],["饮料","🥤 饮料"],["促销","🎁 促销"]];
  runInNewContext(code+";renderFilters()", {
    categories:[...labels.map(([name])=>({name})),{name:"constructor"},{name:"<test>"}],
    products:[],
    $:()=>output,
    escapeHtml:value=>String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),
  });
  for(const [key,label] of labels)assert.ok(output.innerHTML.includes('data-filter="'+key+'">'+label+'</button>'),key);
  assert.ok(output.innerHTML.includes('data-filter="全部">全部</button>'));
  assert.ok(output.innerHTML.includes('data-filter="constructor">constructor</button>'));
  assert.ok(output.innerHTML.includes('data-filter="&lt;test&gt;">&lt;test&gt;</button>'));
  assert.equal(output.innerHTML.includes('data-filter="🔥 热销"'),false);
});

test("商品排版：现价与按钮双端一致，所有卡片底部留白 10px", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const shared = css.slice(css.indexOf("/* Shared compact catalog controls."));
  assert.match(shared, /#productGrid \.product-price-wrap b,#productGrid \.product-price-wrap \.sale-price\{font-size:20px\}/);
  assert.match(shared, /#productGrid \.add\{padding-left:8px;padding-right:8px\}/);
  assert.match(shared, /#productGrid>\.product\{min-height:0;align-self:start;padding-bottom:10px\}/);
  assert.match(shared, /display:grid;grid-template-columns:max-content minmax\(0,1fr\)/);
  assert.match(shared, /\.has-promotion \.product-price-wrap\{flex:0 1 150px;width:150px;max-width:100%\}/);
  assert.match(shared, /@container catalog-card \(max-width:166px\)/);
  assert.match(shared, /\.has-promotion \.add\{padding-left:4px;padding-right:4px;font-size:10px\}/);
  assert.match(shared, /\.product-bottom>\.stock-warning\{grid-column:1\/-1;flex-basis:100%;margin:0/);
  assert.match(shared, /@media\(max-width:388px\)\{#productGrid\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(shared, /\.product-price-wrap b\{display:flex;flex-direction:row;align-items:center/);
  assert.match(shared, /\.product>\.promotion-badge\{[^}]*font-size:12px/);
  assert.match(shared, /#productSearch\{margin-top:-30px\}/);
  assert.match(shared, /#deliveryInfo\{margin-top:-50px;margin-bottom:0\}/);
  assert.match(shared, /@media\(max-width:780px\)\{\s*#snacks\{padding-top:21px\}/);
});

test("商品内容：简介仅在大图弹窗显示，优惠放在商品名后并随规格刷新", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /id="imagePreviewDescription" hidden/);
  assert.match(app, /description.textContent = String\(p.note \|\| ""\)/);
  assert.doesNotMatch(app, /\$\{p.note \? `<p>/);
  assert.match(app, /card.querySelector\("\.promotion-badge"\)\?\.remove\(\)/);
  assert.match(app, /card.querySelector\("h3"\)\?\.insertAdjacentHTML\("afterend"/);
});

test("全站字体：前台、后台及动态样式统一 Arial，无远程字体请求", async () => {
  const root = new URL("../", import.meta.url);
  for (const file of (await readdir(root)).filter(name => /\.(css|html|js)$/.test(name))) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.doesNotMatch(source, /fonts\.(googleapis|gstatic)\.com/, file);
    for (const match of source.matchAll(/font-family\s*:\s*([^;}\n]+)|(?<![\w-])font\s*:\s*([^;}\n]+)/g)) {
      const value = (match[1] || match[2]).trim();
      assert.ok(value === "inherit" || value.endsWith("Arial, sans-serif"), `${file}: ${match[0]}`);
    }
  }
  for (const file of ["styles.css", "admin-login.css"])
    assert.match(await readFile(new URL(file, root), "utf8"), /\*,::before,::after\{font-family:Arial, sans-serif\}/);
});
