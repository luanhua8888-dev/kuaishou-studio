import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThreadsCaption, threadsTopic } from './threads-caption.js';

test('Threads keeps relevant hashtags, removes mentions and invites a relevant response', () => {
  const text = buildThreadsCaption('A peaceful forest @creator\n\n#nature #landscape');
  assert.equal((text.match(/#[\p{L}\p{N}_]+/gu) || []).length, 5);
  assert.ok(text.includes('#nature #landscape'));
  assert.match(text, /Who would you share/);
  assert.ok(!text.includes('@'));
  assert.equal(threadsTopic(text), 'nature');
});

test('long captions are shortened without losing hashtags or breaking Unicode', () => {
  const text = buildThreadsCaption('🌿'.repeat(490) + '\n#nature #landscape');
  assert.ok([...text].length <= 500);
  assert.equal((text.match(/#[\p{L}\p{N}_]+/gu) || []).length, 5);
  assert.ok(text.includes('#nature #landscape'));
  assert.ok(!text.includes('\uFFFD'));
});

test('custom text keeps its body and unknown content gets five broad tags', () => {
  const custom = buildThreadsCaption('My own caption #music', 'en', { prompt: false });
  assert.ok(custom.startsWith('My own caption\n\n#music'));
  assert.ok(!custom.includes('?'));
  const unknown = buildThreadsCaption('Một khoảnh khắc', 'vi');
  assert.equal((unknown.match(/#[\p{L}\p{N}_]+/gu) || []).length, 5);
  assert.ok(!unknown.includes('#meo'));
  const text = buildThreadsCaption('Bài hát nào hợp với cảnh này? #amnhac', 'vi');
  assert.equal((text.match(/\?/g) || []).length, 1);
});

test('five long supplied hashtags still fit the Threads character budget', () => {
  const tags = Array.from({ length: 5 }, (_, index) => '#' + String(index) + 'a'.repeat(62)).join(' ');
  const text = buildThreadsCaption('🌿'.repeat(500) + '\n' + tags);
  assert.ok([...text].length <= 500);
  assert.equal((text.match(/#[\p{L}\p{N}_]+/gu) || []).length, 5);
});
