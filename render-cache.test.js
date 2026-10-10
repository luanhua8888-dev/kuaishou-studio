import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderWithCache } from './render-cache.js';

test('reuses a completed render and invalidates changed caption, source, or output', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'image.jpg'), output = path.join(dir, 'reel.mp4');
  fs.writeFileSync(input, 'source');
  let calls = 0;
  const render = async () => { calls++; fs.writeFileSync(output, 'video'); };
  await renderWithCache(output, [input], { quote: 'a' }, render);
  await renderWithCache(output, [input], { quote: 'a' }, render);
  assert.equal(calls, 1);
  await renderWithCache(output, [input], { quote: 'b' }, render);
  assert.equal(calls, 2);
  fs.writeFileSync(input, 'changed source');
  await renderWithCache(output, [input], { quote: 'b' }, render);
  assert.equal(calls, 3);
  fs.writeFileSync(output, '');
  await renderWithCache(output, [input], { quote: 'b' }, render);
  assert.equal(calls, 4);
  await assert.rejects(renderWithCache(output, [input], { quote: 'c' }, async () => { throw new Error('encode failed'); }), /encode failed/);
  assert.equal(fs.existsSync(`${output}.render.json`), false);
});
