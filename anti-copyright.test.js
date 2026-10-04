import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sanitizeVideoAudioForCopyright } from './anti-copyright.js';

const root = path.dirname(fileURLToPath(import.meta.url));

test('sanitizeVideoAudioForCopyright creates safe video with pitch shifted audio', async () => {
  const testInput = path.join(root, 'test_anti_copy_input.mp4');
  const expectedSafe = path.join(root, 'test_anti_copy_input_safe.mp4');

  try {
    // Generate 1-second sample video with audio
    execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=1:size=320x240:rate=30" -f lavfi -i "sine=frequency=500:duration=1" -c:v libx264 -c:a aac "${testInput}"`, { stdio: 'pipe' });

    assert.ok(fs.existsSync(testInput), 'Input video should exist');

    const resultPath = await sanitizeVideoAudioForCopyright(testInput);
    assert.equal(resultPath, expectedSafe, 'Should return path to safe video');
    assert.ok(fs.existsSync(resultPath), 'Safe video file must exist on disk');

    // Calling it again should return existing safe path
    const secondCall = await sanitizeVideoAudioForCopyright(testInput);
    assert.equal(secondCall, expectedSafe);
  } finally {
    if (fs.existsSync(testInput)) fs.unlinkSync(testInput);
    if (fs.existsSync(expectedSafe)) fs.unlinkSync(expectedSafe);
  }
});

test('sanitizeVideoAudioForCopyright handles video without audio gracefully', async () => {
  const testNoAudio = path.join(root, 'test_no_audio.mp4');

  try {
    execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=1:size=320x240:rate=30" -an -c:v libx264 "${testNoAudio}"`, { stdio: 'pipe' });
    const resultPath = await sanitizeVideoAudioForCopyright(testNoAudio);
    assert.equal(resultPath, testNoAudio, 'Should return original path if video has no audio');
  } finally {
    if (fs.existsSync(testNoAudio)) fs.unlinkSync(testNoAudio);
  }
});
