import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PROJECT_ROOT } from '../src/paths.js';

// Isolated UI preview: all API responses below are fixtures, never real publishing.
const rows = Array.from({ length: 18 }, (_, i) => ({
  row: 100 + i, colA: i < 11 ? `https://v.kuaishou.com/${['KxEARfzJ', 'Jg0212lx', 'KtlZuFM8'][i % 3]}?item=${i}` : '',
  colB: i >= 11 ? `https://v.kuaishou.com/complete${i}` : '', colC: i >= 11,
}));
let queue = {
  enabled: true, running: false, cursor: 100, intervalSeconds: 1800,
  nextRunAt: new Date(Date.now() + 12 * 60000 + 34000).toISOString(), items: [],
  options: { autoPostIG: true, autoPostFB: true, autoPostTikTok: true, autoPostThreads: true, autoPostX: false, asReel: true, captionLang: 'en', enableMoodQuote: true },
};
const server = http.createServer(async (req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(fs.readFileSync(path.join(PROJECT_ROOT, 'public/index.html')));
  }
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/sheet-column') return res.end(JSON.stringify({ rows }));
  if (req.url === '/api/sheet-queue') {
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      queue.options = { ...queue.options, ...data.options };
    }
    return res.end(JSON.stringify(queue));
  }
  if (req.url === '/api/ai-settings') return res.end(JSON.stringify({ hasKey: false }));
  if (req.url?.endsWith('/status')) return res.end(JSON.stringify({ success: true, loggedIn: true, connected: true, username: 'studio', oauthConfigured: true }));
  res.writeHead(404); res.end('{}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const errors = [];
const out = path.join(PROJECT_ROOT, 'artifacts/ui');
fs.mkdirSync(out, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#pendingMetric').filter({ hasText: '11' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#btnDismissSheetReminder').click();
  assert.equal(await page.locator('#doneMetric').textContent(), '7');
  assert.equal(await page.locator('#channelsMetric').textContent(), '4');
  const visibleRows = await page.locator('.sheet-list').evaluate(panel => {
    const bounds = panel.getBoundingClientRect();
    return [...panel.querySelectorAll('tbody tr')].filter(row => {
      const rect = row.getBoundingClientRect();
      return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    }).length;
  });
  assert.ok(visibleRows >= 12, `Only ${visibleRows} queue rows fit at 1366 x 768`);
  assert.equal(await page.locator('.controls-column').evaluate(el => el.scrollHeight > el.clientHeight + 1), false, 'Default controls should fit without scrolling');
  assert.equal(await page.locator('#sheetRows td:first-child').first().evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
  await page.screenshot({ path: path.join(out, 'studio-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Chờ đăng', exact: true }).click();
  assert.equal(await page.locator('#sheetRows tr:visible').count(), 11);
  await page.getByRole('button', { name: 'Đã hoàn thành', exact: true }).click();
  assert.equal(await page.locator('#sheetRows tr:visible').count(), 7);
  await page.getByRole('button', { name: 'Tất cả', exact: true }).click();
  await page.locator('#sheetSearch').fill('KxEARfzJ');
  assert.equal(await page.locator('#sheetRows tr:visible').count(), 4);
  await page.locator('#sheetSearch').fill('nothing-matches');
  assert.equal(await page.locator('#sheetFilterEmpty').isVisible(), true);
  await page.locator('#sheetSearch').fill('');
  await page.locator('#chkAutoPostX').check();
  await page.locator('#channelsMetric').filter({ hasText: '5' }).waitFor();
  await page.locator('#btnOpenSettings').click();
  assert.equal(await page.locator('#advancedPanel').getAttribute('open'), '');
  const settingsBounds = await page.locator('#advancedPanel').boundingBox();
  assert.ok(settingsBounds.y >= 0 && settingsBounds.y + settingsBounds.height <= 768);
  await page.locator('#advancedPanel > summary').click();
  await page.locator('.direct-link > summary').click();
  await page.locator('#urlInput').fill('https://v.kuaishou.com/example');
  assert.equal(await page.locator('#btnRun').textContent(), 'Đăng link này');
  await page.locator('#urlInput').fill('');
  await page.locator('.direct-link > summary').click();
  for (const [width, height] of [[1920, 1080], [1280, 768], [1024, 600], [900, 768], [768, 768], [390, 768], [360, 640]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
    const verticalOverflow = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight);
    assert.equal(verticalOverflow, false, `Page exceeds viewport height at ${width}px`);
    if (width === 1920) {
      await page.waitForFunction(() => document.getElementById('advancedPanel').open);
      assert.equal(await page.locator('#advancedPanel').evaluate(el => getComputedStyle(el).position), 'relative');
      const settings = await page.locator('#advancedPanel').boundingBox();
      assert.ok(settings.y + settings.height <= height, 'Inline settings must fit the viewport');
      await page.screenshot({ path: path.join(out, 'studio-large.png'), fullPage: true });
    }
    if (width === 1024) {
      await page.locator('#advancedPanel > summary').scrollIntoViewIfNeeded();
      const summary = await page.locator('#advancedPanel > summary').boundingBox();
      assert.ok(summary.y >= 0 && summary.y + summary.height <= height, 'Controls must remain reachable in a short window');
    }
    if (width === 390) await page.screenshot({ path: path.join(out, 'studio-mobile.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(data => renderSheetQueue(data), {
    ...queue, enabled: false, running: false,
    error: 'Dòng 110: Không tải được media. Lần này chưa tới bước đăng; link được giữ lại. Sẽ tự thử lại sau 30 phút.',
  });
  assert.equal(await page.locator('#queueState').getAttribute('data-tone'), 'error');
  assert.equal(await page.locator('#titleCountdown').getAttribute('data-state'), 'paused');
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false);
  await page.screenshot({ path: path.join(out, 'studio-error.png'), fullPage: true });
  await page.evaluate(data => renderSheetQueue(data), {
    ...queue, running: true, stage: 'Đang tải video: 48%', stageStartedAt: Date.now() - 12000,
  });
  assert.equal(await page.locator('#titleCountdown').getAttribute('data-state'), 'running');
  assert.equal(await page.locator('#countdownCard').evaluate(el => getComputedStyle(el, '::after').animationName), 'orbit');
  await page.evaluate(() => { document.getElementById('resultSection').style.display = 'block'; });
  const resultBounds = await page.locator('#resultSection').boundingBox();
  assert.ok(resultBounds.y >= 0 && resultBounds.y + resultBounds.height <= 768);
  await page.locator('#btnCloseResult').click();
  assert.equal(await page.locator('#resultSection').isVisible(), false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.page-heading').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.deepEqual(errors, []);
  console.log(`PASS: ${visibleRows} queue rows fit at 1366 x 768; seven viewport sizes, inline settings, filters, search, channel selection, direct-link mode, reduced motion; no page errors.`);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
