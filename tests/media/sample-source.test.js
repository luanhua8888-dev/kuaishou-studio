import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSampleSource, sampleImages } from '../../scripts/cli/sample-source.mjs';

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-source-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('missing downloads gives an actionable command', t => {
  const directory = workspace(t);
  assert.throws(() => resolveSampleSource(undefined, path.join(directory, 'missing')), /npm run render:tiktok --/);
});

test('chooses newest directory containing supported images, ignoring empty downloads', t => {
  const directory = workspace(t);
  for (const name of ['old', 'new', 'empty']) fs.mkdirSync(path.join(directory, name));
  fs.writeFileSync(path.join(directory, 'old', 'image_1.jpg'), '');
  fs.writeFileSync(path.join(directory, 'new', 'image_1.webp'), '');
  fs.utimesSync(path.join(directory, 'old'), new Date(1000), new Date(1000));
  fs.utimesSync(path.join(directory, 'new'), new Date(2000), new Date(2000));
  assert.equal(resolveSampleSource(undefined, directory), path.join(directory, 'new'));
});

test('explicit source is respected and only image files are selected in order', t => {
  const directory = workspace(t);
  fs.writeFileSync(path.join(directory, 'image_2.PNG'), '');
  fs.writeFileSync(path.join(directory, 'image_1.jpeg'), '');
  fs.writeFileSync(path.join(directory, 'other.jpg'), '');
  fs.mkdirSync(path.join(directory, 'image_fake.jpg'));
  assert.equal(resolveSampleSource(directory, path.join(directory, 'missing')), directory);
  assert.deepEqual(sampleImages(directory), ['image_1.jpeg', 'image_2.PNG']);
});

test('explicit missing, non-directory and empty sources fail without falling back', t => {
  const directory = workspace(t);
  const file = path.join(directory, 'file');
  fs.writeFileSync(file, '');
  assert.throws(() => resolveSampleSource(file, directory), /Thư mục ảnh không tồn tại/);
  assert.throws(() => resolveSampleSource(path.join(directory, 'missing'), directory), /Thư mục ảnh không tồn tại/);
  assert.throws(() => resolveSampleSource(directory, directory), /Không có ảnh image_/);
  assert.throws(() => resolveSampleSource(undefined, directory), /npm run render:tiktok --/);
});
