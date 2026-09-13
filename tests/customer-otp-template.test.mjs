import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('customer email uses Supabase OTP placeholder, not links or fixed credentials', async () => {
  const html = await readFile(new URL('../supabase/templates/customer-otp.html',import.meta.url),'utf8');
  assert.equal((html.match(/{{\s*\.Token\s*}}/g)||[]).length,1);
  assert.doesNotMatch(html,/ConfirmationURL|TokenHash|<script|https?:\/\/|123456|re_[A-Za-z0-9]+/);
  assert.match(html,/返回刚才的网站窗口/);
  assert.match(html,/Arial, sans-serif/);
});
