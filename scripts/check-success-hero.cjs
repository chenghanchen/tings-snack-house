// Layout regression: local by default; --production allows only read-only storefront requests.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.TINGS_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ channel: process.env.TINGS_BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const production = process.argv.includes('--production');
    if (production) {
      const { SITE, allowBrowserRequest } = await import('./release-live.mjs');
      await page.route('**/*', route => allowBrowserRequest(route.request().url(), route.request().method()) ? route.continue() : route.abort());
      const response = await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
      assert.ok(response.ok(), 'production homepage must load');
      await page.locator('#productGrid [data-add]').first().waitFor();
    } else {
      await page.route('**/*', route => route.abort());
      const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<link\b[^>]*>/gi, '');
      await page.setContent(html);
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    }
    // Display the existing success UI without submitting an order or fabricating an API response.
    await page.evaluate(() => {
      document.querySelector('#orderFormWrap').hidden = true;
      document.querySelector('#successMessage').hidden = false;
      document.querySelector('#orderDialog').showModal();
    });
    for (const width of [320, 375, 390, 780, 781, 1710]) {
      await page.setViewportSize({ width, height: 1180 });
      const result = await page.locator('.success-hero').evaluate(hero => {
        const rect = hero.getBoundingClientRect();
        const parent = hero.parentElement.getBoundingClientRect();
        return {
          width: rect.width,
          available: parent.width,
          left: rect.left - parent.left,
          right: parent.right - rect.right,
          overflow: hero.scrollWidth > hero.clientWidth,
          childrenFit: [...hero.children].every(child => {
            const box = child.getBoundingClientRect();
            return box.left >= rect.left - 1 && box.right <= rect.right + 1;
          }),
        };
      });
      assert.ok(Math.abs(result.width - Math.min(350.01, result.available)) < 1, JSON.stringify(result));
      assert.ok(Math.abs(result.left - result.right) < 1, 'hero must remain centered');
      assert.ok(!result.overflow && result.childrenFit, 'hero text must fit at ' + width);
      console.log(`PASS ${production ? 'production success-layout fixture' : 'local'} ${width}px: hero ${result.width.toFixed(2)}px, margins ${result.left.toFixed(2)}/${result.right.toFixed(2)}px`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
