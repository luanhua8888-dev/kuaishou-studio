import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, ARTIFACTS_DIR } from '../../src/paths.js';
import { buildYouTubeMetadata } from '../../src/platforms/youtube/metadata.js';
import { renderCinematicReel as renderer } from '../../src/media/cinematic-reel.js';

// Run the server's exact clean renderer without starting a server or publishing.
const source = path.resolve(process.argv[2] || path.join(PROJECT_ROOT, 'downloads/_5257389825749861684'));
const images = fs.readdirSync(source).filter(name => /^image_.*\.jpg$/i.test(name)).sort().map(name => path.join(source, name));
const audio = path.join(source, 'audio.m4a');
if (!images.length || !fs.existsSync(audio)) throw new Error('Sample requires images and source audio');
const destination = path.join(ARTIFACTS_DIR, 'youtube-source-sample');
fs.mkdirSync(destination, { recursive: true });

const output = path.join(destination, 'youtube-preview.mp4');
const frames = path.join(destination, 'frames');
try {
  await renderer(images, audio, output, '', frames, true);
} finally {
  // These frames are reproducible; keep only the finished preview and metadata.
  const resolvedFrames = path.resolve(frames);
  if (path.dirname(resolvedFrames) !== path.resolve(destination) || path.basename(resolvedFrames) !== 'frames') {
    throw new Error('Unsafe sample frame cleanup path');
  }
  fs.rmSync(resolvedFrames, { recursive: true, force: true });
}
const metadata = buildYouTubeMetadata('Even a busy city has quiet moments. #QuietMoments #CityLife #SlowLiving', {
  description: 'A few quiet moments among city streets, buildings, and passing trains. Preview assembled from existing source photos and audio; usage rights have not been verified.', language: 'en'
});
fs.writeFileSync(path.join(destination, 'metadata.txt'), `Title: ${metadata.youtubeTitle}\n\nDescription: ${metadata.youtubeDescription}\n`, 'utf8');
console.log(`Preview only, not published: ${output}`);
