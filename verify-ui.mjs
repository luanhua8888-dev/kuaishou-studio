import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Mock API writes so UI verification cannot publish or alter the live queue.
fs.mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const writes = [];
  let queue = { enabled: true, running: false, cursor: 2, nextRunAt: new Date(Date.now() + 3600000).toISOString(), options: { autoPostIG: true, autoPostFB: true, autoPostTikTok: true, autoPostThreads: true, asReel: true, captionLang: 'en', enableMoodQuote: true } };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.url().endsWith('/api/sheet-column')) return route.fulfill({ json: { rows: [{ row: 3, value: 'https://v.kuaishou.com/example' }, { row: 5, value: '<script>unsafe</script>' }] } });
    if (request.url().endsWith('/api/sheet-queue')) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        writes.push(body);
        queue = { ...queue, ...body, options: { ...queue.options, ...body.options } };
      }
      return route.fulfill({ json: queue });
    }
    if (request.method() !== 'GET') throw Error('Unexpected action: ' + request.url());
    return route.fulfill({ json: { loggedIn: true } });
  });
  await page.goto('http://localhost:3002');
  await page.waitForFunction(() => document.querySelector('#igDot').classList.contains('dot-green'));
  assert.ok(await page.locator('.container').evaluate(el => el.getBoundingClientRect().width / innerWidth > 0.94), 'Desktop should use available width');
  await page.locator('#sheetTable').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#sheetRows tr').count(), 2);
  assert.equal(await page.locator('#sheetRows td').first().innerText(), '3');
  assert.equal(await page.locator('#sheetRows script').count(), 0);
  await page.screenshot({ path: 'artifacts/minimal-ui-desktop.png', fullPage: true });
  await page.locator('#chkAutoPostIG').uncheck();
  assert.equal(await page.locator('#chkAutoPostFB').isChecked(), false);
  await page.locator('#chkAutoPostFB').check();
  assert.equal(await page.locator('#chkAutoPostIG').isChecked(), true);
  await page.locator('#chkAutoPostThreads').uncheck();
  assert.equal(await page.locator('#swCardThreads').evaluate(el => el.classList.contains('active-ig')), false);
  await page.locator('#chkAutoPostThreads').check();
  await page.locator('.advanced summary').click();
  await page.locator('#chkAddMoodText').uncheck();
  assert.equal(await page.locator('#moodTextContainer').isVisible(), false);
  await page.locator('#chkAddMoodText').check();
  await page.locator('.advanced summary').click();
  await page.locator('.direct-link summary').click();
  await page.locator('#urlInput').fill('https://v.kuaishou.com/example');
  assert.match(await page.locator('#btnRun').innerText(), /link/);
  await page.locator('#urlInput').fill('');
  await page.locator('.direct-link summary').click();
  await page.locator('#btnPauseQueue').click();
  await page.locator('#btnPauseQueue').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#btnPauseQueue').isVisible(), false);
  assert.ok(writes.some(body => body.enabled === false));
  await page.locator('#btnRun').click();
  await page.locator('#btnPauseQueue').waitFor({ state: 'visible' });
  assert.ok(writes.some(body => body.enabled === true && body.runNow === true));
  await page.locator('#btnReloadSheet').click();
  await page.waitForFunction(() => !document.querySelector('#btnReloadSheet').disabled);
  assert.equal(await page.locator('#sheetRows tr').count(), 2);
  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}`);
    if (width === 390) await page.screenshot({ path: 'artifacts/minimal-ui-mobile.png', fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('UI verified: queue controls, platform dependencies, advanced options, desktop/mobile layouts. Live API writes mocked.');
} finally { await browser.close(); }
