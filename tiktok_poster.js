import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const AUTH_FILE = path.join(__dirname, 'tiktok_auth.json');

/**
 * Check if the saved session is already logged into TikTok
 */
export async function checkLoginStatus() {
  if (!fs.existsSync(AUTH_FILE)) {
    return false;
  }

  try {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    const cookies = data.cookies || [];
    const hasSession = cookies.some(c => 
      (c.name === 'sessionid' || c.name === 'sessionid_ss') && 
      (!c.expires || c.expires * 1000 > Date.now())
    );
    return hasSession;
  } catch {
    return false;
  }
}

/**
 * Launch an interactive visible browser window for the user to log into TikTok
 */
export async function interactiveLogin() {
  console.log('\n======================================================');
  console.log('[TikTok] Vui lòng đăng nhập vào tài khoản TikTok của bạn...');
  console.log('[TikTok] Sau khi đăng nhập xong, bạn có thể đóng cửa sổ.');
  console.log('======================================================\n');

  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--start-maximized'
      ]
    });

    const context = await browser.newContext({
      viewport: null,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      locale: 'vi-VN'
    });

    const page = await context.newPage();
    await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded' });

    // Poll until login is successful or browser closed
    let loggedIn = false;
    for (let i = 0; i < 180; i++) { // wait up to 6 minutes
      await page.waitForTimeout(2000);

      try {
        const cookies = await context.cookies();
        const hasSessionCookie = cookies.some(c => c.name === 'sessionid' || c.name === 'sessionid_ss' || c.name === 'sid_tt');
        const url = page.url();
        const isPastLogin = !url.includes('/login') && !url.includes('/signup');

        const hasProfile = await page.evaluate(() => {
          return !!document.querySelector('[data-e2e="profile-icon"], img[class*="Avatar"], a[href*="/@"]');
        }).catch(() => false);

        if (hasSessionCookie && (isPastLogin || hasProfile)) {
          console.log('[TikTok] Đã phát hiện đăng nhập TikTok thành công!');
          loggedIn = true;
          await context.storageState({ path: AUTH_FILE });
          console.log(`[TikTok] Đã lưu phiên đăng nhập TikTok vào: ${AUTH_FILE}`);
          await page.waitForTimeout(3000);
          break;
        }
      } catch (err) {
        console.log('Cửa sổ trình duyệt đã đóng.');
        break;
      }
    }

    if (loggedIn) {
      await context.storageState({ path: AUTH_FILE });
    }

    await browser.close();
    return loggedIn;
  } catch (err) {
    console.error('Lỗi khi mở trình duyệt đăng nhập TikTok:', err.message);
    if (browser) {
      try { await browser.close(); } catch {}
    }
    return false;
  }
}

/**
 * Automatically post a video to TikTok via TikTok Studio / Creator Upload
 */
