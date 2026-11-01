import assert from 'node:assert/strict';

const base = process.argv[2] || 'http://127.0.0.1:3001';
const status = await fetch(`${base}/api/threads/status`);
assert.equal(status.status, 200, 'Threads API missing: the running server must be updated.');
const session = await status.json();
assert.equal(session.success, true);
assert.equal(session.loggedIn, true, 'Threads login session is missing or expired.');
console.log('PASS: Threads API HTTP 200 and saved login recognized');

const post = await fetch(`${base}/api/threads/post`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post: null })
});
assert.equal(post.status, 400);
const rejected = await post.json();
assert.equal(rejected.success, false);
assert.ok(rejected.error);
console.log('PASS: Posting route validates input; no content published');

const queue = await fetch(`${base}/api/sheet-queue`).then(response => response.json());
if (queue.threadsOnly) {
  assert.equal(queue.enabled, false);
  assert.equal(queue.running, false);
  assert.equal(queue.options.autoPostThreads, true);
  assert.equal(queue.options.autoPostIG, false);
  const mutation = await fetch(`${base}/api/sheet-queue`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"enabled":true}'
  });
  assert.equal(mutation.status, 409);
  console.log('PASS: Secondary Threads instance cannot start a duplicate queue');
}
const ui = await fetch(base).then(response => response.text());
assert.ok(ui.includes('threadsStatusBtn') && ui.includes('btnManualPostThreads'));
console.log('PASS: Updated Threads UI is served');
