import test from 'node:test';
import assert from 'node:assert/strict';
import { getPostPage, findPhotoData } from './kuaishou-page.js';

test('falls back to mobile post page when the share link resolves to an empty desktop shell', async () => {
  const calls = [];
  const desktopUrl = 'https://www.kuaishou.com/short-video/abc123?photoId=abc123';
  const fetchImpl = async url => {
    calls.push(url);
    return {
      ok: true,
      url: calls.length === 1 ? desktopUrl : url,
      text: async () => calls.length === 1
        ? '<html><title>短视频-快手</title></html>'
        : '<script>window.INIT_STATE = {"post":{"photo":{"photoId":"abc123"}}}</script>'
    };
  };

  const page = await getPostPage('https://v.kuaishou.com/share', fetchImpl);
  assert.deepEqual(calls, [
    'https://v.kuaishou.com/share',
    'https://m.kuaishou.com/fw/photo/abc123'
  ]);
  assert.equal(findPhotoData(page.initState).photo.photoId, 'abc123');
});

test('uses the first response when it contains post data', async () => {
  let calls = 0;
  const page = await getPostPage('https://v.kuaishou.com/share', async url => {
    calls++;
    return {
      ok: true,
      url,
      text: async () => '<script>window.INIT_STATE = {"post":{"photo":{"photoId":"abc123"}}};</script>'
    };
  });
  assert.equal(calls, 1);
  assert.equal(findPhotoData(page.initState).photo.photoId, 'abc123');
});
