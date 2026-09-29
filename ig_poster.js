import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const AUTH_FILE = path.join(__dirname, 'ig_auth.json');

/**
 * Check if the saved session is already logged into Instagram
 */
export async function checkLoginStatus() {
  if (!fs.existsSync(AUTH_FILE)) {
    return false;
  }

  try {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    const cookies = data.cookies || [];
    const hasSession = cookies.some(c => c.name === 'sessionid' && (!c.expires || c.expires * 1000 > Date.now()));
    return hasSession;
  } catch {
    return false;
  }
}

/**
 * Open interactive browser for user to log into Instagram
 */
export async function interactiveLogin() {
  console.log('\n[Instagram] Đang mở trình duyệt để bạn đăng nhập Instagram...');
  console.log('[Instagram] Vui lòng đăng nhập trên cửa sổ Chrome vừa mở.');

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--start-maximized'
      ]
    });

    const contextOptions = {
      viewport: null, // use window size
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      locale: 'vi-VN'
    };

    if (fs.existsSync(AUTH_FILE)) {
      try {
        contextOptions.storageState = AUTH_FILE;
      } catch {}
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    await page.goto('https://www.instagram.com/');

    // Poll until login is successful or browser closed
    let loggedIn = false;
    for (let i = 0; i < 180; i++) { // wait up to 6 minutes
      await page.waitForTimeout(2000);

      try {
        // Check cookies
        const cookies = await context.cookies();
        const hasSessionCookie = cookies.some(c => c.name === 'sessionid');

        // Check DOM elements
        const hasDomIcon = await page.evaluate(() => {
          return !!document.querySelector('svg[aria-label="New post"], svg[aria-label="Create"], svg[aria-label="Tạo"], svg[aria-label="Bài viết mới"]');
        }).catch(() => false);

        if (hasSessionCookie || hasDomIcon) {
          console.log('[Instagram] Đã phát hiện đăng nhập thành công!');
          loggedIn = true;
          // Save storage state (cookies + tokens)
          await context.storageState({ path: AUTH_FILE });
          console.log(`[Instagram] Đã lưu phiên đăng nhập vào: ${AUTH_FILE}`);
          await page.waitForTimeout(3000);
          break;
        }
      } catch (err) {
        // Browser closed by user
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
    console.error('Lỗi khi mở trình duyệt đăng nhập:', err.message);
    if (browser) {
      try { await browser.close(); } catch {}
    }
    return false;
  }
}

/**
 * Dismiss popups like "Turn on Notifications" or "Save login info"
 */
async function dismissPopups(page) {
  const selectors = [
    'button:has-text("Lúc khác")',
    'button:has-text("Not Now")',
    'button:has-text("Không phải bây giờ")',
    'button:has-text("Bỏ qua")',
    'div[role="button"]:has-text("Lúc khác")',
    'div[role="button"]:has-text("Not Now")'
  ];

  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`Đang đóng popup: ${sel}...`);
        await btn.click({ force: true });
        await page.waitForTimeout(1000);
      }
    } catch {}
  }
}

/**
 * Automatically post images or Reel video to Instagram
 */
