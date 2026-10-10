import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { waitForTikTokPostButton, waitForTikTokChecks, fillTikTokCaption } from './tiktok-upload.js';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(html, run, pathname = '/tiktokstudio/upload') {
  const page = await browser.newPage();
  try {
    await page.route('https://fixture.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto(`https://fixture.test${pathname}`);
    await run(page);
  } finally { await page.close(); }
}

test('finds a visible role button with whitespace and ignores a hidden duplicate', async () => {
  await fixture('<div role="button" id="post">  Đăng  </div><button hidden>Đăng</button>', async page => {
    const button = await waitForTikTokPostButton(page, { polls: 1 });
    assert.equal(await button.getAttribute('id'), 'post');
  });
});

test('reacquires a replacement button after video processing', async () => {
  await fixture('<button disabled>Post</button>', async page => {
    await page.evaluate(() => setTimeout(() => {
      document.body.innerHTML = '<button id="ready">Post</button>';
    }, 50));
    const button = await waitForTikTokPostButton(page, { polls: 20, delayMs: 20 });
    assert.equal(await button.getAttribute('id'), 'ready');
  });
});

test('finds the post button inside an iframe', async () => {
  await fixture('<iframe srcdoc="<button>Đăng</button>"></iframe>', async page => {
    const button = await waitForTikTokPostButton(page, { polls: 5, delayMs: 20 });
    assert.equal(await button.innerText(), 'Đăng');
  });
});

test('stops on dashboard navigation without clicking or claiming success', async () => {
  await fixture('<button onclick="window.clicked=true">Post</button>', async page => {
    await assert.rejects(waitForTikTokPostButton(page, { polls: 1 }), /kiểm tra bài gần đây/);
    assert.equal(await page.evaluate(() => !!window.clicked), false);
  }, '/tiktokstudio');
});

test('reports an expired session and never clicks a disabled post button', async () => {
  await fixture('<button>Post</button>', async page => {
    await assert.rejects(waitForTikTokPostButton(page, { polls: 1 }), /hết hạn/);
  }, '/login');
  await fixture('<button disabled>Post</button>', async page => {
    await assert.rejects(waitForTikTokPostButton(page, { polls: 2, delayMs: 1 }), /chưa được bấm Đăng/);
  });
});

test('waits until both visible checks complete and reports progress', async () => {
  await fixture('<div class="status-result status-checking" id="music">Checking...</div><div class="status-result status-checking" id="content">Đang kiểm tra.</div>', async page => {
    const progress = [];
    await page.evaluate(() => {
      setTimeout(() => { document.querySelector('#music').className = 'status-result status-success'; document.querySelector('#music').textContent = 'Passed'; }, 20);
      setTimeout(() => { document.querySelector('#content').className = 'status-result status-success'; document.querySelector('#content').textContent = 'Passed'; }, 80);
    });
    await waitForTikTokChecks(page, { timeoutMs: 1000, delayMs: 10, onProgress: message => progress.push(message) });
    assert.match(await page.locator('#content').innerText(), /Passed/);
    assert.ok(progress.length);
  });
});

test('ignores hidden previous scan statuses and captions mentioning checking', async () => {
  await fixture('<div class="status-result status-checking" data-show="false">Đang kiểm tra.</div><div class="status-result status-warn" hidden>Copyright issue</div><div contenteditable="true">Đang kiểm tra. Checking...</div><div class="status-result status-success">Passed</div>', async page => {
    await waitForTikTokChecks(page, { timeoutMs: 100, delayMs: 10 });
  });
});

test('returns pending after the wait limit so the caller can submit exactly once', async () => {
  await fixture('<div class="status-result status-checking">Đang kiểm tra. Sẽ mất khoảng 10 phút.</div><button onclick="window.clicked=true">Post</button>', async page => {
    const result = await waitForTikTokChecks(page, { timeoutMs: 50, delayMs: 10 });
    assert.equal(result.checksPending, true);
    assert.equal(await page.evaluate(() => !!window.clicked), false);
    const post = await waitForTikTokPostButton(page, { polls: 1 });
    await post.click();
    assert.equal(await page.evaluate(() => !!window.clicked), true);
  });
});

test('stops immediately on a scan error, rights warning, or daily limit', async () => {
  for (const [className, text] of [['status-error', 'Đã xảy ra lỗi. Vui lòng thử lại sau.'], ['status-warn', 'Copyright issue'], ['status-ready', 'Bạn đã đạt giới hạn kiểm tra hôm nay.']]) {
    await fixture(`<div class="status-result ${className}">${text}</div><button onclick="window.clicked=true">Post</button>`, async page => {
      await assert.rejects(waitForTikTokChecks(page, { timeoutMs: 100, delayMs: 10 }), /không hoàn tất kiểm tra/);
      assert.equal(await page.evaluate(() => !!window.clicked), false);
    });
  }
});

test('waits for visible checking text when status markup changes', async () => {
  await fixture('<p>Checking...</p>', async page => {
    const result = await waitForTikTokChecks(page, { timeoutMs: 30, delayMs: 10 });
    assert.equal(result.checksPending, true);
  });
});

test('fills and commits the exact caption with hashtags before submitting', async () => {
  await fixture('<div contenteditable="true">video_safe</div><button>Post</button>', async page => {
    await fillTikTokCaption(page, 'One day you will also arrive here.\n\n#nature #landscape');
    assert.match(await page.locator('[contenteditable]').innerText(), /One day you will also arrive here\./);
    assert.match(await page.locator('[contenteditable]').innerText(), /#nature #landscape/);
  });
});

test('stops when the editor resets the caption on blur', async () => {
  await fixture('<div contenteditable="true" onblur="this.textContent=\'\'">video_safe</div><button>Post</button>', async page => {
    await assert.rejects(fillTikTokCaption(page, 'One day #nature'), /không giữ đúng mô tả/);
  });
});
