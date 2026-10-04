import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeCaptionMentions } from './caption-text.js';
import { threadsTopic } from './threads-caption.js';
import { sanitizeVideoAudioForCopyright } from './anti-copyright.js';

const root = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_FILE = path.join(root, 'threads_auth.json');
const CREATE = /^(Create|New thread|Thread mới|Tạo|Bài viết mới)$/i;
let loginAttempt = null;
let loginError = null;

export function loginState() {
  return { loginInProgress: Boolean(loginAttempt), loginError };
}

export function prepareThreadsCaption(value) {
  const caption = removeCaptionMentions(value);
  if ([...caption].length > 500) throw new Error('Mô tả Threads vượt 500 ký tự. Hãy rút gọn trước khi đăng.');
  return caption;
}

export function hasThreadsSession(state, now = Date.now()) {
  return (state.cookies || []).some(cookie =>
    /(^|\.)threads\.(com|net)$/.test(cookie.domain.replace(/^\./, '')) &&
    cookie.name === 'sessionid' && (!cookie.expires || cookie.expires < 0 || cookie.expires * 1000 > now));
}

export async function checkLoginStatus() {
  try { return hasThreadsSession(JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'))); }
  catch { return false; }
}

export async function startInteractiveLogin() {
  if (loginAttempt) return { alreadyOpen: true };
  loginError = null;
  // Lock before launching so repeated clicks cannot open concurrent login windows.
  loginAttempt = true;
  let browser;
  try {
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ locale: 'vi-VN' });
    const page = await context.newPage();
    await page.goto('https://www.threads.com/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const completion = waitForLogin(browser, context, page);
    loginAttempt = completion;
    void completion.catch(error => {
      loginError = error.message;
      console.error('[Threads] Đăng nhập:', error.message);
    }).finally(() => { loginAttempt = null; });
    return { alreadyOpen: false };
  } catch (error) {
    loginAttempt = null;
    loginError = error.message;
    await browser?.close().catch(() => {});
    throw error;
  }
}

async function waitForLogin(browser, context, page) {
  try {
    for (let i = 0; i < 180 && !page.isClosed(); i++) {
      await page.waitForTimeout(2000);
      if (hasThreadsSession(await context.storageState())) {
        await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded' });
        const create = page.getByRole('button', { name: CREATE }).or(page.getByRole('link', { name: CREATE })).first();
        if (await create.isVisible().catch(() => false)) {
          await context.storageState({ path: AUTH_FILE });
          return true;
        }
      }
    }
    if (!await checkLoginStatus()) throw new Error('Đăng nhập Threads chưa hoàn tất hoặc cửa sổ đã đóng. Bấm Threads để thử lại.');
    return false;
  } finally { await browser.close().catch(() => {}); }
}

export async function postToThreads({ imagePaths, caption, headless = false, prepareOnly = false }) {
  const text = prepareThreadsCaption(caption);
  if (!imagePaths?.length || imagePaths.some(file => !fs.existsSync(file))) {
    throw new Error('Không tìm thấy ảnh/video để đăng Threads.');
  }

  const uploadPaths = [];
  for (const p of imagePaths) {
    const ext = path.extname(p).toLowerCase();
    if (ext === '.mp4' || ext === '.mov') {
      uploadPaths.push(await sanitizeVideoAudioForCopyright(p));
    } else {
      uploadPaths.push(p);
    }
  }
  if (!await checkLoginStatus()) throw new Error('Chưa đăng nhập Threads. Bấm nút Threads trên giao diện để đăng nhập.');
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({ storageState: AUTH_FILE, locale: 'vi-VN' });
    const page = await context.newPage();
    try {
      await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      const create = page.getByRole('button', { name: CREATE }).or(page.getByRole('link', { name: CREATE })).first();
      await create.waitFor({ state: 'visible', timeout: 20000 });
      await create.click();
      // Threads can render its composer as a floating panel without role="dialog".
      const editorOnPage = page.locator('[contenteditable="true"]').last();
      await editorOnPage.waitFor({ state: 'visible', timeout: 20000 });
      const modal = page.getByRole('dialog').last();
      const dialog = await modal.isVisible().catch(() => false) ? modal
        : page.locator('div').filter({ has: editorOnPage }).filter({ has: page.getByRole('button', { name: /^(Post|Đăng)$/i }) }).last();
      const editor = dialog.locator('[contenteditable="true"][role="textbox"], [contenteditable="true"]').first();
      await editor.waitFor({ state: 'visible', timeout: 10000 });
      await editor.fill(text);
      let topicAttached = false;
      const topic = threadsTopic(text);
      const topicInput = dialog.getByPlaceholder(/Cộng đồng hoặc chủ đề|Community or topic|Add a topic/i).first();
      if (topic && await topicInput.isVisible().catch(() => false)) {
        try {
          await topicInput.fill(topic);
          // Select an exact topic; never join or choose an unrelated community.
          const topicPattern = new RegExp(`^${topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
          const choice = page.getByText(topicPattern).last();
          await choice.waitFor({ state: 'visible', timeout: 8000 });
          await choice.click();
          topicAttached = true;
        } catch {
          await topicInput.fill('').catch(() => {});
          console.warn(`[Threads] Không chọn được chủ đề ${topic}; giữ hashtag trong mô tả.`);
        }
      }
      let input = dialog.locator('input[type="file"]').first();
      if (!await input.count()) {
        await dialog.getByRole('button', { name: /Attach media|Add photos|Đính kèm|Thêm ảnh/i }).first().click();
        input = page.locator('input[type="file"]').last();
      }
      await input.setInputFiles(uploadPaths);
      // Do not submit a text-only post when media upload fails.
      await dialog.locator('video, img[src^="blob:"], button[aria-label*="Remove"], [role="button"][aria-label*="Remove"], button[aria-label*="Xóa"]').first()
        .waitFor({ state: 'visible', timeout: 90000 });
      const post = dialog.getByRole('button', { name: /^(Post|Đăng)$/i }).last();
      await post.waitFor({ state: 'visible', timeout: 10000 });
      for (let i = 0; i < 60 && !await post.isEnabled(); i++) await page.waitForTimeout(1000);
      if (!await post.isEnabled()) throw new Error('Threads chưa xử lý xong ảnh/video; chưa đăng bài.');
      const composed = await editor.innerText();
      for (const tag of text.match(/#[\p{L}\p{N}_]+/gu) || []) {
        if (!composed.includes(tag)) throw new Error(`Mô tả Threads bị mất hashtag ${tag}; chưa đăng bài.`);
      }
      if (prepareOnly) {
        await page.screenshot({ path: path.join(root, 'artifacts', 'threads-caption-preflight.png') });
        return { prepared: true, caption: composed, topicAttached, topic };
      }
      await post.click();
      // Closing the composer alone does not prove the post was published.
      await page.getByText(/^(Posted|Your thread was posted|Thread posted|Đã đăng|Đã đăng bài viết)(\.|!)?$/i).first()
        .waitFor({ state: 'visible', timeout: 90000 });
      await context.storageState({ path: AUTH_FILE });
      return { success: true, topicAttached, topic, message: 'Đã đăng trực tiếp lên Threads.' };
    } catch (error) {
      await page.screenshot({ path: path.join(root, 'threads_error.png') }).catch(() => {});
      throw new Error(`Threads: ${error.message}. Kiểm tra tài khoản trước khi thử lại để tránh đăng trùng.`);
    }
  } finally { await browser.close(); }
}

if (process.argv[2] === 'login' && path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  startInteractiveLogin().then(async () => {
    console.log('[Threads] Đã mở cửa sổ đăng nhập. Bạn hoàn tất đăng nhập trong cửa sổ này.');
    const success = await loginAttempt;
    console.log(success ? '[Threads] Đã kết nối và lưu phiên đăng nhập.' : '[Threads] Chưa hoàn tất đăng nhập.');
  }).catch(error => {
    console.error('[Threads] Không hoàn tất đăng nhập:', error.message);
    process.exitCode = 1;
  });
}
