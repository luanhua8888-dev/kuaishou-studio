import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const mainOnly = process.argv.includes('--main-only');
const base = mainOnly ? 'http://localhost:3000' : 'http://localhost:3004';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 950 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  if (mainOnly) {
    await page.waitForFunction(() => document.querySelector('#xStatusText').textContent !== 'Đang kiểm tra…');
    for (const id of ['swCardIG', 'swCardFB', 'swCardThreads', 'swCardTikTok', 'swCardX']) assert.equal(await page.locator(`#${id}`).isVisible(), true);
    assert.equal(await page.locator('#chkAutoPostX').isDisabled(), false);
    await page.locator('#xStatusBtn').click();
    assert.equal(await page.locator('#xConnectDialog').isVisible(), true);
    if (process.argv.includes('--oauth')) {
      const status = await (await fetch(`${base}/api/x/status`)).json();
      assert.equal(status.oauthConfigured, true);
      assert.equal(await page.locator('#xOAuthLogin').isEnabled(), true);
      assert.equal(await page.locator('#xCallbackUri').textContent(), 'http://127.0.0.1:3000/api/x/callback');
      await page.context().route('http://127.0.0.1:3000/api/x/oauth/start', route => route.fulfill({ contentType: 'text/html', body: '<h1>OAuth navigation test</h1>' }));
      const popupPromise = page.context().waitForEvent('page');
      await page.locator('#xOAuthLogin').click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.equal(popup.url(), 'http://127.0.0.1:3000/api/x/oauth/start');
      await popup.close();
      const started = await fetch('http://127.0.0.1:3000/api/x/oauth/start', { redirect: 'manual' });
      assert.equal(started.status, 302);
      const authURL = new URL(started.headers.get('location'));
      assert.equal(authURL.origin, 'https://x.com');
      assert.equal(authURL.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(authURL.searchParams.get('redirect_uri'), 'http://127.0.0.1:3000/api/x/callback');
      assert.match(started.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
      const invalid = await fetch('http://127.0.0.1:3000/api/x/callback?code=invalid&state=invalid');
      assert.equal(invalid.status, 400);
      assert.match(await invalid.text(), /không khớp/);
    } else await page.locator('#xConnectCancel').click();
    assert.deepEqual(errors, []);
    fs.mkdirSync('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/x-ui-localhost-3000.png', fullPage: true });
    console.log('localhost:3000: all five platforms, X connection dialog and browser checks passed.');
  } else {
  await page.waitForFunction(() => document.querySelector('#chkAutoPostX').checked);
  assert.equal(await page.locator('#chkAutoPostX').isDisabled(), true);
  for (const id of ['swCardIG', 'swCardFB', 'swCardThreads', 'swCardTikTok']) assert.equal(await page.locator(`#${id}`).isVisible(), false);
  await page.locator('#xStatusBtn').click();
  assert.equal(await page.locator('#xConnectDialog').isVisible(), true);
  await page.getByText('Nhập token có sẵn', { exact: true }).click();
  await page.locator('#xAccessToken').fill('temporary-test-value');
  await page.locator('#xConnectCancel').click();
  assert.equal(await page.locator('#xAccessToken').inputValue(), '');
  const status = await (await fetch(`${base}/api/x/status`)).json();
  assert.equal(Object.hasOwn(status, 'accessToken'), false);
  const blocked = await fetch(`${base}/api/threads/post`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(blocked.status, 409);
  const foreign = await fetch(`${base}/api/x/login`, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 403);
  assert.deepEqual(errors, []);
  fs.mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/x-ui-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'artifacts/x-ui-mobile.png', fullPage: true });
  await page.route('**/api/sheet-queue', route => route.fulfill({ json: {
    enabled: false, running: false, items: [], options: { autoPostIG: true, autoPostFB: true, autoPostTikTok: true, autoPostThreads: true, autoPostX: false, asReel: true, captionLang: 'en', enableMoodQuote: true }
  } }));
  await page.setViewportSize({ width: 1365, height: 950 });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#chkAutoPostIG').checked);
  for (const id of ['swCardIG', 'swCardFB', 'swCardThreads', 'swCardTikTok', 'swCardX']) assert.equal(await page.locator(`#${id}`).isVisible(), true);
  assert.equal(await page.locator('#chkAutoPostX').isChecked(), false);
  await page.screenshot({ path: 'artifacts/x-ui-all-platforms.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('X UI: desktop/mobile, connection dialog, isolated mode and API guards passed.');
  }
} finally { await browser.close(); }
