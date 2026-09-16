import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFile(path.join(root, name), "utf8");

function uploadProfileBlock(source, profile) {
  const match = source.match(
    new RegExp(`${profile}:\\s*Object\\.freeze\\(\\{([\\s\\S]*?)\\n\\s*\\}\\),`),
  );
  assert.ok(match, `应定义 ${profile} 图片上传预设`);
  return match[1];
}

test("下单：前端锁定提交按钮并通过受限 Edge Function 发送完整请求", async () => {
  const [app, edge] = await Promise.all([
    read("app.js"),
    read("supabase/functions/submit-order/index.ts"),
  ]);
  assert.match(app, /if \(orderSubmissionPending\) return;/);
  assert.match(app, /setOrderSubmissionPending\(true\)/);
  assert.match(app, /p_idempotency_key:\s*checkoutIdempotencyKey/);
  assert.match(app, /functions\.invoke\("submit-order"/);
  assert.match(edge, /body\.p_idempotency_key/);
  assert.match(edge, /admin\.rpc\(\s*"submit_shop_order_account"/);
  assert.match(edge, /p_user_id: customerId/);
  assert.match(app, /headers: await window\.TingsAccount\.checkoutHeaders\(\)/);
  assert.match(edge, /ORDER_RATE_IP_MAX/);
  assert.match(edge, /ORDER_RATE_PHONE_MAX/);
});

test("最低配送：真实 Supabase 检查调用服务端并回滚所有业务数据", async () => {
  const [sql, releaseNotes] = await Promise.all([
    read("minimum-delivery-live-check.sql"),
    read("RELEASE-CHECKS.md"),
  ]);
  assert.match(sql, /begin;[\s\S]*rollback;/i);
  assert.match(sql, /public\.submit_shop_order_account\(/);
  assert.match(sql, /没有达到最低配送\$/);
  assert.match(sql, /stock_after is distinct from stock_before/i);
  assert.match(sql, /public\.order_submission_idempotency[\s\S]*idempotency_key = test_key/i);
  assert.match(sql, /public\.orders[\s\S]*customer_note = test_note/i);
  assert.match(sql, /raise notice 'PASS:/i);
  assert.match(releaseNotes, /minimum-delivery-live-check\.sql/);
});

test("防重复提交：相同键原子串行并复用原订单，不同内容会拒绝", async () => {
  const sql = await read("order-submission-protection-migration.sql");
  assert.match(sql, /idempotency_key uuid primary key/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_idempotency_key::text/i);
  assert.match(sql, /if prior\.request_fingerprint <> fingerprint then/i);
  assert.match(sql, /return prior\.response \|\| jsonb_build_object\('idempotent_replay', true\)/i);
  assert.match(sql, /order_id uuid not null unique references public\.orders\(id\)/i);
});

test("订单查询：顾客端只调用受控查询 RPC，匿名角色仅获函数执行权", async () => {
  const [app, sql] = await Promise.all([
    read("app.js"),
    read("supabase-order-cancellation-v2.sql"),
  ]);
  assert.match(app, /db\.rpc\("lookup_customer_orders",\s*\{ p_query: query \}\)/);
  assert.match(sql, /create or replace function public\.lookup_customer_orders\(p_query text\)/i);
  assert.match(sql, /grant execute on function public\.lookup_customer_orders\(text\) to anon, authenticated/i);
});

test("设置保存：合并已有 JSON、限定唯一设置行，并在成功或失败后解除按钮锁定", async () => {
  const source = await read("store-settings.js");
  assert.match(
    source,
    /settingsSavePending\s*\|\|[\s\S]*?isSettingsSavePending/,
  );
  assert.match(source, /withSettingsSaveLock/);
  assert.match(source, /content = deepMerge\(currentContent,/);
  assert.match(source, /\.from\("shop_settings"\)\s*\.update\(\{/);
  assert.match(source, /\.eq\("id", 1\)/);
  assert.match(source, /finally \{\s*settingsSavePending = false;/);
  assert.match(source, /button\.disabled = previousButtonStates\[index\]/);
});

class FakeClassList {
  values = new Set();
  add(...names) {
    names.forEach((name) => this.values.add(name));
  }
  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }
}

class FakeElement {
  constructor() {
    this.dataset = {};
    this.classList = new FakeClassList();
    this.style = {};
    this.children = [];
    this.innerHTML = "";
    this.textContent = "";
  }
  addEventListener() {}
  append(...nodes) {
    this.children.push(...nodes);
  }
  querySelectorAll() {
    return [];
  }
}

test("后台登录：未登录启动可稳定进入 login 状态且不记录脚本错误", async () => {
  const source = await read("admin-auth.js");
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new FakeElement());
    return elements.get(selector);
  };
  const errors = [];
  const document = {
    documentElement: element("html"),
    head: element("head"),
    body: element("body"),
    querySelector: element,
    createElement: () => new FakeElement(),
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
    },
  };
  const window = {
    supabase: { createClient: () => client },
    TINGS_SUPABASE: { url: "https://example.supabase.co", anonKey: "test" },
    setTimeout,
    finishAdminBoot() {},
  };
  window.window = window;
  vm.runInNewContext(source, {
    window,
    document,
    location: {
      hash: "",
      href: "https://example.test/admin",
      pathname: "/admin",
      reload() {},
    },
    history: { replaceState() {} },
    console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
    setTimeout,
    clearTimeout,
  }, { filename: "admin-auth.js" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.documentElement.dataset.adminState, "login");
  assert.match(element("main").innerHTML, /id="loginForm"/);
  assert.deepEqual(errors, []);
});

test("后台登录：首屏只保留登录所需的 3 个脚本和 1 个样式", async () => {
  const html = await read("admin.html");
  const scripts = [...html.matchAll(/<script(?:\s+[^>]*src="([^"]+)")?[^>]*>/gi)];
  const styles = [...html.matchAll(/<link\s+[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/gi)];
  assert.equal(scripts.length, 4, "应为 1 个内联启动脚本和 3 个外部脚本");
  assert.equal(scripts.filter((match) => match[1]).length, 3);
  assert.equal(styles.length, 1);
  assert.match(styles[0][1], /^admin-login\.css\?/);
  assert.doesNotMatch(html, /<script[^>]+src="admin\.js/i);
  assert.doesNotMatch(html, /<link[^>]+href="admin\.css/i);
});

test("已登录订单卡：查询通知与状态更新路径无运行错误", async () => {
  const source = await read("order-cards.js");
  class OrderClassList extends FakeClassList {
    contains(name) {
      return this.values.has(name);
    }
    toggle(name, force) {
      const enabled =
        force === undefined ? !this.values.has(name) : Boolean(force);
      if (enabled) this.values.add(name);
      else this.values.delete(name);
      return enabled;
    }
  }
  class OrderElement extends FakeElement {
    constructor() {
      super();
      this.classList = new OrderClassList();
      this.listeners = new Map();
      this.isConnected = true;
      this.value = "";
    }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    querySelector() {
      return null;
    }
    setAttribute(name, value) {
      this[name] = String(value);
    }
  }

  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, new OrderElement());
    return nodes.get(selector);
  };
  const rootNode = node("#ordersList");
  const toastNode = node("#toast");
  const missing = new Set([
    "#loginForm, #newPasswordForm",
    ".order-fulfillment-filters",
    '[data-order-tab="history"]',
    "#orderDatePreset",
    "#orderDateFrom",
    "#orderDateTo",
    "#orderSearch",
  ]);
  const document = {
    querySelector(selector) {
      if (missing.has(selector)) return null;
      return node(selector);
    },
    querySelectorAll() {
      return [];
    },
  };

  const queryResults = [
    { data: null, error: { message: "订单读取失败" } },
    { data: [], error: null },
  ];
  const rpcCalls = [];
  const client = {
    from() {
      const query = {
        select() {
          return query;
        },
        order() {
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve(
            queryResults.shift() || { data: [], error: null },
          ).then(resolve, reject);
        },
      };
      return query;
    },
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    channel() {
      return {
        on() {
          return this;
        },
        subscribe() {
          return this;
        },
      };
    },
  };
  const immediateTimers = [];
  const runtimeErrors = [];
  const testSetTimeout = (callback, delay = 0) => {
    if (delay < 100) immediateTimers.push(callback);
    return immediateTimers.length;
  };
  const flushImmediateTimers = async () => {
    while (immediateTimers.length) {
      const callback = immediateTimers.shift();
      try {
        await callback();
      } catch (error) {
        runtimeErrors.push(error);
      }
    }
  };
  const window = {
    supabase: { createClient: () => client },
    finishAdminBoot() {},
  };
  window.window = window;
  vm.runInNewContext(
    source,
    {
      window,
      document,
      TINGS_SUPABASE: {
        url: "https://example.supabase.co",
        anonKey: "test",
      },
      toast: toastNode,
      navigator: { clipboard: { writeText: async () => {} } },
      confirm: () => true,
      requestAnimationFrame: (callback) => callback(),
      setTimeout: testSetTimeout,
      clearTimeout() {},
      console,
    },
    { filename: "order-cards.js" },
  );
  await flushImmediateTimers();
  assert.equal(toastNode.textContent, "订单读取失败");
  assert.equal(toastNode.classList.contains("show"), true);

  const orderNode = new OrderElement();
  orderNode.dataset = {
    orderId: "order-1",
    orderStatus: "待确认",
    deliveryFee: "5",
  };
  orderNode.querySelector = () => ({ value: "pickup" });
  const advance = new OrderElement();
  advance.dataset = { cardAdvance: "true", target: "已确认" };
  advance.closest = (selector) => {
    if (selector === ".order-card") return orderNode;
    if (selector === "[data-card-cancel]") return null;
    if (selector.includes("button")) return advance;
    return null;
  };
  for (const listener of rootNode.listeners.get("click") || []) {
    try {
      await listener({ target: advance });
    } catch (error) {
      runtimeErrors.push(error);
    }
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls)), [
    {
      name: "owner_update_order",
      args: {
        p_order_id: "order-1",
        p_status: "已确认",
        p_fulfillment: "pickup",
        p_delivery_fee: 0,
      },
    },
  ]);
  assert.equal(toastNode.textContent, "订单已更新");
  assert.deepEqual(runtimeErrors, []);
});

test("媒体删除：Edge Function 强制校验店主并在删除前重新扫描全部引用", async () => {
  const [edge, config] = await Promise.all([
    read("supabase/functions/admin-media-cleanup/index.ts"),
    read("supabase/config.toml"),
  ]);
  assert.match(edge, /authClient\.auth\.getUser\(token\)/);
  assert.match(edge, /data\.user\.email.*ownerEmail/s);
  assert.match(edge, /readAllRows\(admin, "products", "image"\)/);
  assert.match(edge, /readAllRows\(admin, "product_variants", "image"\)/);
  assert.match(edge, /readAllRows\(admin, "shop_settings", "content"\)/);
  assert.match(edge, /readAllRows\(admin, "orders", "items"\)/);
  assert.match(edge, /confirmation !== "DELETE_ORPHAN_MEDIA"/);
  assert.match(edge, /\.order\("id", \{ ascending: true \}\)\s*\.limit\(listPageSize\)/);
  assert.match(edge, /query = query\.gt\("id", lastId\)/);
  assert.match(edge, /deleteOrphanFilesSafely\(\{/);
  assert.match(edge, /readReferences: \(\) => collectDatabaseReferences\(admin\)/);
  assert.match(config, /\[functions\.admin-media-cleanup\]\s*verify_jwt = true/);
});

test("统一图片存储：四类背景图固定转为 WebP 并使用严格 UUID URL", async () => {
  const optimizer = await read("image-optimizer.js");
  for (const profile of ["hero", "announcement", "delivery", "footer"]) {
    const block = uploadProfileBlock(optimizer, profile);
    assert.match(block, /forceWebp:\s*true/);
    assert.match(block, /outputType:\s*"image\/webp"/);
    assert.match(block, /folder:\s*"(?:appearance\/)?[a-z-]+"/);
  }

  assert.match(optimizer, /function uuidV4\(\)/);
  assert.match(optimizer, /randomUUID/);
  assert.match(optimizer, /getRandomValues/);
  assert.doesNotMatch(
    optimizer,
    /Date\.now\(\)[\s\S]{0,160}Math\.random\(\)/,
    "Storage 文件名不得回退为时间戳随机串，必须始终生成 UUID",
  );
  assert.match(
    optimizer,
    /path\s*=\s*`\$\{safeFolder\}\/\$\{[^}]+\}\.\$\{extensionForType\(blob\.type\)\}`/,
  );
  assert.match(optimizer, /expectedType\s*=\s*options\.outputType/);
  assert.match(optimizer, /result\.blob\?\.type\s*!==\s*expectedType/);
});

test("社交二维码：使用专用 PNG/UUID 上传管线并提供扫描验证入口", async () => {
  const [optimizer, appearance] = await Promise.all([
    read("image-optimizer.js"),
    read("appearance-settings.js"),
  ]);
  const qrProfile = uploadProfileBlock(optimizer, "qr");

  assert.match(qrProfile, /outputType:\s*"image\/png"/);
  assert.match(optimizer, /canvasToBlob\(canvas, outputType,/);
  assert.match(optimizer, /async function uploadQrPng/);
  assert.match(optimizer, /async function validateQrCode/);
  assert.match(
    optimizer,
    /folder:\s*`appearance\/qr\/\$\{platform\}`/,
  );
  assert.match(optimizer, /result\.blob\?\.type\s*!==\s*"image\/png"/);
  assert.match(optimizer, /!\/\\\.png\$\/i\.test\(uploaded\.path/);
  assert.match(
    optimizer,
    /async function uploadQrPng[\s\S]*?await validateQrCode\(/,
  );
  assert.match(appearance, /TingsImage(?:\?\.|\.)uploadQrPng\(/);
  assert.match(appearance, /withUploadLock/);
  assert.match(appearance, /扫码验证|扫描验证/);
  assert.match(optimizer, /jsqr@1\.4\.0\/dist\/jsQR\.js/);
  assert.match(optimizer, /QR_DECODER_INTEGRITY\s*=/);
  assert.match(optimizer, /getImageData\(/);
  assert.match(optimizer, /inversionAttempts:\s*"attemptBoth"/);
});

test("外观保存：复用初始设置、保护未保存背景并阻止重复提交", async () => {
  const [admin, appearance] = await Promise.all([
    read("admin.js"),
    read("appearance-settings.js"),
  ]);
  assert.match(admin, /window\.TingsAdminSettings\s*=\s*s/);
  assert.match(admin, /function settings\(\)[\s\S]*?imageDirtyKey/);
  assert.match(appearance, /let appearanceSavePending\s*=\s*false/);
  assert.match(
    appearance,
    /appearanceSavePending\s*\|\|[\s\S]*?isSettingsSavePending/,
  );
  assert.match(appearance, /withSettingsSaveLock/);
  assert.match(appearance, /source\.dataset\.activityAnnouncementImage/);
  assert.match(appearance, /migrateLegacyBackgrounds/);
  assert.match(
    appearance,
    /content:\s*mergedContent/,
    "保存时必须把当前 content 与新版外观字段合并后一次写入",
  );
  assert.equal(
    (appearance.match(/\.from\("shop_settings"\)/g) || []).length,
    2,
    "外观模块只应在保存时各读取和更新一次，初始化复用 admin.js 已有结果",
  );
});

test("前台二维码：仅在点击后加载受信任的 Storage PNG URL", async () => {
  const source = await read("footer-contact-overlay.js");

  assert.match(source, /new URL\(/);
  assert.match(
    source,
    /storefront-images\/appearance\/qr\//,
    "二维码必须限定在 storefront-images/appearance/qr 下",
  );
  for (const platform of ["wechat", "xiaohongshu", "facebook", "instagram"])
    assert.match(source, new RegExp(`\\b${platform}\\b`));
  assert.match(
    source,
    /\[0-9a-f\]\{8\}[\s\S]*\[0-9a-f\]\{4\}[\s\S]*\\?\.png/i,
    "二维码 URL 应校验 UUID 文件名和 .png 扩展名",
  );
  assert.doesNotMatch(
    source,
    /value\.qr\s*\?\s*`<img\s+src=/,
    "初始页尾 HTML 不应直接设置二维码 img.src",
  );
  assert.match(source, /data-(?:src|qr-src|footer-qr-src)/);
  assert.match(
    source,
    /addEventListener\("click"[\s\S]*?\.src\s*=/,
    "点击社交平台后才可赋值二维码 img.src",
  );
});

test("首屏快照：优先一次只读 RPC，异常时保留旧请求回退", async () => {
  const [app, sql] = await Promise.all([
    read("app.js"),
    read("storefront-snapshot-migration.sql"),
  ]);
  assert.match(app, /STOREFRONT_SNAPSHOT_RPC\s*=\s*"get_storefront_snapshot"/);
  assert.match(app, /db\.rpc\(STOREFRONT_SNAPSHOT_RPC\)/);
  assert.equal(
    (app.match(/db\.rpc\(STOREFRONT_SNAPSHOT_RPC\)/g) || []).length,
    1,
  );
  assert.doesNotMatch(app, /\nreloadCardCampaigns\(\);/);
  assert.match(app, /return loadLegacyStorefrontData\(\)/);
  assert.match(app, /storefrontSnapshotUnavailable = true/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /revoke all on function public\.get_storefront_snapshot\(\) from public/i);
  assert.match(sql, /grant execute on function public\.get_storefront_snapshot\(\) to anon, authenticated/i);
  assert.doesNotMatch(sql, /new_order_email|'coupons'|'orders'/i);
});

function storefrontStateFactory(app) {
  const start = app.indexOf("function createStorefrontSharedState()");
  const end = app.indexOf("\n\nconst storefrontShared", start);
  assert.ok(start >= 0 && end > start, "应能提取前台共享状态实现");
  const context = { console: { error() {} } };
  vm.runInNewContext(
    `${app.slice(start, end)}\nthis.createState = createStorefrontSharedState;`,
    context,
  );
  return context.createState;
}

test("活动实时：较新发布阻止慢快照回写，订阅可持续收到更新", async () => {
  const app = await read("app.js"),
    createState = storefrontStateFactory(app),
    state = createState(),
    received = [];
  const unsubscribe = state.subscribeCampaigns((campaigns, revision) =>
    received.push({ campaigns, revision }),
  );
  const snapshotRevision = state.campaignRevision,
    liveCampaigns = [{ id: "live" }],
    staleSnapshotCampaigns = [{ id: "stale-snapshot" }];
  assert.equal(state.publishCampaigns(liveCampaigns), true);
  assert.equal(
    state.publishCampaigns(staleSnapshotCampaigns, snapshotRevision),
    false,
  );
  assert.strictEqual(state.campaigns, liveCampaigns);
  assert.equal(state.campaignRevision, 1);
  assert.deepEqual(received.map((item) => item.campaigns[0].id), ["live"]);
  unsubscribe();
  state.publishCampaigns([{ id: "after-unsubscribe" }]);
  assert.equal(received.length, 1);
  assert.match(
    app,
    /campaignRevision\s*=\s*storefrontShared\.campaignRevision[\s\S]*publishCampaigns\(snapshotCampaigns, campaignRevision\)/,
  );
});

test("活动公告：四张常驻入口、账户券摘要和安全商品筛选", async () => {
  const [source, html, css] = await Promise.all([read("activity-announcement.js"),read("index.html"),read("activity-announcement.css")]);
  assert.doesNotMatch(source, /\.from\(|\.rpc\(|functions\.invoke|innerHTML/);
  for(const name of ["welcome","popular","new","promotion"]){
    assert.match(html,new RegExp(`activity-${name}-v1\\.webp`));
    assert.ok((await readFile(path.join(root,`activity-${name}-v1.webp`))).length>0);
  }
  assert.match(css,/flex:0 0 350px/);
  assert.match(css,/height:160px/);
  assert.match(css,/scroll-snap-type:x mandatory/);
  const events={},status={hidden:true,textContent:""},offer={textContent:""},welcomeAction={textContent:""},search={value:"旧搜索"},actions=[];
  const section={addEventListener(name,callback){events[name]=callback}};
  const filter={dataset:{filter:"新品"},click(){actions.push("新品")}};
  const window={TingsAccount:{async open(view){actions.push(view)}},matchMedia(){return {matches:true}},addEventListener(name,callback){events[name]=callback}};
  const document={
    querySelector(){return section},querySelectorAll(){return [filter]},
    getElementById(id){return {activityAnnouncementStatus:status,activityWelcomeOffer:offer,activityWelcomeAction:welcomeAction,productSearch:search,
      snacks:{querySelector(){return {setAttribute(){},focus(){}}},scrollIntoView(){actions.push("scroll")}}}[id]}
  };
  vm.runInNewContext(source,{window,document,Number});
  assert.equal(offer.textContent,"登录领取新人专属优惠");
  assert.equal(welcomeAction.textContent,"立即领取");
  const click=async(selector,target)=>events.click({target:{closest(s){return s===selector?target:null}}});
  await click("[data-promotion-account]",{});
  assert.deepEqual(actions,["coupons"]);
  await click("[data-promotion-filter]",{dataset:{promotionFilter:"新品"}});
  assert.equal(search.value,"");assert.deepEqual(actions,["coupons","新品","scroll"]);
  await click("[data-promotion-filter]",{dataset:{promotionFilter:"missing"}});
  assert.equal(status.hidden,false);
  events["tings:account-state"]({detail:{signedIn:true}});
  assert.equal(welcomeAction.textContent,"查看优惠券");
  events["tings:wallet-summary"]({detail:{amount:5,min_spend:35,discount_kind:"fixed"}});
  assert.equal(offer.textContent,"满 $35 减 $5");
  events["tings:wallet-summary"]({detail:{amount:10,min_spend:50,discount_kind:"percent"}});
  assert.equal(offer.textContent,"满 $50 享 10% OFF");
  events["tings:wallet-summary"]({detail:{amount:"<img onerror=bad>",min_spend:0}});
  assert.equal(offer.textContent,"查看新人专属优惠");
  events["tings:wallet-summary"]({detail:null});
  assert.equal(offer.textContent,"查看新人专属优惠");
  events["tings:account-state"]({detail:{signedIn:false}});
  events["tings:wallet-summary"]({detail:{amount:5,min_spend:35,discount_kind:"fixed"}});
  assert.equal(offer.textContent,"登录领取新人专属优惠");
  assert.equal(welcomeAction.textContent,"立即领取");
});

test("字体与仓库：顾客页无需远程字体，三张旧 PNG 已移除", async () => {
  const [html, app] = await Promise.all([read("index.html"), read("app.js")]);
  assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/);
  assert.doesNotMatch(html, /Zen\+Maru\+Gothic/);
  for (const base of [
    "footer-composite-v1",
    "footer-snack-illustration-v1",
    "hero-snack-illustration-v1",
  ]) {
    await assert.rejects(read(`${base}.png`));
    await read(`${base}.webp`);
    assert.match(app, new RegExp(`${base}\\.png[\"']:\\s*[\"']${base}\\.webp`));
  }
});

test("后台就绪：核心设置返回后立即结束启动遮罩", async () => {
  const source = await read("admin.js");
  assert.match(
    source,
    /boot = async function \(\) \{[\s\S]*?finally \{\s*window\.finishAdminBoot\?\.\(\);\s*\}/,
  );
});