export async function postToInstagram({ imagePaths, caption, headless = false, shareToFacebook = false }) {
  if (!imagePaths || imagePaths.length === 0) {
    throw new Error('Danh sách file tải lên trống');
  }

  // Chuẩn hóa và tối ưu hóa hình ảnh đạt chuẩn chất lượng cao nhất cho Instagram (chuẩn 1080px, không nén mờ)
  const sanitizedUploadPaths = [];
  for (const p of imagePaths) {
    if (!fs.existsSync(p)) {
      throw new Error(`Không tìm thấy file: ${p}`);
    }

    const ext = path.extname(p).toLowerCase();
    const isVideo = ext === '.mp4' || ext === '.mov';

    if (isVideo) {
      sanitizedUploadPaths.push(p);
      continue;
    }

    // Đối với ảnh:
    // 1. Instagram khuyến nghị độ rộng tối đa 1080px (nếu > 1080px Instagram sẽ tự nén mờ bằng thuật toán bilinear kém chất lượng)
    // 2. Chuyển đổi WebP hoặc ảnh kích thước lớn sang JPG 1080px siêu nét bằng bộ lọc lanczos + qscale 1
    const jpgPath = p.replace(/\.[^.]+$/, '') + '_ig.jpg';
    try {
      const { stdout: dims } = await new Promise((resolve) => {
        exec(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${p}"`, (err, stdout) => {
          resolve({ stdout: stdout || '' });
        });
      });
      const [w, h] = dims.trim().split(',').map(Number);

      let vf = '';
      if (w && w !== 1080) {
        // Chuẩn hóa bề ngang về chính xác 1080px (chuẩn vàng hiển thị nét nhất của Instagram)
        // Sử dụng bộ lọc nội suy Lanczos 8-tap cao cấp + unsharp mask tăng độ chi tiết vi mô, triệt tiêu nhòe mờ
        vf = '-vf "scale=1080:-2:flags=lanczos,unsharp=lx=3:ly=3:la=0.35:cx=3:cy=3:ca=0.0"';
      } else {
        // Dù đã 1080px, vẫn tối ưu hóa độ nét chống nén mờ của mạng xã hội
        vf = '-vf "unsharp=lx=3:ly=3:la=0.3:cx=3:cy=3:ca=0.0"';
      }

      await new Promise((resolve, reject) => {
        exec(`ffmpeg -y -i "${p}" ${vf} -qscale:v 1 -qmin 1 -pix_fmt yuvj420p -color_range pc -update 1 -frames:v 1 "${jpgPath}"`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      sanitizedUploadPaths.push(jpgPath);
    } catch {
      sanitizedUploadPaths.push(p);
    }
  }

  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error('Chưa đăng nhập Instagram! Vui lòng bấm vào nút "Instagram: Bấm để đăng nhập" trên giao diện trước.');
  }

  console.log(`\n[Instagram] Bắt đầu đăng ${sanitizedUploadPaths.length} file lên Instagram...`);
  const browser = await chromium.launch({
    headless: headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--start-maximized'
    ]
  });

  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1280, height: 850 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    locale: 'vi-VN'
  });

  const page = await context.newPage();

  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3500);

    // Close any blocking popups ("Bật thông báo", "Lưu thông tin")
    await dismissPopups(page);

    // 1. Check if logged in
    const isLogged = await page.evaluate(() => {
      return !!document.querySelector('svg[aria-label="New post"], svg[aria-label="Create"], svg[aria-label="Tạo"], svg[aria-label="Bài viết mới"]');
    });

    if (!isLogged) {
      throw new Error('Phiên đăng nhập đã hết hạn! Vui lòng bấm nút đăng nhập lại trên giao diện.');
    }

    // 2. Click "Create" (Tạo) button
    console.log('[Instagram] Đang mở modal tạo bài viết...');
    const svg = page.locator('svg[aria-label="Bài viết mới"], svg[aria-label="New post"], svg[aria-label="Tạo"], svg[aria-label="Create"]').first();
    const taoClickable = svg.locator('xpath=ancestor::*[@role="button" or @role="link" or self::a or self::div][position()<=3]').last();
    if (await taoClickable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await taoClickable.click({ force: true });
    } else {
      const createFallback = page.locator('span:has-text("Tạo"), span:has-text("Create")').first();
      await createFallback.click({ force: true });
    }
    await page.waitForTimeout(1500);

    // If sub-option "Post" / "Bài viết" appears, click it
    const postMenuOption = page.locator('div, a, span').filter({ hasText: /^(Bài viết|Post)$/ }).last();
    if (await postMenuOption.isVisible({ timeout: 3500 }).catch(() => false)) {
      console.log('[Instagram] Chọn mục: Bài viết...');
      await postMenuOption.click({ force: true });
      await page.waitForTimeout(2000);
    }

    // 3. Upload files via file input
    console.log(`[Instagram] Đang tải lên ${sanitizedUploadPaths.length} file...`);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 20000 });
    await fileInput.setInputFiles(sanitizedUploadPaths);
    await page.waitForTimeout(4000);

    // Dismiss "Video posts are now shared as reels" / "Đã chia sẻ dưới dạng thước phim" if shown
    const okBtn = page.locator('button:has-text("OK"), button:has-text("Đã hiểu"), button:has-text("Tiếp tục")').first();
    if (await okBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Dismissing Reels notification...');
      await okBtn.click();
      await page.waitForTimeout(1500);
    }

    // Modal dialog container
    const dialog = page.locator('div[role="dialog"]').first();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });

    // Chọn góc cắt "Nguyên bản" (Original) hoặc "4:5" để Instagram không tự động cắt vuông 1:1 làm mất chi tiết ảnh
    try {
      console.log('[Instagram] Chọn góc cắt tỉ lệ tối ưu...');
      const cropBtn = dialog.locator('svg[aria-label="Chọn góc cắt"], svg[aria-label="Select crop"]').first();
      const cropClickable = cropBtn.locator('xpath=ancestor::*[@role="button" or self::button][1]').first();
      if (await cropClickable.isVisible({ timeout: 4000 }).catch(() => false)) {
        await cropClickable.click();
        await page.waitForTimeout(800);
        const originalOption = page.locator('span, div, button').filter({ hasText: /^(Nguyên bản|Original|4:5)$/ }).first();
        if (await originalOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log('[Instagram] Đã chọn tỉ lệ:', (await originalOption.innerText().catch(() => 'Original')).trim());
          await originalOption.click();
          await page.waitForTimeout(800);
        }
      }
    } catch {}

    // 4. Click "Next" (Crop / Edit screen)
    console.log('[Instagram] Chuyển qua bước chỉnh sửa...');
    const nextBtn1 = dialog.locator('div[role="button"], button').filter({ hasText: /^(Next|Tiếp)$/ }).last();
    await nextBtn1.waitFor({ state: 'visible', timeout: 12000 });
    await nextBtn1.click({ force: true });
    await page.waitForTimeout(2500);

    // 5. Click "Next" (Cover / Filters screen)
    console.log('[Instagram] Chuyển qua bước viết caption...');
    const nextBtn2 = dialog.locator('div[role="button"], button').filter({ hasText: /^(Next|Tiếp)$/ }).last();
    await nextBtn2.waitFor({ state: 'visible', timeout: 12000 });
    await nextBtn2.click({ force: true });
    await page.waitForTimeout(2500);

    // 6. Enter Caption
    if (caption) {
      console.log('[Instagram] Đang nhập caption...');
      const captionBox = dialog.locator('div[aria-label="Write a caption..."], div[aria-label="Viết chú thích..."], div[aria-label="Thêm chú thích..."], div[role="textbox"]').first();
      await captionBox.waitFor({ state: 'visible', timeout: 10000 });
      await captionBox.click({ force: true });
      await page.keyboard.insertText(caption);
      await page.waitForTimeout(1500);
    }

    // 6.5. Xử lý chia sẻ chéo sang Facebook & Threads theo tuỳ chọn
    try {
      console.log(`[Instagram] Kiểm tra cấu hình chia sẻ Facebook (Mục tiêu: ${shareToFacebook ? 'BẬT' : 'TẮT'})...`);

      // Mở rộng phần "Chia sẻ lên" nếu đang bị thu gọn
      const shareSection = dialog.locator('div, span, button').filter({ hasText: /^(Chia sẻ lên|Share to)$/i }).first();
      let fbRow = dialog.locator('div').filter({ hasText: /Facebook/i }).filter({ has: dialog.locator('input[role="switch"]') }).last();
      let fbSwitch = fbRow.locator('input[role="switch"]').last();

      if ((await fbSwitch.count()) === 0 && await shareSection.isVisible({ timeout: 1500 }).catch(() => false)) {
        console.log('[Instagram] Mở rộng danh sách Chia sẻ lên...');
        await shareSection.click().catch(() => {});
        await page.waitForTimeout(1000);
        fbRow = dialog.locator('div').filter({ hasText: /Facebook/i }).filter({ has: dialog.locator('input[role="switch"]') }).last();
        fbSwitch = fbRow.locator('input[role="switch"]').last();
      }

      if ((await fbSwitch.count()) > 0) {
        const isChecked = (await fbSwitch.evaluate(el => el.checked).catch(() => false)) || 
                          ((await fbSwitch.getAttribute('aria-checked').catch(() => 'false')) === 'true');

        if (shareToFacebook) {
          if (!isChecked) {
            console.log('[Instagram] Đang BẬT công tắc chia sẻ sang Facebook...');
            await fbSwitch.click();
            await page.waitForTimeout(1500);

            // Kiểm tra modal xác nhận bật chia sẻ sang Facebook
            const fbTurnOnModalBtn = page.locator('button, div[role="button"]').filter({
              hasText: /^(Chia sẻ thước phim này|Chia sẻ bài viết này|Luôn chia sẻ|Share this reel|Share this post|Always share)/i
            }).first();
            if (await fbTurnOnModalBtn.isVisible({ timeout: 3500 }).catch(() => false)) {
              console.log('[Instagram] Xác nhận chia sẻ sang Facebook:', (await fbTurnOnModalBtn.innerText().catch(() => '')).trim());
              await fbTurnOnModalBtn.click();
              await page.waitForTimeout(1000);
            }
          } else {
            console.log('[Instagram] Công tắc chia sẻ Facebook đã BẬT sẵn.');
          }
        } else {
          if (isChecked) {
            console.log('[Instagram] Đang TẮT công tắc chia sẻ sang Facebook...');
            await fbSwitch.click();
            await page.waitForTimeout(1000);

            // Kiểm tra nếu Instagram hỏi xác nhận "Dừng chia sẻ lên Facebook?"
            const confirmBtn = page.locator('button, div[role="button"]').filter({
              hasText: /^(Dừng chia sẻ|Không chia sẻ bài viết này|Dừng chia sẻ tất cả bài viết|Stop sharing)/i
            }).first();
            if (await confirmBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
              console.log('[Instagram] Xác nhận dừng chia sẻ lên Facebook...');
              await confirmBtn.click();
              await page.waitForTimeout(1000);
            }
          } else {
            console.log('[Instagram] Công tắc chia sẻ Facebook đã TẮT sẵn.');
          }
        }
      } else {
        console.log('[Instagram] Không tìm thấy công tắc chia sẻ Facebook trong giao diện Instagram.');
      }

      // Threads: Luôn tắt để tránh đăng rác
      const threadsRow = dialog.locator('div').filter({ hasText: /Threads/i }).filter({ has: dialog.locator('input[role="switch"]') }).last();
      const threadsSwitch = threadsRow.locator('input[role="switch"]').last();
      if ((await threadsSwitch.count()) > 0) {
        const isThreadsChecked = (await threadsSwitch.evaluate(el => el.checked).catch(() => false)) || 
                                ((await threadsSwitch.getAttribute('aria-checked').catch(() => 'false')) === 'true');
        if (isThreadsChecked) {
          console.log('[Instagram] Tắt chia sẻ sang Threads...');
          await threadsSwitch.click();
          await page.waitForTimeout(800);
        }
      }
    } catch (e) {
      console.log('[Instagram] Bỏ qua bước cấu hình chia sẻ Facebook/Threads:', e.message);
    }

    // 7. Click "Share" (Chia sẻ)
    console.log('[Instagram] Đang bấm Đăng (Chia sẻ)...');
    const shareBtn = dialog.locator('div[role="button"], button').filter({ hasText: /^(Chia sẻ|Share)$/ }).last();
    await shareBtn.waitFor({ state: 'visible', timeout: 10000 });
    await shareBtn.scrollIntoViewIfNeeded().catch(() => {});
    await shareBtn.click();
    await page.waitForTimeout(2000);

    // Nếu sau 2s modal vẫn ở màn hình soạn thảo và nút Chia sẻ còn hiển thị, thử click lại
    if (await shareBtn.isVisible().catch(() => false)) {
      console.log('[Instagram] Thử nhấn lại nút Chia sẻ...');
      await shareBtn.click({ force: true }).catch(() => {});
    }

    // 8. Wait for completion confirmation
    console.log('[Instagram] Đang đợi Instagram xử lý và hoàn tất...');
    const checkCompletion = async () => {
      for (let i = 0; i < 60; i++) { // wait up to 120s
        await page.waitForTimeout(2000);

        const stateInfo = await page.evaluate(() => {
          const text = document.body.innerText || '';
          return {
            isUploading: text.includes('Đang chia sẻ') || text.includes('Sharing'),
            isDone: text.includes('Đã chia sẻ bài viết') ||
                    text.includes('Đã chia sẻ thước phim') ||
                    text.includes('Your post has been shared') ||
                    text.includes('Your reel has been shared') ||
                    text.includes('Đã chia sẻ')
          };
        });

        if (stateInfo.isDone) {
          console.log('[Instagram] Nhận diện thông báo hoàn tất: Đã chia sẻ!');
          return true;
        }

        const hasCheckmark = (await page.locator('img[alt*="checkmark"], img[alt*="dấu kiểm"]').count()) > 0;
        if (hasCheckmark) {
          console.log('[Instagram] Nhận diện dấu kiểm hoàn tất thành công.');
          return true;
        }

        const dialogStillThere = await page.locator('div[role="dialog"]').isVisible().catch(() => false);
        if (!dialogStillThere) {
          console.log('[Instagram] Hộp thoại đăng đã đóng, hoàn tất đăng bài.');
          return true;
        }

        if (stateInfo.isUploading && i % 5 === 0) {
          console.log('[Instagram] Đang trong tiến trình chia sẻ video...');
        }
      }
      return false;
    };

    const isDone = await checkCompletion();
    if (!isDone) {
      throw new Error('Chưa nhận được xác nhận đăng bài thành công từ Instagram (quá thời gian chờ).');
    }

    console.log('[Instagram] Đăng bài lên Instagram thành công!');
    // Update cookies
    await context.storageState({ path: AUTH_FILE });
    await page.waitForTimeout(3000);
    await browser.close();
    return { success: true, message: 'Đăng bài lên Instagram thành công!' };
  } catch (err) {
    console.error('[Instagram] Lỗi đăng bài:', err.message);
    try {
      await page.screenshot({ path: path.join(__dirname, 'ig_error.png') });
    } catch {}
    await browser.close();
    throw err;
  }
}

// Standalone execution
if (process.argv[2] === 'login') {
  interactiveLogin().then(success => {
    if (success) {
      console.log('[Instagram] Đăng nhập Instagram thành công!');
    } else {
      console.log('[Instagram] Chưa hoàn tất đăng nhập.');
    }
    process.exit(0);
  });
}
