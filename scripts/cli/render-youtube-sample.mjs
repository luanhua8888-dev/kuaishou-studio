import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { PROJECT_ROOT, ARTIFACTS_DIR } from '../../src/paths.js';
import { buildYouTubeMetadata } from '../../src/platforms/youtube/metadata.js';

// Run the server's exact clean renderer without starting a server or publishing.
const source = path.resolve(process.argv[2] || path.join(PROJECT_ROOT, 'downloads/_5257389825749861684'));
const server = fs.readFileSync(path.join(PROJECT_ROOT, 'src/server.js'), 'utf8');
const start = server.indexOf('async function renderCinematicReel(');
const end = server.indexOf('\nfunction extractUrl(', start);
if (start < 0 || end < 0) throw new Error('Clean renderer not found');
const renderer = new Function('fs', 'path', 'execPromise', 'getImageDimensions',
  `${server.slice(start, end)}; return renderCinematicReel;`)(fs, path, promisify(exec), () => null);
const images = fs.readdirSync(source).filter(name => /^image_.*\.jpg$/i.test(name)).sort().slice(0, 3).map(name => path.join(source, name));
const audio = path.join(source, 'audio.m4a');
if (!images.length || !fs.existsSync(audio)) throw new Error('Sample requires images and source audio');
const destination = path.join(ARTIFACTS_DIR, 'youtube-sample');
fs.mkdirSync(destination, { recursive: true });
const output = path.join(destination, 'youtube-preview.mp4');
const frames = path.join(destination, 'frames');
await renderer(images, audio, output, '', frames);
const metadata = buildYouTubeMetadata('Sometimes goodbye teaches us what matters #LifeLessons #LettingGo #Shorts', {
  description: 'A quiet reflection on late apologies, letting go, and learning to appreciate the people in our lives.', language: 'en'
});
fs.writeFileSync(path.join(destination, 'metadata.txt'), `Title: ${metadata.youtubeTitle}\n\nDescription: ${metadata.youtubeDescription}\n`, 'utf8');
console.log(`Preview only, not published: ${output}`);
