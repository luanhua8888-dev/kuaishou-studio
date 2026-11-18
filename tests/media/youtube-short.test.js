import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { youtubeHook, youtubeSlideshowTiming, youtubeOpeningTiming, youtubeSceneTransition, addYouTubeHook } from '../../src/media/youtube-short.js';

test('slow replay alternates animated reveals with dissolves without zoom', () => {
  const transitions = Array.from({ length: 12 }, (_, i) => youtubeSceneTransition(i + 1));
  assert.deepEqual(transitions.slice(0, 6), ['smoothleft', 'fade', 'wipeup', 'smoothright', 'fade', 'wipedown']);
  assert.deepEqual(transitions.slice(0, 6), transitions.slice(6));
  assert.ok(transitions.every(name => !/zoom|flash/.test(name)));
});

test('opening previews every photo at frame-aligned rapid pacing before slow replay', () => {
  for (const count of [2, 5, 10, 30, 45]) {
    const opening = youtubeOpeningTiming(count);
    assert.ok(opening.framesPerImage >= 3 && opening.framesPerImage <= 9);
    assert.equal(opening.totalDuration, count * opening.imageDuration);
  }
  assert.equal(youtubeOpeningTiming(30).totalDuration, 3);
  assert.equal(youtubeOpeningTiming(1).totalDuration, 0);
});

test('YouTube slideshow uses bounded pacing independent of music duration', () => {
  for (let count = 1; count <= 30; count++) {
    const plan = youtubeSlideshowTiming(count);
    assert.ok(plan.totalDuration >= 6 && plan.totalDuration <= 108);
    assert.ok(Math.abs(count * plan.slideDuration - (count - 1) * plan.transitionDuration - plan.totalDuration) < 0.001);
    if (count > 1) assert.ok(plan.slideDuration >= 3 && plan.slideDuration <= 4.1);
  }
  for (const count of [0, -1, 2.5, NaN]) assert.throws(() => youtubeSlideshowTiming(count));
});

test('hook uses existing caption rather than inventing claims, without hashtags or control characters', () => {
  assert.equal(youtubeHook('A quiet night\nAnother thought #night'), 'A quiet night');
  assert.equal(youtubeHook('#nature\nA peaceful walk'), 'A peaceful walk');
  assert.equal(youtubeHook(''), '');
  assert.equal(youtubeHook('x'.repeat(90)), '');
  const result = youtubeHook('A quiet walk through the forest as the evening light falls softly on the trees');
  assert.ok(result.length <= 56);
  assert.ok(result.endsWith('…'));
  assert.equal(youtubeHook('Quiet\u0000 moment'), 'Quiet moment');
});

test('hook render keeps audio, is safe for literal text and removes temporary files', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-hook-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.mp4');
  const output = path.join(dir, 'hook.mp4');
  const font = path.join(dir, 'font.ttf');
  fs.writeFileSync(source, 'source');
  fs.writeFileSync(font, 'font');
  let calls = 0;
  const runImpl = async (command, args) => {
    calls++;
    assert.equal(command, 'ffmpeg');
    assert.ok(args.includes('0:a?'));
    assert.ok(args.includes('copy'));
    const vf = args[args.indexOf('-vf') + 1];
    assert.match(vf, /expansion=none/);
    assert.match(vf, /lt\(t,3\)/);
    assert.doesNotMatch(vf, /%\{n\}/);
    const temp = fs.readdirSync(dir).find(name => name.startsWith('.youtube-hook-'));
    assert.match(fs.readFileSync(path.join(dir, temp, 'hook.txt'), 'utf8'), /%\{n\}/);
    fs.writeFileSync(output, 'rendered');
  };
  const caption = "It's quiet: %{n} ' & calm";
  assert.equal(await addYouTubeHook(source, output, caption, { runImpl, fontPath: font }), output);
  await addYouTubeHook(source, output, caption, { runImpl, fontPath: font });
  assert.equal(calls, 1, 'unchanged render is cached');
  assert.equal(fs.readdirSync(dir).some(name => name.startsWith('.youtube-hook-')), false);
  assert.equal(await addYouTubeHook(source, output, '', { runImpl, fontPath: font }), source);
});

test('render failures clean up without returning a successful video', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-hook-error-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.mp4');
  const font = path.join(dir, 'font.ttf');
  fs.writeFileSync(source, 'source');
  fs.writeFileSync(font, 'font');
  await assert.rejects(addYouTubeHook(source, path.join(dir, 'out.mp4'), 'Quiet evening', {
    fontPath: font, runImpl: async () => { throw new Error('render failed'); }
  }), /render failed/);
  assert.equal(fs.readdirSync(dir).some(name => name.startsWith('.youtube-hook-')), false);
});
