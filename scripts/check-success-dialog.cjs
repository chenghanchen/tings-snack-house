// Offline rendered regression: real page markup/styles and close handler; no order/API calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ channel: process.env.TINGS_BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    const original = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = [...original.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map(m => fs.readFileSync(path.join(root, m[1].split('?')[0]), 'utf8')).join('\n');
    const html = original.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
    // External styles precede the page's inline overrides, as they do in production.
    await page.setContent(html.replace('</title>', '</title><style>' + css + '</style>'));
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const start = app.indexOf('function closeOrderDialog()');
    const end = app.indexOf('$("#orderDialog").addEventListener("close"', start);
    assert.ok(start >= 0 && end > start);
    await page.addScriptTag({ content: 'const $ = s => document.querySelector(s); let orderSubmissionPending=false; function resetOrderDialog() {}\n' + app.slice(start, end) });
    await page.evaluate(() => {
      document.querySelector('#orderFormWrap').hidden = true;
      document.querySelector('#successMessage').hidden = false;
      document.querySelector('#successReferralReward').hidden = false;
      for (const [id, value] of Object.entries({ submittedReferralCode: 'TSHREF-ABC123', submittedOrderNumber: 'TSH-260917-TEST1', submittedOrderTotal: '$58.07', submittedItemCount: '7', submittedFulfillmentNote: '123 Example Avenue, Unit 123, Chicago IL 60616' })) document.getElementById(id).textContent = value;
      document.querySelector('#orderDialog').showModal();
    });
    const dir = path.join(root, '.build/success-dialog-check');
    fs.mkdirSync(dir, { recursive: true });
    for (const width of [320, 375, 390, 430, 780, 781, 1710]) {
      await page.setViewportSize({ width, height: width <= 430 ? 740 : 1180 });
      const result = await page.evaluate(() => {
        const dialog = document.querySelector('#orderDialog'), close = document.querySelector('#closeDialog');
        dialog.scrollTop = 0;
        const b = close.getBoundingClientRect(), hero = document.querySelector('.success-hero'), h = hero.getBoundingClientRect();
        const blocked = [];
        for (const x of [3, 25, 47]) for (const y of [3, 25, 47]) {
          const top = document.elementFromPoint(b.left + x, b.top + y);
          if (top !== close && !close.contains(top)) blocked.push({ x, y, top: top?.className });
        }
        const dd = [...document.querySelectorAll('.success-order-summary dd')].slice(0, 3);
        return { blocked, heroWidth: h.width, available: hero.parentElement.clientWidth,
          overflow: dialog.scrollWidth > dialog.clientWidth,
          clipped: dd.some(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1),
          labels: [...document.querySelectorAll('.success-order-summary dt')].map(el => getComputedStyle(el).fontSize),
          labelsFit: [...document.querySelectorAll('.success-order-summary dt')].every(el => el.scrollWidth <= el.clientWidth + 1),
          referral: getComputedStyle(document.querySelector('#submittedReferralCode')).fontSize };
      });
      console.log(width, JSON.stringify(result));
      assert.deepEqual(result.blocked, [], 'close hit area must be unobstructed at ' + width);
      assert.ok(Math.abs(result.heroWidth - Math.min(300, result.available)) < 1);
      assert.ok(!result.overflow && !result.clipped, 'summary must not overflow/clip');
      assert.ok(result.labels.every(size => size === '16px'));
      assert.ok(result.labelsFit, 'labels must stay on one line without overflowing');
      assert.equal(result.referral, '16px');
      // Exercise actual click handler at both an edge and center of its 50px touch target.
      for (const position of [{ x: 3, y: 3 }, { x: 25, y: 25 }, { x: 47, y: 47 }]) {
        await page.locator('#closeDialog').click({ position, timeout: 2000 });
        assert.equal(await page.locator('#orderDialog').evaluate(el => el.open), false);
        await page.locator('#orderDialog').evaluate(el => el.showModal());
      }
      // A real modal explanation must stay above the parent close button.
      await page.locator('#successReferralInfoDialog').evaluate(el => el.hidden = false);
      assert.equal(await page.locator('#closeDialog').evaluate(el => { const b = el.getBoundingClientRect(); return document.elementFromPoint(b.x + 25, b.y + 25) === el; }), false);
      await page.locator('#successReferralInfoDialog').evaluate(el => el.hidden = true);
      if ([390, 1710].includes(width)) await page.locator('#orderDialog').screenshot({ path: path.join(dir, width + '.png') });
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
