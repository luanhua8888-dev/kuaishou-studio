import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sanitizeVideoAudioForCopyright } from '../../src/media/anti-copyright.js';

const root = path.dirname(fileURLToPath(import.meta.url));

// These tests render real media, so they need FFmpeg on PATH.
let hasFfmpeg = true;
try { execSync('ffmpeg -version', { stdio: 'ignore' }); } catch { hasFfmpeg = false; }
const ffmpegTest = (name, fn) => test(name, { skip: !hasFfmpeg && 'ffmpeg not found on PATH' }, fn);

ffmpegTest('source audio is removed and video retained without modifying the source', async () => {
  const testInput = path.join(root, 'test_anti_copy_input.mp4');
  const outputs = [];

  try {
    // Generate 1-second sample video with audio
    execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=1:size=320x240:rate=30" -f lavfi -i "sine=frequency=500:duration=1" -c:v libx264 -c:a aac "${testInput}"`, { stdio: 'pipe' });

    assert.ok(fs.existsSync(testInput), 'Input video should exist');

    const resultPath = await sanitizeVideoAudioForCopyright(testInput);
    outputs.push(resultPath);
    assert.match(resultPath, /_no_source_audio_/);
    assert.ok(fs.existsSync(resultPath), 'Safe video file must exist on disk');

    const streams = file => JSON.parse(execSync(`ffprobe -v error -show_entries stream=codec_type -of json "${file}"`, { encoding: 'utf8' })).streams;
    assert.equal(streams(resultPath).some(s => s.codec_type === 'audio'), false);
    assert.equal(streams(resultPath).some(s => s.codec_type === 'video'), true);
    assert.equal(streams(testInput).some(s => s.codec_type === 'audio'), true);
    // A verified silent file needs no further processing.
    assert.equal(await sanitizeVideoAudioForCopyright(resultPath), resultPath);
    const secondCall = await sanitizeVideoAudioForCopyright(testInput);
    outputs.push(secondCall);
    assert.equal(streams(secondCall).some(s => s.codec_type === 'audio'), false);
  } finally {
    if (fs.existsSync(testInput)) fs.unlinkSync(testInput);
    for (const output of outputs) fs.rmSync(output, { force: true });
  }
});

ffmpegTest('sanitizeVideoAudioForCopyright handles video without audio gracefully', async () => {
  const testNoAudio = path.join(root, 'test_no_audio.mp4');

  try {
    execSync(`ffmpeg -y -f lavfi -i "testsrc=duration=1:size=320x240:rate=30" -an -c:v libx264 "${testNoAudio}"`, { stdio: 'pipe' });
    const resultPath = await sanitizeVideoAudioForCopyright(testNoAudio);
    assert.equal(resultPath, testNoAudio, 'Should return original path if video has no audio');
  } finally {
    if (fs.existsSync(testNoAudio)) fs.unlinkSync(testNoAudio);
  }
});
