import { setTimeout as delay } from 'node:timers/promises';

// Retry reads, including interrupted response bodies. Never replay publishing.
export async function networkRead(url, { headers, timeoutMs = 30000, attempts = 2, format = 'text', fetchImpl = fetch, retryDelayMs = 500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const error = new Error(`HTTP ${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const data = format === 'buffer' ? Buffer.from(await response.arrayBuffer()) : await response.text();
      return { data, url: response.url, contentType: response.headers?.get('content-type') || '' };
    } catch (error) {
      if (error.retryable === false || attempt + 1 === attempts) {
        const wrapped = new Error(`Không tải được ${new URL(url).hostname}: ${error.cause?.code || error.message}`, { cause: error });
        wrapped.code = 'NETWORK_READ_FAILED';
        throw wrapped;
      }
      await delay(retryDelayMs);
    }
  }
}

export async function mapLimit(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  });
  const settled = await Promise.allSettled(workers);
  const failure = settled.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}
