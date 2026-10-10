import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { requestPipeline } from './pipeline-request.js';

test('waits for a delayed local result and preserves partial platform results', async t => {
  let received;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received = JSON.parse(body);
      setTimeout(() => res.end(JSON.stringify({ success: false, partialFailure: true, igPosted: true, error: 'TikTok' })), 50);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await requestPipeline(server.address().port, { url: 'https://example.com', customCaption: 'Bình yên 🌿' });
  assert.equal(result.igPosted, true);
  assert.equal(result.partialFailure, true);
  assert.equal(received.customCaption, 'Bình yên 🌿');
});

test('reports a local pipeline error without replaying the request', async t => {
  let calls = 0;
  const server = http.createServer((req, res) => { calls++; res.writeHead(500); res.end(JSON.stringify({ error: 'Không tải được CDN' })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(requestPipeline(server.address().port, {}), /Không tải được CDN/);
  assert.equal(calls, 1);
});