export async function postToTikTok({ videoPath, caption, headless = false }) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Không tìm thấy file video để đăng lên TikTok: ${videoPath}`);
  }

  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error('Chưa đăng nhập TikTok! Vui lòng bấm vào nút "TikTok: Bấm để đăng nhập" trên giao diện trước.');
  }

  console.log(`\n[TikTok] Bắt đầu đăng video lên TikTok: ${videoPath}...`);
  const browser = await chromium.launch({
    headless: headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--start-maximized'
    ]
  });

  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1366, height: 850 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    locale: 'vi-VN'
  });

  const page = await context.newPage();

  try {
    console.log('[TikTok] Đang truy cập TikTok Studio Upload...');
    await page.goto('https://www.tiktok.com/tiktokstudio/upload?lang=vi-VN', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);

    // Check if session expired
    if (page.url().includes('/login')) {
      throw new Error('Phiên đăng nhập TikTok đã hết hạn! Vui lòng bấm nút đăng nhập lại trên giao diện.');
    }

    // Dismiss any introductory modals or popups if shown
    for (const sel of ['button:has-text("Đã hiểu")', 'button:has-text("Got it")', 'button:has-text("Đóng")', 'button:has-text("Bỏ qua")']) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click({ force: true });
        }
      } catch {}
    }

    // 1. Upload video file via input[type="file"]
    console.log('[TikTok] Đang tải video lên TikTok...');
    let fileInput = page.locator('input[type="file"]').first();
    let foundInput = false;

    if (await fileInput.count() > 0) {
      foundInput = true;
    } else {
      // Check if inside an iframe
      for (const frame of page.frames()) {
        const fInput = frame.locator('input[type="file"]').first();
        if (await fInput.count() > 0) {
          fileInput = fInput;
          foundInput = true;
          break;
        }
      }
    }

    if (!foundInput) {
      await fileInput.waitFor({ state: 'attached', timeout: 25000 });
    }

    await fileInput.setInputFiles(videoPath);
    console.log('Đã đưa file video vào hệ thống tải lên!');
    await page.waitForTimeout(5000);

    // 2. Fill Caption
    if (caption) {
      console.log('[TikTok] Đang nhập Caption vào TikTok...');
      const captionSelectors = [
        'div[contenteditable="true"]',
        'div[data-e2e="caption-input"]',
        'div[role="combobox"]',
        'div.DraftEditor-root div[contenteditable="true"]'
      ];

      let captionBox = null;
      for (const sel of captionSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          captionBox = el;
          break;
        }
      }

      if (captionBox) {
        await captionBox.click({ force: true });
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(500);
        await page.keyboard.insertText(caption);
        await page.waitForTimeout(1500);
      }
    }

    // 3. Wait for video upload to finish and Post button to be enabled
    console.log('[TikTok] Đang đợi TikTok xử lý video hoàn tất...');
    const postBtn = page.locator('button').filter({ hasText: /^(Post|Đăng)$/ }).last();
    await postBtn.waitFor({ state: 'attached', timeout: 35000 });
    await postBtn.scrollIntoViewIfNeeded().catch(() => {});

    // Wait until Post button is enabled (video upload 100%)
    for (let i = 0; i < 60; i++) {
      await postBtn.scrollIntoViewIfNeeded().catch(() => {});
      const isDisabled = await postBtn.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true').catch(() => true);
      if (!isDisabled) {
        console.log('Video đã tải lên xong và sẵn sàng để Đăng!');
        break;
      }
      await page.waitForTimeout(1500);
    }

    // 4. Click Post
    console.log('[TikTok] Đang bấm Đăng (Post) lên TikTok...');
    await postBtn.scrollIntoViewIfNeeded().catch(() => {});
    await postBtn.click({ force: true });
    await page.waitForTimeout(2000);

    // Kiểm tra nếu nút Post vẫn chưa nhận, thử click lại
    if (await postBtn.isVisible().catch(() => false)) {
      const isStillDisabled = await postBtn.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true').catch(() => true);
      if (!isStillDisabled) {
        console.log('[TikTok] Thử nhấn lại nút Đăng...');
        await postBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1500);
      }
    }

    // 4.5. Xử lý hộp thoại xác nhận nếu xuất hiện (ví dụ "Post anyway" / "Vẫn đăng" khi đang quét bản quyền nhạc)
    try {
      const modalConfirmBtn = page.locator('button, div[role="button"]').filter({
        hasText: /^(Post anyway|Vẫn đăng|Đăng ngay|Tiếp tục đăng|Tiếp tục|Confirm|Xác nhận)$/i
      }).last();

      if (await modalConfirmBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        console.log('[TikTok] Phát hiện hộp thoại xác nhận, bấm:', (await modalConfirmBtn.innerText().catch(() => '')).trim());
        await modalConfirmBtn.click({ force: true });
        await page.waitForTimeout(2000);
      }
    } catch {}

    // 5. Wait for success confirmation
    console.log('[TikTok] Đang chờ xác nhận đăng bài TikTok...');
    const checkSuccess = async () => {
      for (let i = 0; i < 45; i++) {
        await page.waitForTimeout(2000);
        const url = page.url();
        if (url.includes('/tiktokstudio/content') || url.includes('/manage')) {
          console.log('[TikTok] Đã chuyển hướng về trang quản lý bài đăng, đăng video thành công!');
          return true;
        }

        const text = await page.evaluate(() => document.body.innerText || '');
        if (
          text.includes('Video của bạn đã được tải lên') ||
          text.includes('Video của bạn đã được đăng') ||
          text.includes('Your video has been uploaded') ||
          text.includes('Your video is being uploaded') ||
          text.includes('Quản lý bài đăng') ||
          text.includes('Quản lý video') ||
          text.includes('Manage your posts') ||
          text.includes('Đăng video khác') ||
          text.includes('Upload another video')
        ) {
          console.log('[TikTok] Nhận diện thông báo hoàn tất đăng video!');
          return true;
        }
      }
      return false;
    };

    const isSuccess = await checkSuccess();
    if (!isSuccess) {
      console.log('[TikTok] Đã bấm Đăng và xác nhận, kết thúc tiến trình.');
    }

    console.log('[TikTok] Đăng video lên TikTok hoàn tất!');
    await context.storageState({ path: AUTH_FILE });
    await page.waitForTimeout(3000);
    await browser.close();

    return { success: true, message: 'Đăng video lên TikTok thành công!' };
  } catch (err) {
    console.error('[TikTok] Lỗi đăng bài TikTok:', err.message);
    try {
      await page.screenshot({ path: path.join(__dirname, 'tiktok_error.png') });
    } catch {}
    await browser.close();
    throw err;
  }
}

// Standalone execution
if (process.argv[2] === 'login') {
  interactiveLogin().then(success => {
    if (success) {
      console.log('[TikTok] Đăng nhập TikTok thành công!');
    } else {
      console.log('[TikTok] Chưa hoàn tất đăng nhập TikTok.');
    }
    process.exit(0);
  });
}
