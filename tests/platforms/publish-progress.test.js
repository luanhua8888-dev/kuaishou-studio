import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { publishPlatforms } from '../../src/platforms/publish.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('parallel progress identifies all active platforms and preserves separate clocks and final states', async () => {
  const tiktok = deferred(), threads = deferred(), youtube = deferred();
  const updates = [];
  let youtubeUpdate;
  const request = publishPlatforms({ autoPostTikTok: true, autoPostThreads: true, autoPostYouTube: true }, {
    videoPath: 'tiktok.mp4', youtubeVideoPath: 'youtube.mp4'
  }, {
    tiktok: () => tiktok.promise,
    threads: () => threads.promise,
    youtube: input => { youtubeUpdate = input.onProgress; return youtube.promise; }
  }, (message, details) => updates.push({ message, ...details }));
  const initial = updates.at(-1);
  assert.deepEqual(initial.platforms.map(item => item.label), ['TikTok', 'Threads', 'YouTube Shorts']);
  youtubeUpdate('Đang gửi dữ liệu…');
  assert.match(updates.at(-1).message, /Đang đăng: TikTok \+ Threads \+ YouTube Shorts/);
  assert.equal(updates.at(-1).platforms[2].startedAt, initial.platforms[2].startedAt);
  assert.equal(initial.platforms[2].message, 'Đang chuẩn bị tải video…');

  youtube.resolve({ queued: true, queueId: 'id', message: 'Chờ 24 giờ trên máy', retryAt: 123 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.at(-1).platforms[2].status, 'queued');
  assert.match(updates.at(-1).message, /Đang đăng: TikTok \+ Threads\./);
  youtubeUpdate('Late callback must not mark queued video as uploading');
  assert.equal(updates.at(-1).platforms[2].status, 'queued');
  tiktok.resolve({ success: true });
  threads.reject(new Error('Threads timeout'));
  const result = await request;
  assert.deepEqual(result.platformProgress.map(item => item.status), ['done', 'failed', 'queued']);
  assert.ok(result.platformProgress.every(item => Number.isFinite(item.endedAt)));
  assert.equal(result.youtubePosted, false);
  assert.equal(result.youtubeQueued, true);
  assert.equal(result.tiktokPosted, true);
});

test('Instagram-only progress never incorrectly names Facebook as active', async () => {
  const updates = [];
  await publishPlatforms({ autoPostIG: true }, { imagePaths: ['image.jpg'] }, {
    instagram: async () => ({ success: true })
  }, (_, details) => updates.push(details));
  assert.equal(updates[0].platforms[0].label, 'Instagram');
  assert.equal(updates.at(-1).platforms[0].status, 'done');
});

test('UI renders platform names and independent timers, freezes completed timers, and uses literal text', () => {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.hidden = false; this.textContent = ''; }
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.children.push(item); }
    replaceChildren(...items) { this.children = items; }
    setAttribute() {}
  }
  const container = new Element();
  const all = node => [node, ...node.children.flatMap(all)];
  const document = {
    getElementById: () => container,
    createElement: () => new Element(),
    createTextNode: text => Object.assign(new Element(), { textContent: text }),
    querySelectorAll: () => all(container).filter(node => Object.hasOwn(node.dataset, 'platformStart'))
  };
  let currentTime = 5000;
  const context = vm.createContext({ document, Date: { now: () => currentTime } });
  const html = fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  const start = html.indexOf('    function updatePlatformTimers()');
  const end = html.indexOf('    function finishManualProgress()', start);
  vm.runInContext(html.slice(start, end), context);
  context.renderPlatformProgress('manualPlatformProgress', [
    { label: 'TikTok', status: 'running', message: '<img src=x onerror=alert(1)>', startedAt: 1000 },
    { label: 'YouTube Shorts', status: 'queued', message: 'Chờ tải trên máy', startedAt: 1000, endedAt: 3500 }
  ]);
  assert.equal(container.hidden, false);
  assert.equal(container.children[0].children[0].textContent, 'TikTok');
  assert.equal(container.children[0].children[2].textContent, '<img src=x onerror=alert(1)>');
  const timers = document.querySelectorAll();
  assert.deepEqual(timers.map(timer => timer.textContent), ['00:04', '00:02']);
  currentTime = 7000;
  context.updatePlatformTimers();
  assert.deepEqual(timers.map(timer => timer.textContent), ['00:06', '00:02']);
  context.renderPlatformProgress('manualPlatformProgress', []);
  assert.equal(container.hidden, true);
  assert.equal(container.children.length, 0);
});
