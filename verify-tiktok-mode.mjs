import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const port = 4759;
const server = spawn(process.execPath, ['server.js', `--port=${port}`, '--tiktok-only', '--no-browser'], { stdio: 'pipe', windowsHide: true });
let output = ''; server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
let browser;
try {
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(`${base}/api/sheet-queue`)).ok; } catch {}
    if (ready) break;
    if (server.exitCode !== null) throw new Error(output);
    await delay(100);
  }
  assert.ok(ready, output);
  const state = await (await fetch(`${base}/api/sheet-queue`)).json();
  assert.equal(state.tiktokOnly, true);
  assert.equal(state.options.autoPostTikTok, true);
  for (const platform of ['IG', 'FB', 'Threads']) assert.equal(state.options[`autoPost${platform}`], false);
  for (const platform of ['ig', 'fb', 'threads']) {
    const response = await fetch(`${base}/api/${platform}/post`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 409);
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Avoid account checks and Google Sheets access during this local UI verification.
  await page.route('**/api/*/status', route => route.fulfill({ json: { loggedIn: false } }));
  await page.route('**/api/sheet-column', route => route.fulfill({ json: { rows: [] } }));
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('chkAutoPostTikTok').disabled);
  assert.equal(await page.locator('#chkAutoPostTikTok').isChecked(), true);
  for (const id of ['swCardIG', 'swCardFB', 'swCardThreads']) assert.equal(await page.locator(`#${id}`).isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('TikTok-only API isolation and UI: passed. No posts were made.');
} finally {
  await browser?.close();
  server.kill();
}
