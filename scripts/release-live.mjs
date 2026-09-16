import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const SITE = 'https://tings-snack-house.pages.dev';
export const PROJECT = 'ragqunnuxsfwhrfqpylg';
const result = (status, evidence) => ({ status, evidence });
const pending = evidence => result('PENDING', evidence);
class EvidenceUnavailable extends Error {}
async function getJSON(url, token, fetcher) {
  let response;
  try {
    response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  } catch { throw new EvidenceUnavailable('Management API unreachable; deployment evidence unavailable'); }
  // Never log API bodies: platform responses can contain environment secrets.
  if (!response.ok) throw new EvidenceUnavailable(`Management API HTTP ${response.status}; deployment evidence unavailable`);
  return response.json();
}

export async function checkCloudflare(version, env = process.env, fetcher = fetch) {
  if (!env.CLOUDFLARE_API_TOKEN) return pending('Missing CLOUDFLARE_API_TOKEN (Pages Read); no deployment claim made');
  const data = await getJSON('https://api.cloudflare.com/client/v4/accounts/8f7628a2d1456e6230e13d10a056c473/pages/projects/tings-snack-house', env.CLOUDFLARE_API_TOKEN, fetcher);
  const d = data.result?.canonical_deployment;
  if (!data.success || !d) throw new Error('No canonical production deployment');
  const m = d.deployment_trigger?.metadata;
  if (d.environment !== 'production' || d.latest_stage?.name !== 'deploy' || d.latest_stage?.status !== 'success' || d.is_skipped || m?.commit_dirty || m?.branch !== 'main' || m?.commit_hash !== version)
    throw new Error('Cloudflare production deployment is not successful clean main at requested SHA');
  return result('PASS', `Cloudflare production deployment=${d.id}; SHA=${m.commit_hash}; deploy=success; site=${SITE}`);
}

export async function checkSupabase(root, version, env = process.env, fetcher = fetch) {
  if (!env.SUPABASE_ACCESS_TOKEN) return pending('Missing SUPABASE_ACCESS_TOKEN; deployed function/config/source not verified');
  const f = await getJSON(`https://api.supabase.com/v1/projects/${PROJECT}/functions/submit-order`, env.SUPABASE_ACCESS_TOKEN, fetcher);
  if (f.slug !== 'submit-order' || f.status !== 'ACTIVE' || f.verify_jwt !== true || !Number.isInteger(f.version))
    throw new Error('submit-order is missing, inactive, or JWT verification is disabled');
  const observed = `submit-order version=${f.version}; ACTIVE; verify_jwt=true; bundle=${f.ezbr_sha256 || 'unavailable'}`;
  const baselinePath = path.join(root, 'release-supabase-baseline.json');
  if (!existsSync(baselinePath)) return pending(`${observed}; missing reviewed release-supabase-baseline.json (source and migration provenance)`);
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  // Baseline is a reviewed deployment receipt, not a hash learned from the target being tested.
  if (baseline.project !== PROJECT || !/^[a-f0-9]{40}$/.test(baseline.sourceCommit || '') || !baseline.migrationEvidence?.trim() || !/^[a-f0-9]{64}$/.test(baseline.bundleSha256 || ''))
    throw new Error('Invalid Supabase deployment baseline');
  const changed = execFileSync('git', ['diff', '--name-only', baseline.sourceCommit, version, '--', 'supabase', '*.sql'], { cwd: root, encoding: 'utf8', timeout: 30_000 }).trim();
  if (changed) return pending(`${observed}; backend differs from reviewed baseline; verify deployment/migrations and update receipt`);
  if (baseline.bundleSha256 !== f.ezbr_sha256 || baseline.functionVersion !== f.version)
    throw new Error('Supabase deployed bundle/version differs from reviewed baseline');
  return result('PASS', `${observed}; backend unchanged since reviewed source ${baseline.sourceCommit}; migration evidence=${baseline.migrationEvidence}`);
}

export function allowBrowserRequest(url, method) {
  const u = new URL(url);
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  return method === 'POST' && u.origin === `https://${PROJECT}.supabase.co` &&
    ['/rest/v1/rpc/get_storefront_snapshot', '/rest/v1/rpc/get_public_product_sales'].includes(u.pathname);
}

