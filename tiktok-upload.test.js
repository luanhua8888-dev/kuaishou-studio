import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForTikTokUpload } from './tiktok-upload.js';

function mockPage({ readyAfter = Infinity, error = false, url = 'https://www.tiktok.com/tiktokstudio/upload' } = {}) {
  const state = { waits: 0, reloads: 0, clicks: 0 };
  const input = { count: async () => state.waits >= readyAfter ? 1 : 0 };
  const button = { isVisible: async () => error && state.clicks === 0, click: async () => { state.clicks++; } };
  const page = {
    url: () => url,
    frames: () => [{ locator: () => ({ first: () => input }) }],
    getByRole: () => ({ first: () => button }),
    waitForTimeout: async () => { state.waits++; },
    reload: async () => { state.reloads++; },
  };
  return { page, state, input };
}

test('detects an upload input in a frame that loads late', async () => {
  const { page, state, input } = mockPage({ readyAfter: 2 });
  assert.equal(await waitForTikTokUpload(page), input);
  assert.equal(state.reloads, 0);
});

test('recovers from the TikTok retry screen before selecting a file', async () => {
  const { page, state, input } = mockPage({ error: true, readyAfter: 1 });
  assert.equal(await waitForTikTokUpload(page), input);
  assert.equal(state.clicks, 1);
});

test('stops after bounded retries when the input never appears', async () => {
  const { page, state } = mockPage();
  await assert.rejects(waitForTikTokUpload(page, { polls: 2 }), /Video chưa được tải lên/);
  assert.equal(state.reloads, 2);
});

test('reports an expired session without retrying', async () => {
  const { page, state } = mockPage({ url: 'https://www.tiktok.com/login?redirect=upload' });
  await assert.rejects(waitForTikTokUpload(page), /đăng nhập/);
  assert.equal(state.reloads, 0);
});
