import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { normalizeCaptionText } from './caption-text.js';

fs.mkdirSync('artifacts', { recursive: true });
const source = fs.readFileSync('server.js', 'utf8');
const context = vm.createContext({ normalizeCaptionText, fs, path });
vm.runInContext(source.slice(source.indexOf('function cleanPureText'), source.indexOf('async function createCinematicReel')), context);
context.moodQuote = 'Khoảnh khắc bình yên giữa cuộc đời\n𝒍𝒐𝒗𝒆 𝒈𝒐𝒆𝒔 𝒂𝒘𝒂𝒚 2026';
context.tempDir = path.resolve('artifacts');
vm.runInContext(source.slice(source.indexOf("let quoteFilter = '';"), source.indexOf('// Step 1:')) + '\nglobalThis.filter = quoteFilter;', context);
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=0x27354a:s=1080x1920:d=1', '-vf', context.filter.slice(1), '-frames:v', '1', '-update', '1', 'artifacts/caption-preview.png'], { stdio: 'pipe' });
const samplePhoto = 'downloads/dilemma_5197717127126633041/image_01.jpg';
if (fs.existsSync(samplePhoto)) {
  execFileSync('ffmpeg', ['-y', '-i', samplePhoto, '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920${context.filter}`, '-frames:v', '1', '-update', '1', 'artifacts/caption-on-photo.png'], { stdio: 'pipe' });
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'studio.test' && url.pathname === '/') {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync('public/index.html') });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, loggedIn: false } });
    return route.abort();
  });
  await page.goto('http://studio.test');
  await page.screenshot({ path: 'artifacts/ui-desktop.png', fullPage: true });
  const desktopLayout = await page.evaluate(() => ({
    containerWidth: document.querySelector('.container').getBoundingClientRect().width,
    viewportWidth: innerWidth,
    overflow: document.documentElement.scrollWidth > innerWidth
  }));
  if (desktopLayout.overflow || desktopLayout.containerWidth < desktopLayout.viewportWidth * 0.94) throw Error('Desktop does not use available width');
  await page.locator('#moodTextInput').fill('Khoảnh khắc bình yên giữa cuộc đời');
  await page.locator('#chkAddMoodText').uncheck();
  if (await page.locator('#moodTextContainer').isVisible()) throw Error('Overlay toggle failed');
  await page.locator('#chkAddMoodText').check();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/ui-mobile.png', fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw Error('Mobile horizontal overflow');
  if (errors.length) throw Error(errors.join('\n'));
  console.log('PASS: caption render, desktop/mobile UI, overlay toggle, no page errors or mobile overflow');
} finally { await browser.close(); }