export async function checkBrowser(gate, directory) {
  const { chromium } = await import('playwright');
  const mobile = gate === 'mobile';
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1710, height: 1180 };
  const browser = await chromium.launch({ headless: true, ...(process.env.RELEASE_BROWSER_CHANNEL ? { channel: process.env.RELEASE_BROWSER_CHANNEL } : {}) });
  let page, stage = 'create context';
  try {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const blocked = [], errors = [];
    await context.route('**/*', async route => {
      const request = route.request();
      if (allowBrowserRequest(request.url(), request.method())) return route.continue();
      blocked.push(new URL(request.url()).pathname);
      return route.abort('blockedbyclient');
    });
    page = await context.newPage();
    page.setDefaultTimeout(25_000);
    page.on('pageerror', () => errors.push('Uncaught page JavaScript error'));
    stage = 'load production homepage';
    const response = await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60_000 });
    if (!response?.ok()) throw new Error('Production homepage HTTP failure');
    stage = 'wait for purchasable real product';
    await page.locator('#productGrid [data-add]:not([disabled])').first().waitFor();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (await overflow()) throw new Error('Homepage horizontal overflow');
    stage = 'add product and open cart';
    await page.locator('#productGrid [data-add]:not([disabled])').first().click();
    await page.locator('#openCart').click();
    await page.locator('#cart.open').waitFor();
    // Respect the actual shop's minimum order and stock; only change local cart quantity.
    for (let attempt = 0; attempt < 12 && (await page.locator('#cartProgressNotice').innerText()).includes('即可下单'); attempt++) {
      const plus = page.locator('#cartItems [data-change="1"]:not([disabled])').first();
      if (!await plus.count()) break;
      await plus.click();
    }
    stage = 'open checkout';
    await page.locator('#checkout').click();
    await page.locator('#orderDialog[open]').waitFor();
    stage = 'verify pickup and delivery modes';
    await page.locator('#fulfillment').selectOption('pickup');
    await page.locator('#pickupInfo:visible').waitFor();
    if (!(await page.locator('#pickupInfo').innerText()).includes('自取地址')) throw new Error('Pickup information missing');
    await page.locator('#fulfillment').selectOption('delivery');
    await page.locator('#address:visible').waitFor();
    const geometry = await page.locator('#orderDialog').evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, overflow: el.scrollWidth > el.clientWidth + 1 }));
    if (geometry.left < 0 || geometry.right > viewport.width + 1 || geometry.overflow || await overflow()) throw new Error('Checkout horizontal overflow');
    if (blocked.length || errors.length) throw new Error(`Browser check: ${blocked.length} blocked non-read requests, ${errors.length} JavaScript errors`);
    const screenshot = `${gate}-checkout.png`;
    await page.screenshot({ path: path.join(directory, screenshot), fullPage: false });
    await page.locator('#closeDialog').click();
    const proof = { site: SITE, viewport, engine: 'Chromium', mobileEmulation: mobile, scenarios: ['real products', 'add to cart locally', 'open checkout', 'pickup address', 'delivery address field', 'no horizontal overflow', 'close checkout'], submittedOrder: false, screenshot, checkedAt: new Date().toISOString() };
    writeFileSync(path.join(directory, `${gate}.json`), JSON.stringify(proof, null, 2));
    return result('PASS', `${SITE}; ${viewport.width}x${viewport.height}; isolated Chromium${mobile ? ' mobile emulation (not physical device)' : ''}; products/cart/checkout/pickup/delivery/layout; no order submitted; ${gate}.json; ${screenshot}`);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(directory, `${gate}-failed.png`) }).catch(() => {});
    throw new Error(`${stage}: ${String(error.message).split('\n')[0]}; evidence=${gate}-failed.png`);
  } finally { await browser.close(); }
}

export async function checkAssets(root, version, fetcher = fetch) {
  const assets = ['index.html', 'app.js', 'styles.css', 'customer-account.js', 'supabase-config.js'];
  for (const file of assets) {
    const expected = execFileSync('git', ['show', `${version}:${file}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    const response = await fetcher(`${SITE}/${file}`, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
    if (!response.ok) throw new Error(`Production asset HTTP ${response.status}: ${file}`);
    const actual = Buffer.from(await response.arrayBuffer());
    const hash = b => createHash('sha256').update(b.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
    if (hash(actual) !== hash(expected)) throw new Error(`Production asset differs from requested commit: ${file}`);
  }
  return result('PASS', `Production HTML/JS/CSS (${assets.join(', ')}) SHA256 matches committed source (CRLF normalized)`);
}

export async function liveCheck(gate, { root, version, directory, report, env = process.env, fetcher = fetch }) {
  try {
    if (gate === 'cloudflare') return await checkCloudflare(version, env, fetcher);
    if (gate === 'supabase') return await checkSupabase(root, version, env, fetcher);
    if (['desktop', 'mobile'].includes(gate)) return await checkBrowser(gate, directory);
    if (gate === 'production') {
      const assets = await checkAssets(root, version);
      const missing = ['cloudflare', 'desktop', 'mobile', 'guestCheckout'].filter(key => report.checks[key].status !== 'PASS');
      if (missing.length) return pending(`${assets.evidence}; required checks not PASS: ${missing.join(', ')}`);
      return assets;
    }
    throw new Error('Unknown live gate');
  } catch (error) {
    // Raw Playwright errors can include DOM or response content. Keep the stored diagnosis bounded.
    const safe = String(error.message).split('\n')[0].slice(0, 250);
    return result(error instanceof EvidenceUnavailable ? 'PENDING' : 'FAIL', safe);
  }
}
