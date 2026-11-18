import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareYouTubeShortVideo } from '../../src/platforms/youtube/video.js';

test('reframes horizontal or long videos into 1080x1920 vertical Shorts capped at maxSeconds without text', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-video-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const horizontal = path.join(dir, 'landscape.mp4');
  const out = path.join(dir, 'youtube_short.mp4');
  fs.writeFileSync(horizontal, 'source');

  const calls = [];
  const runImpl = async (bin, args) => {
    calls.push([bin, args]);
    if (bin === 'ffprobe') {
      return {
        stdout: JSON.stringify({
          streams: [{ codec_type: 'video', width: 1920, height: 1080 }, { codec_type: 'audio' }],
          format: { duration: '112.4' }
        })
      };
    }
    fs.writeFileSync(out, 'encoded');
    return { stdout: '' };
  };

  const result = await prepareYouTubeShortVideo(horizontal, out, {
    maxSeconds: 24,
    highlightStart: async () => 105, // near end: must clamp to 112.4 - 24 = 88.4
    runImpl
  });

  assert.equal(result, out);
  const ffmpegCall = calls.find(([bin]) => bin === 'ffmpeg');
  assert.ok(ffmpegCall, 'ffmpeg should run to reframe/trim');
  const args = ffmpegCall[1].join(' ');
  assert.match(args, /-ss 88\.4/);
  assert.match(args, /-t 24/);
  assert.match(args, /1080:1920/);
  assert.match(args, /setsar=1/);
  assert.doesNotMatch(args, /drawtext/);
});

test('passes through already-vertical short video including 90-degree rotated phone footage', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-video-pass-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rotated = path.join(dir, 'phone_vertical.mp4');
  const out = path.join(dir, 'youtube_short.mp4');
  fs.writeFileSync(rotated, 'source');

  const calls = [];
  const result = await prepareYouTubeShortVideo(rotated, out, {
    maxSeconds: 24,
    runImpl: async (bin, args) => {
      calls.push([bin, args]);
      return {
        stdout: JSON.stringify({
          streams: [{ codec_type: 'video', width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }, { codec_type: 'audio' }],
          format: { duration: '18.2' }
        })
      };
    }
  });

  assert.equal(result, rotated);
  assert.equal(calls.length, 1);
});

test('handles silent horizontal video without crashing on audio filter', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-video-silent-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const silent = path.join(dir, 'silent.mp4');
  const out = path.join(dir, 'youtube_short.mp4');
  fs.writeFileSync(silent, 'source');

  let ffmpegArgs = [];
  await prepareYouTubeShortVideo(silent, out, {
    maxSeconds: 24,
    runImpl: async (bin, args) => {
      if (bin === 'ffprobe') {
        return { stdout: JSON.stringify({ streams: [{ codec_type: 'video', width: 1280, height: 720 }], format: { duration: '15' } }) };
      }
      ffmpegArgs = args;
      fs.writeFileSync(out, 'encoded');
      return { stdout: '' };
    }
  });

  assert.ok(!ffmpegArgs.includes('-af'), 'must not apply -af when source has no audio stream');
  assert.ok(ffmpegArgs.includes('-an'));
});
