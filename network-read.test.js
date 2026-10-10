import test from 'node:test';
import assert from 'node:assert/strict';
import { networkRead, mapLimit } from './network-read.js';

test('retries an interrupted body and returns only the completed read', async () => {
  let calls = 0;
  const result = await networkRead('https://example.com/media', { retryDelayMs: 0, fetchImpl: async (_, options) => {
    assert.ok(options.signal);
    calls++;
    return { ok: true, text: async () => { if (calls === 1) throw new Error('socket closed'); return 'complete'; } };
  } });
  assert.equal(result.data, 'complete');
  assert.equal(calls, 2);
});

test('does not retry a missing file, but retries a temporary server error', async () => {
  for (const [status, expected] of [[404, 1], [503, 2]]) {
    let calls = 0;
    await assert.rejects(networkRead('https://example.com/media', { retryDelayMs: 0, fetchImpl: async () => {
      calls++; return { ok: false, status };
    } }), error => error.code === 'NETWORK_READ_FAILED' && error.message.includes(`HTTP ${status}`));
    assert.equal(calls, expected);
  }
});

test('bounds a hung request and reports the host', async () => {
  await assert.rejects(networkRead('https://example.com/media', { attempts: 1, timeoutMs: 10,
    fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    }),
  }), /example.com.*timeout/i);
});

test('downloads concurrently with a limit and keeps image order', async () => {
  let active = 0, peak = 0;
  const result = await mapLimit([0, 1, 2, 3, 4], 3, async value => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5 * (5 - value)));
    active--; return `image-${value}`;
  });
  assert.equal(peak, 3);
  assert.deepEqual(result, ['image-0', 'image-1', 'image-2', 'image-3', 'image-4']);
});

test('waits for other active downloads before reporting a failure', async () => {
  let finished = false;
  await assert.rejects(mapLimit([0, 1], 2, async value => {
    if (!value) throw new Error('failed');
    await new Promise(resolve => setTimeout(resolve, 20)); finished = true;
  }), /failed/);
  assert.equal(finished, true);
});
