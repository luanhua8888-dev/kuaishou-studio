import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareThreadsCaption, hasThreadsSession } from './threads_poster.js';

test('Threads rejects long captions and preserves emoji while removing mentions', () => {
  assert.equal(prepareThreadsCaption('Cảnh đẹp 🌿 @creator'), 'Cảnh đẹp 🌿');
  assert.equal(prepareThreadsCaption('Cảnh đẹp @creator #nature #landscape'), 'Cảnh đẹp #nature #landscape');
  assert.equal(prepareThreadsCaption('🌿'.repeat(500)).length, 1000);
  assert.throws(() => prepareThreadsCaption('x'.repeat(501)), /500/);
});

test('Instagram cookies and expired Threads cookies do not count as a Threads session', () => {
  const cookie = { name: 'sessionid', domain: '.threads.com', expires: 2000 };
  assert.equal(hasThreadsSession({ cookies: [cookie] }, 1000), true);
  assert.equal(hasThreadsSession({ cookies: [{ ...cookie, domain: '.instagram.com' }] }, 1000), false);
  assert.equal(hasThreadsSession({ cookies: [cookie] }, 3000000), false);
});
