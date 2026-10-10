import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForInstagramUpload, UPLOAD_INPUT_UNAVAILABLE } from './instagram-upload.js';

test('missing Instagram upload input becomes a skippable timeout', async () => {
  const error = new Error('locator.waitFor: Timeout 20000ms exceeded');
  error.name = 'TimeoutError';
  await assert.rejects(waitForInstagramUpload({ waitFor: async () => { throw error; } }),
    { code: UPLOAD_INPUT_UNAVAILABLE });
});

test('browser failures are not treated as a missing upload input', async () => {
  const error = new Error('Target page has been closed');
  await assert.rejects(waitForInstagramUpload({ waitFor: async () => { throw error; } }), error);
});
