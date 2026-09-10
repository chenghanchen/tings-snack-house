import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("页尾：指定社交图标、推荐奖励文案和动态营业时间", async () => {
  const html = await read("index.html"), css = await read("footer-layout.css"), app = await read("app.js");
  assert.match(html, /<h2>推荐奖励<\/h2><p>分享好物，领取优惠<\/p>/);
  for (const platform of ["wechat", "xiaohongshu", "douyin"]) {
    const asset = `footer-${platform}-v1.webp`;
    assert.ok(css.includes(`background-image:url("${asset}")`));
    const bytes = await readFile(new URL(`../${asset}`, import.meta.url));
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    assert.ok(bytes.length < 10000);
  }
  const expression = app.match(/\? (String\(c\[key\]\)\.replace\([^\n]+\))/)?.[1];
  assert.ok(expression, "Hours should strip only the label, not replace the saved schedule");
  for (const [saved, expected] of [["营业时间：每日 10:00–22:00", "每日 10:00–22:00"], ["营业时间: 周二 12:00–18:00", "周二 12:00–18:00"], ["每日 09:00–17:00", "每日 09:00–17:00"]])
    assert.equal(vm.runInNewContext(expression, {c:{footerHours:saved},key:"footerHours"}), expected);
});

test("页尾：真实 HTML 导航、手机重排以及单一页尾入口", async () => {
  const html = await read("index.html"), css = await read("footer-layout.css");
  assert.equal((html.match(/id="story"/g) || []).length, 1);
  assert.equal((html.match(/<footer\b/g) || []).length, 1);
  assert.doesNotMatch(html, /role="img"\s+aria-label="婷婷的零食屋故事/);
  for (const text of ["购物指南", "关于我们", "售后服务", "关注我们", "data-footer-lookup", "footerInfoDialog"])
    assert.ok(html.includes(text));
  assert.match(css, /@media\(max-width:1100px\)/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /min-height:44px/);
  assert.doesNotMatch(html, /400[–-]888[–-]9999|2024123456|service@tingtingslw\.com/);
  assert.match(html, /id="footerEmail"><\/a><p>24小时内回复<\/p>/);
  assert.doesNotMatch(html, /支付方式请以下单后店铺确认为准|ft-payment-note/);
  assert.doesNotMatch(css, /ft-payment-note/);
  const mobile = css.slice(css.indexOf("@media(max-width:1100px)"));
  assert.match(mobile, /\.ft-illustration\{display:none\}/);
  assert.match(mobile, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(mobile, /\.ft-links>section:last-child/);
  assert.match(mobile, /footer-mobile-background-v1\.webp/);
  assert.match(mobile, /aspect-ratio:1164\/1351/);
  const background = await readFile(new URL("../footer-mobile-background-v1.webp", import.meta.url));
  assert.equal(background.toString("ascii", 8, 12), "WEBP");
  assert.ok(background.length < 200000);
});

test("页尾：电话邮箱逐行对齐，移动端图标在关注标题右侧", async () => {
  const css = await read("footer-layout.css");
  assert.match(css, /\.ft-contact>section\{display:grid;grid-template-rows:subgrid;grid-row:1\/span 3/);
  assert.match(css, /\.ft-contact>#footerEmailSection\{grid-column:2\}/);
  assert.match(css, /\.ft-social h2\{grid-column:1;grid-row:1;margin:0\}/);
  assert.match(css, /\.ft-social-list\{grid-column:2;grid-row:1;justify-content:flex-end/);
});

test("页尾：二维码只允许当前项目、当前平台与 UUID PNG", async () => {
  const source = await read("footer-contact-overlay.js");
  const part = source.slice(source.indexOf("  const qrUuidPattern"), source.indexOf("  let settings"));
  const context = { URL, window: { TINGS_SUPABASE: { url: "https://example.supabase.co" } } };
  vm.createContext(context);
  vm.runInContext(part + "\nglobalThis.check = trustedQrUrl;", context);
  const good = "https://example.supabase.co/storage/v1/object/public/storefront-images/appearance/qr/wechat/aba868b8-d40e-4e90-b842-565da461edcc.png";
  assert.equal(context.check(good, "wechat"), good);
  for (const value of [good.replace("example", "attacker"), good.replace(".png", ".svg"), good.replace("https:", "http:"), "javascript:alert(1)", "data:image/png;base64,AA", good.replace("aba868b8-d40e-4e90-b842-565da461edcc", "other")])
    assert.equal(context.check(value, "wechat"), "");
  assert.equal(context.check(good, "douyin"), "");
  assert.match(source, /qrImage\.onerror/);
  assert.match(source, /trigger\?\.focus\(\)/);
  assert.match(source, /settingsReady/);
  assert.doesNotMatch(source, /\.from\("shop_settings"\)|fetch\(/);
});

test("页尾：抖音与现有社交平台共用 PNG 上传、后台保存和显示开关", async () => {
  for (const file of ["footer-contact-overlay.js", "appearance-settings.js", "image-optimizer.js"])
    assert.match(await read(file), /["']?douyin["']?/);
  assert.match(await read("appearance-settings.js"), /current\?\.content\?\.footerAppearance/);
  const source = await read("footer-contact-overlay.js");
  assert.match(source, /button\.hidden = !show/);
  assert.match(source, /config\.showPhone === false/);
  assert.match(source, /config\.showEmail === false/);
});

test("页尾：社交点击原位切换二维码，忽略旧响应并支持失败重试", async () => {
  class Element {
    hidden = false; attrs = {}; children = []; events = {}; dataset = {};
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.text || ""; }
    setAttribute(key, value) { this.attrs[key] = value; }
    removeAttribute(key) { delete this.attrs[key]; }
    focus() { this.focused = true; }
    cloneNode() { return Object.assign(new Element(), {alt:this.alt,src:this.src}); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, fn) { this.events[name] = fn; }
    hasAttribute() { return false; }
  }
  const selectors = Object.fromEntries(["#footerInlineQr", ".ft-qr-status", "#footerPhone", "#footerEmail", "#footerEmailSection", ".ft-social-empty", ".ft-scan"].map(key => [key, new Element()]));
  const dialogNodes = Object.fromEntries(["#footerDialogTitle", "#footerDialogText", "#footerDialogQr", "#footerDialogQrImage", "#footerDialogQrStatus", ".dialog-close"].map(key => [key, new Element()]));
  const platforms = ["wechat", "xiaohongshu", "douyin", "facebook", "instagram"];
  const buttons = platforms.map(platform => Object.assign(new Element(), {dataset: {footerSocial: platform}}));
  const root = Object.assign(new Element(), {
    querySelector: key => selectors[key],
    querySelectorAll: selector => selector === "[data-footer-social]" ? buttons : buttons.filter(button => selector.includes(`"${button.dataset.footerSocial}"`)),
    contains: button => buttons.includes(button) || button === selectors["#footerInlineQr"],
  });
  let dialogsOpened = 0;
  const dialog = Object.assign(new Element(), {querySelector: key => dialogNodes[key], showModal() { dialogsOpened++; this.open=true; },close(){this.open=false;this.events.close?.();}});
  const uuid = "aba868b8-d40e-4e90-b842-565da461edcc";
  const socials = Object.fromEntries(platforms.map(platform => [platform, {show: true, qr: `https://example.supabase.co/storage/v1/object/public/storefront-images/appearance/qr/${platform}/${uuid}.png`}]));
  const images = [];
  class MockImage extends Element { constructor() { super(); images.push(this); } }
  const settings = {content: {footerAppearance: {socials}}};
  const document = {querySelector: key => key === "#story.snack-footer" ? root : dialog};
  const media = {matches:false,addEventListener(name,fn){this.change=fn;}};
  const context = {URL, Image: MockImage, document, setTimeout,
    window: {matchMedia:()=>media,TINGS_SUPABASE: {url: "https://example.supabase.co"}, TingsStorefront: {settings, settingsReady: Promise.resolve(settings)}}};
  vm.runInNewContext(await read("footer-contact-overlay.js"), context);
  const click = platform => root.events.click({target: {closest: () => buttons[platforms.indexOf(platform)]}});
  assert.equal(images.length, 0, "初次渲染不下载二维码");
  click("wechat"); click("douyin");
  assert.equal(images.length, 2);
  assert.equal(selectors["#footerInlineQr"].textContent, "加载中…");
  images[1].onload(); images[0].onload();
  assert.equal(selectors["#footerInlineQr"].children[0], images[1], "较晚选择优先");
  assert.equal(buttons[2].attrs["aria-pressed"], "true");
  assert.equal(buttons[0].attrs["aria-pressed"], "false");
  click("xiaohongshu"); images[2].onerror();
  assert.equal(selectors["#footerInlineQr"].textContent, "加载失败");
  click("xiaohongshu"); images[3].onload();
  assert.equal(selectors["#footerInlineQr"].children[0], images[3]);
  socials.wechat.qr = "https://attacker.example/image.png";
  click("wechat");
  assert.equal(images.length, 4, "不下载未受信任图片");
  assert.equal(selectors["#footerInlineQr"].textContent, "暂未设置");
  assert.equal(dialogsOpened, 0, "社交点击不打开弹窗");
  click("douyin"); images[4].onload();
  root.events.click({target:{closest:()=>selectors["#footerInlineQr"]}});
  assert.equal(dialogsOpened,1,"电脑点击二维码放大");
  assert.equal(dialogNodes["#footerDialogQrImage"].children[0].alt,"抖音二维码");
  assert.equal(images.length,5,"放大不创建新的下载请求");
  dialog.close();
  media.matches=true; media.change();
  click("xiaohongshu");
  assert.equal(dialogsOpened,2,"手机点击社交图标直接打开弹窗");
  assert.equal(buttons[1].attrs["aria-controls"],"footerInfoDialog");
  images[5].onerror();
  assert.match(dialogNodes["#footerDialogQrStatus"].textContent,/加载失败/);
  dialog.close(); click("douyin"); images[6].onload();
  assert.equal(dialogNodes["#footerDialogQrImage"].children[0].alt,"抖音二维码");
  dialog.close();
  click("xiaohongshu"); dialog.close(); images[7].onload();
  assert.equal(dialog.open,false,"关闭后异步加载不能重新打开弹窗");
  assert.equal(dialogNodes["#footerDialogQrImage"].children.length,0);
  const html = await read("index.html");
  assert.match(html, /扫码关注<br>领取专属优惠券/);
  assert.match(html, /客服电话/);
  assert.match(html, />关于零食屋<\/button>/);
});
