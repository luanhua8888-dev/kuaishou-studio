import { PROJECT_ROOT } from '../../paths.js';
import { chromium } from 'playwright';
import { waitForTikTokUpload, waitForTikTokPostButton, waitForTikTokChecks, fillTikTokCaption } from './upload.js';
import { removeCaptionMentions } from '../../content/caption-text.js';
import { sanitizeVideoAudioForCopyright } from '../../media/anti-copyright.js';
import path from 'path';
import fs from 'fs';


export const AUTH_FILE = path.join(PROJECT_ROOT, 'tiktok_auth.json');

function getChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  return ['/usr/bin/chromium-browser', '/usr/bin/chromium'].find(p => fs.existsSync(p));
}

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
    const execPath = getChromiumExecutable();
    browser = await chromium.launch({
      headless: false,
      ...(execPath ? { executablePath: execPath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
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
export async function postToTikTok({ videoPath, caption, headless = false, onProgress = () => {} }) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Không tìm thấy file video để đăng lên TikTok: ${videoPath}`);
  }


  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error('Chưa đăng nhập TikTok! Vui lòng bấm vào nút "TikTok: Bấm để đăng nhập" trên giao diện trước.');
  }

  // Tự động lách bản quyền âm thanh (pitch shift +4.5%) cho video trước khi upload lên TikTok
  let uploadVideoPath = videoPath;
  try {
    uploadVideoPath = await sanitizeVideoAudioForCopyright(videoPath);
  } catch (err) {
    console.warn('[TikTok] Không thể xử lý lách bản quyền video, sử dụng file gốc:', err.message);
  }

  console.log(`\n[TikTok] Bắt đầu đăng video lên TikTok: ${uploadVideoPath}...`);
  const execPath = getChromiumExecutable();
  const browser = await chromium.launch({
    headless: headless,
    ...(execPath ? { executablePath: execPath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
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
    onProgress('TikTok: đang mở trang tải video…');
    console.log('[TikTok] Đang truy cập TikTok Studio Upload...');
    await page.goto('https://www.tiktok.com/tiktokstudio/upload?lang=vi-VN', { waitUntil: 'domcontentloaded', timeout: 45000 });

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
    const fileInput = await waitForTikTokUpload(page);

    await fileInput.setInputFiles(uploadVideoPath);
    onProgress('TikTok: đang tải và xử lý video…');
    console.log('Đã đưa file video vào hệ thống tải lên!');

    // 3. Wait for video upload to finish and Post button to be enabled
    console.log('[TikTok] Đang đợi TikTok xử lý video hoàn tất...');
    await waitForTikTokPostButton(page);
    console.log('Video đã tải lên xong và sẵn sàng để Đăng!');

    // 4. Click Post
    // Upload completion is separate from the copyright/content scans.
    console.log('[TikTok] Đang chờ kiểm tra bản quyền/nội dung hoàn tất trước khi đăng...');
    const checks = await waitForTikTokChecks(page, { onProgress });
    if (checks.checksPending) console.log('[TikTok] Kiểm tra vẫn đang chạy sau 3 phút; tiếp tục đăng theo cấu hình.');
    // TikTok can replace/reset its editor while loading the uploaded video.
    if (caption) {
      onProgress('TikTok: đang nhập và kiểm tra mô tả/hashtag…');
      await fillTikTokCaption(page, removeCaptionMentions(caption));
    }
    console.log('[TikTok] Đang bấm Đăng (Post) lên TikTok...');
    onProgress('TikTok: đang đăng và chờ xác nhận…');
    // Reacquire after scans: TikTok can replace the button or navigate away.
    const postBtn = await waitForTikTokPostButton(page);
    try {
      await postBtn.click({ timeout: 5000 });
    } catch {
      throw new Error('Không xác nhận được thao tác bấm Đăng trên TikTok. Hãy kiểm tra bài gần đây trong TikTok Studio trước khi thử lại để tránh đăng trùng.');
    }
    await page.waitForTimeout(2000);

    // A visible Post button can remain during processing; clicking twice risks duplicate posts.

    // Handle any confirmation popup (such as audio copyright / mute warning)
    try {
      const modalConfirmBtn = page.locator('button, div[role="button"]').filter({
        hasText: /^(Post anyway|Vẫn đăng|Đăng ngay|Tiếp tục đăng|Tiếp tục|Confirm|Xác nhận)$/i
      }).last();

      if (await modalConfirmBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        const dialogText = await page.locator('[role="dialog"]').last().innerText().catch(() => '');
        const buttonText = (await modalConfirmBtn.innerText().catch(() => '')).trim();
        if (/ineligible|không đủ điều kiện|community guidelines|vi phạm nguyên tắc/i.test(`${buttonText} ${dialogText}`) && !/vẫn đăng|post anyway|tắt tiếng|muted/i.test(buttonText)) {
          throw new Error(`TikTok hiển thị cảnh báo không đủ điều kiện trước khi đăng: ${dialogText.slice(0, 300) || buttonText}. Hãy kiểm tra trong TikTok Studio.`);
        }
        console.log('[TikTok] Phát hiện hộp thoại xác nhận (cảnh báo âm thanh/bản quyền), bấm chấp nhận:', buttonText);
        await modalConfirmBtn.click({ force: true });
        await page.waitForTimeout(2000);
      }
    } catch (error) {
      if (error.message.startsWith('TikTok hiển thị cảnh báo')) throw error;
    }

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
          text.includes('Video của bạn đã được đăng') ||
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
      throw new Error('TikTok chưa xác nhận đăng thành công. Hãy kiểm tra TikTok Studio trước khi thử lại để tránh đăng trùng.');
    }

    console.log('[TikTok] Đăng video lên TikTok hoàn tất!');
    await context.storageState({ path: AUTH_FILE });
    await browser.close();

    return { success: true, message: 'Đăng video lên TikTok thành công!' };
  } catch (err) {
    console.error('[TikTok] Lỗi đăng bài TikTok:', err.message);
    try {
      await page.screenshot({ path: path.join(PROJECT_ROOT, 'tiktok_error.png'), fullPage: true });
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
