import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SAMPLE_RATE = 11025;
const HOP_SECONDS = 0.02;

// Decode the first minutes of a track to mono PCM so the beat analysis needs no extra dependency.
async function decodeMono(audioPath, maxSeconds = 180) {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-t', String(maxSeconds), '-i', audioPath,
    '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  const samples = new Float32Array(Math.floor(stdout.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = stdout.readInt16LE(i * 2) / 32768;
  return samples;
}

/** RMS loudness per hop (20 ms by default). */
export function energyEnvelope(samples, sampleRate = SAMPLE_RATE, hopSeconds = HOP_SECONDS) {
  const hop = Math.max(1, Math.round(sampleRate * hopSeconds));
  const envelope = new Float32Array(Math.floor(samples.length / hop));
  for (let frame = 0; frame < envelope.length; frame++) {
    let sum = 0;
    for (let i = frame * hop; i < (frame + 1) * hop; i++) sum += samples[i] * samples[i];
    envelope[frame] = Math.sqrt(sum / hop);
  }
  return envelope;
}

/**
 * Onsets (drum hits, chord changes) in seconds: peaks of the positive loudness change
 * that rise clearly above the local average, at least `minGap` apart.
 */
export function detectOnsets(envelope, hopSeconds = HOP_SECONDS, { minGap = 0.25, sensitivity = 1.5 } = {}) {
  const flux = new Float32Array(envelope.length);
  for (let i = 1; i < envelope.length; i++) flux[i] = Math.max(0, envelope[i] - envelope[i - 1]);
  const radius = Math.max(1, Math.round(0.5 / hopSeconds));
  // Ignore ripples of a steady sound: a hit must reach a share of the strongest hit in the track.
  let strongest = 0;
  for (const value of flux) if (value > strongest) strongest = value;
  const floor = strongest * 0.1;
  const onsets = [];
  let lastFrame = -Infinity;
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] <= flux[i - 1] || flux[i] < flux[i + 1] || flux[i] <= floor) continue;
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(flux.length - 1, i + radius); j++) { sum += flux[j]; count++; }
    if (flux[i] < (sum / count) * sensitivity + 1e-4) continue;
    if ((i - lastFrame) * hopSeconds < minGap) continue;
    onsets.push(+(i * hopSeconds).toFixed(3));
    lastFrame = i;
  }
  return onsets;
}

/**
 * Start of the loudest `windowSeconds` stretch (usually the chorus/drop), moved back to the onset
 * just before it so the music enters on a hit. Returns 0 when the track is shorter than the window.
 */
export function findHighlightStart(envelope, hopSeconds = HOP_SECONDS, windowSeconds = 14, onsets = []) {
  const window = Math.round(windowSeconds / hopSeconds);
  if (envelope.length <= window) return 0;
  // Never start in the last part of the track: leave room for the whole video.
  let sum = 0;
  for (let i = 0; i < window; i++) sum += envelope[i];
  let best = sum, bestStart = 0;
  for (let start = 1; start + window <= envelope.length; start++) {
    sum += envelope[start + window - 1] - envelope[start - 1];
    if (sum > best * 1.0001) { best = sum; bestStart = start; }
  }
  const seconds = bestStart * hopSeconds;
  const entry = [...onsets].reverse().find(time => time <= seconds + 0.05 && time >= seconds - 1.5);
  return +Math.max(0, entry ?? seconds).toFixed(3);
}

/**
 * Onsets relative to the music start, for a video of `videoSeconds`.
 * Without a fixed `start`, the music starts at its highlight.
 */
export async function analyzeAudio(audioPath, videoSeconds, { start: fixedStart } = {}) {
  const envelope = energyEnvelope(await decodeMono(audioPath));
  const onsets = detectOnsets(envelope);
  const duration = envelope.length * HOP_SECONDS;
  const start = typeof fixedStart === 'number' ? fixedStart : findHighlightStart(envelope, HOP_SECONDS, videoSeconds, onsets);
  return {
    duration,
    start,
    onsets: onsets.map(time => +(time - start).toFixed(3)).filter(time => time > 0 && time < videoSeconds),
  };
}

/**
 * Move each cut onto the nearest onset within `maxShift` seconds, keeping the total length,
 * the dissolve length and a minimum readable scene length. Cuts with no nearby onset stay put.
 * A cut happens at the middle of its dissolve (scene.start + transition / 2).
 */
export function snapScenesToBeats(plan, onsets, fps = 30, { maxShift = 0.6 } = {}) {
  if (!onsets?.length || plan.scenes.length < 2) return plan;
  const T = plan.transitionFrames;
  const minFrames = 2 * T + Math.round(0.8 * fps);
  const starts = plan.scenes.map(scene => scene.start);
  for (let i = 1; i < starts.length; i++) {
    const cut = (starts[i] + T / 2) / fps;
    const nearest = onsets.reduce((best, time) => Math.abs(time - cut) < Math.abs(best - cut) ? time : best, Infinity);
    if (Math.abs(nearest - cut) > maxShift) continue;
    const start = Math.round(nearest * fps - T / 2);
    const previousLength = start - starts[i - 1] + T;
    const nextEnd = i + 1 < starts.length ? starts[i + 1] + T : plan.totalFrames;
    if (previousLength >= minFrames && nextEnd - start >= minFrames) starts[i] = start;
  }
  const scenes = starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] + T : plan.totalFrames;
    return { index, start, end, frames: end - start };
  });
  return { ...plan, scenes, beatSynced: scenes.some((scene, i) => scene.start !== plan.scenes[i].start) };
}
