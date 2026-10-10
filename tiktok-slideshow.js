import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { renderWithCache } from './render-cache.js';

const run = promisify(execFile);
const FPS = 30;
const VERSION = 2;
const DEFAULT_STORY = [
  'Nếu được đi trốn một ngày, mình muốn đến đây.',
  'Giữa thiên nhiên, mọi thứ như chậm lại…',
  'Chắc mình sẽ thôi nhìn điện thoại một lúc.',
  'Còn bạn, nơi nào khiến bạn thấy bình yên?',
];
const filterPath = file => path.resolve(file).replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "'\\''");
const number = (value, fallback, min, max, name) => {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isFinite(result) || result < min || result > max) {
    throw new Error(`${name} phải là số từ ${min} đến ${max}`);
  }
  return result;
};

export function readTikTokSlideshowConfig(overrides = {}) {
  const file = new URL('./tiktok-slideshow.config.json', import.meta.url);
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return { ...saved, ...overrides, text: { ...saved.text, ...overrides.text }, audio: { ...saved.audio, ...overrides.audio } };
}

export function planSlideshow(imageCount, config = {}) {
  if (!imageCount) throw new Error('Không có ảnh để dựng TikTok');
  const duration = Math.round(number(config.durationSeconds, 14, 2, 120, 'durationSeconds') * FPS) / FPS;
  const sceneSeconds = number(config.secondsPerImage, 2.6, 1, 10, 'secondsPerImage');
  const requested = config.sceneCount ?? Math.ceil(duration / sceneSeconds);
  if (!Number.isInteger(requested) || requested < 1 || requested > 30) throw new Error('sceneCount phải là số nguyên từ 1 đến 30');
  const count = Math.min(imageCount, requested);
  const transitionFrames = count === 1 ? 0 : Math.round(number(config.transitionSeconds, 0.3, 0.1, 0.8, 'transitionSeconds') * FPS);
  const totalFrames = Math.round(duration * FPS);
  // Integer frames keep xfade boundaries exact, including odd durations.
  const budget = totalFrames + (count - 1) * transitionFrames;
  const lengths = Array.from({ length: count }, (_, i) => Math.floor(budget / count) + (i < budget % count ? 1 : 0));
  if (Math.min(...lengths) <= transitionFrames * 2) throw new Error('Thời lượng quá ngắn cho số cảnh/chuyển cảnh này');
  let start = 0;
  const scenes = lengths.map((frames, index) => {
    const scene = { index, frames, start, end: start + frames };
    start += frames - transitionFrames;
    return scene;
  });
  return { duration, totalFrames, transitionFrames, scenes };
}

export function wrapStory(text, width, fontSize, measure) {
  const words = String(text).normalize('NFC').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { text: '', fontSize };
  for (let size = fontSize; size >= 30; size--) {
    const lines = [''];
    let fits = true;
    for (const word of words) {
      if (measure(word, size) > width) { fits = false; break; }
      const last = lines.length - 1;
      const candidate = lines[last] ? `${lines[last]} ${word}` : word;
      if (measure(candidate, size) <= width) lines[last] = candidate;
      else lines.push(word);
    }
    if (fits && lines.length <= 2) {
      if (lines.length === 2) {
        let best = null;
        for (let split = 1; split < words.length; split++) {
          const left = words.slice(0, split).join(' ');
          const right = words.slice(split).join(' ');
          const a = measure(left, size), b = measure(right, size);
          if (a <= width && b <= width && (!best || Math.abs(a - b) < best.cost)) {
            best = { cost: Math.abs(a - b), lines: [left, right] };
          }
        }
        if (best) return { text: best.lines.join('\n'), fontSize: size };
      }
      return { text: lines.join('\n'), fontSize: size };
    }
  }
  throw new Error('Chữ quá dài cho 2 dòng trong vùng an toàn; hãy rút ngắn nội dung cảnh');
}

async function layoutTexts(texts, config) {
  const font = config.fontPath || ['C:/Windows/Fonts/seguisb.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(p => fs.existsSync(p));
  if (!font || !fs.existsSync(font)) throw new Error('Không tìm thấy font; cấu hình text.fontPath với font hỗ trợ tiếng Việt');
  const marginLeft = number(config.marginLeft, 200, 24, 400, 'text.marginLeft');
  const marginRight = number(config.marginRight, 200, 120, 400, 'text.marginRight');
  const marginTop = number(config.marginTop, 180, 100, 600, 'text.marginTop');
  const marginBottom = number(config.marginBottom, 420, 300, 700, 'text.marginBottom');
  const fontSize = number(config.fontSize, 44, 30, 80, 'text.fontSize');
  const position = number(config.positionY, 0.68, 0, 1, 'text.positionY');
  // Centre on the actual video, while respecting the larger of both safe margins.
  const width = 1080 - 2 * Math.max(marginLeft, marginRight) - 40;
  const browser = await chromium.launch({ headless: true });
  let layouts;
  try {
    const page = await browser.newPage();
    const fontData = fs.readFileSync(font).toString('base64');
    const measurements = await page.evaluate(async ({ texts, fontData }) => {
      const face = new FontFace('Slideshow', `url(data:font/ttf;base64,${fontData})`);
      await face.load(); document.fonts.add(face);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = '100px Slideshow';
      return texts.map(text => {
        const words = String(text).normalize('NFC').trim().split(/\s+/).filter(Boolean);
        const widths = {};
        for (let i = 0; i < words.length; i++) for (let j = i + 1; j <= words.length; j++) {
          const line = words.slice(i, j).join(' '); widths[line] = ctx.measureText(line).width / 100;
        }
        return widths;
      });
    }, { texts, fontData });
    layouts = texts.map((text, i) => wrapStory(text, width, fontSize, (line, size) => (measurements[i][line] ?? 0) * size));
  } finally { await browser.close(); }
  return { font, marginLeft, marginRight, marginTop, marginBottom, position, width, layouts };
}

export async function createTikTokSlideshow(imageInput, audioPath, outputPath, overrides = {}) {
  const config = readTikTokSlideshowConfig(overrides);
  const images = imageInput.map(p => path.resolve(p));
  if (images.some(p => !fs.existsSync(p))) throw new Error('Ảnh đầu vào không tồn tại');
  const candidates = config.imageOrder ?? images.map((_, i) => i);
  if (!Array.isArray(candidates) || !candidates.length || new Set(candidates).size !== candidates.length || candidates.some(i => !Number.isInteger(i) || i < 0 || i >= images.length)) {
    throw new Error('imageOrder phải là danh sách chỉ số ảnh hợp lệ, không trùng, đếm từ 0');
  }
  // Explicit hero is an editorial choice. Otherwise prefer resolution as a simple proxy.
  let hero = config.heroImageIndex ?? config.imageOrder?.[0];
  if (hero === undefined) {
    const sizes = await Promise.all(images.map(async file => {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file]);
      const s = JSON.parse(stdout).streams[0]; return s.width * s.height;
    }));
    hero = sizes.indexOf(Math.max(...sizes));
  }
  if (!Number.isInteger(hero) || hero < 0 || hero >= images.length) throw new Error('heroImageIndex nằm ngoài danh sách ảnh (đếm từ 0)');
  if (!candidates.includes(hero)) throw new Error('heroImageIndex phải có trong imageOrder');
  const plan = planSlideshow(candidates.length, config);
  const order = [hero, ...candidates.filter(i => i !== hero)].slice(0, plan.scenes.length);
  const selected = order.map(i => images[i]);
  const story = config.sceneTexts ?? DEFAULT_STORY;
  if (!Array.isArray(story) || story.some(t => typeof t !== 'string')) throw new Error('sceneTexts phải là mảng các câu chữ');
  if (config.sceneTexts && story.length > plan.scenes.length) throw new Error('sceneTexts có nhiều câu hơn số cảnh; tăng sceneCount/số ảnh hoặc rút gọn câu chuyện');
  // Story beats span the whole film, without repeating a sentence on each image.
  const texts = plan.scenes.map((_, i) => {
    const beat = Math.floor(i * story.length / plan.scenes.length);
    const previous = Math.floor((i - 1) * story.length / plan.scenes.length);
    return i === 0 || beat !== previous ? (story[beat] || '') : '';
  });
  const layout = await layoutTexts(texts, config.text || {});
  const zoom = number(config.zoomAmount, 0.035, 0, 0.04, 'zoomAmount');
  const volume = number(config.audio?.volume, 0.3, 0, 1, 'audio.volume');
  const audioFade = Math.min(plan.duration / 2, number(config.audio?.fadeSeconds, 0.5, 0, 2, 'audio.fadeSeconds'));
  const hasAudio = Boolean(audioPath && fs.existsSync(audioPath));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const outputDir = path.resolve(path.dirname(outputPath));
  const temp = fs.mkdtempSync(path.join(outputDir, '.tiktok-slideshow-'));
  try {
    return await renderWithCache(outputPath, [...selected, hasAudio ? audioPath : null, layout.font], { config, version: VERSION, texts }, async () => {
      const clips = [];
      for (const scene of plan.scenes) {
        console.log(`[TikTok Slideshow] Dựng cảnh ${scene.index + 1}/${plan.scenes.length}…`);
        const frame = path.join(temp, `frame-${scene.index}.png`);
        // Only the decorative background is cropped; foreground fits inside motion margins.
        await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', selected[scene.index], '-filter_complex',
          '[0:v]split[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:3,eq=brightness=-0.15[back];[fg]scale=1000:1760:force_original_aspect_ratio=decrease:flags=lanczos[front];[back][front]overlay=(W-w)/2:(H-h)/2,setsar=1[out]',
          '-map', '[out]', '-frames:v', '1', frame]);
        const clip = path.join(temp, `scene-${scene.index}.mp4`);
        const progress = `on/${Math.max(1, scene.frames - 1)}`;
        const z = scene.index % 2 ? `1+${zoom}*(1-${progress})` : `1+${zoom}*${progress}`;
        // Zoom is bounded by the inset; subjects at image edges remain visible.
        const motion = `scale=2160:3840,zoompan=z='${z}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${scene.frames}:s=1080x1920:fps=30,setsar=1`;
        await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', frame, '-vf', motion, '-frames:v', String(scene.frames), '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', clip], { maxBuffer: 8 * 1024 * 1024 });
        clips.push(clip);
      }
      const args = ['-hide_banner', '-loglevel', 'error', '-y'];
      for (const clip of clips) args.push('-i', clip);
      args.push(...(hasAudio ? ['-stream_loop', '-1', '-i', audioPath] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']));
      const filters = clips.map((_, i) => `[${i}:v]settb=1/30,setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
      let last = 'v0';
      for (let i = 1; i < clips.length; i++) {
        const next = `mix${i}`;
        filters.push(`[${last}][v${i}]xfade=transition=fade:duration=${plan.transitionFrames / FPS}:offset=${plan.scenes[i].start / FPS}[${next}]`);
        last = next;
      }
      const textFilters = [];
      layout.layouts.forEach((item, i) => {
        if (!item.text) return;
        const height = item.text.split('\n').length * (item.fontSize + 10) + 32;
        const y = Math.round(layout.marginTop + layout.position * (1920 - layout.marginTop - layout.marginBottom - height));
        const scene = plan.scenes[i];
        // The caption changes at the midpoint of each dissolve, never two captions together.
        const begin = (scene.start + (i ? plan.transitionFrames / 2 : 0)) / FPS;
        let endIndex = i + 1;
        while (endIndex < texts.length && !texts[endIndex]) endIndex++;
        const end = endIndex === texts.length ? plan.duration : (plan.scenes[endIndex].start + plan.transitionFrames / 2) / FPS;
        const enable = `gte(t,${begin})*lt(t,${end})`;
        // Individual lines have the same centre; no oversized rectangular panel.
        item.text.split('\n').forEach((line, lineIndex) => {
          const lineFile = path.join(temp, `text-${i}-${lineIndex}.txt`);
          fs.writeFileSync(lineFile, line, 'utf8');
          textFilters.push(`drawtext=fontfile='${filterPath(layout.font)}':textfile='${filterPath(lineFile)}':expansion=none:fontsize=${item.fontSize}:fontcolor=white:borderw=1.5:bordercolor=black@0.55:shadowcolor=black@0.65:shadowx=1:shadowy=3:x=(w-text_w)/2:y=${y + 16 + lineIndex * (item.fontSize + 14)}:enable='${enable}'`);
        });
      });
      filters.push(`[${last}]${textFilters.length ? textFilters.join(',') + ',' : ''}fps=30,format=yuv420p[out]`);
      filters.push(`[${clips.length}:a]volume=${volume},apad,atrim=duration=${plan.duration},asetpts=PTS-STARTPTS${audioFade ? `,afade=t=in:d=${audioFade},afade=t=out:st=${plan.duration - audioFade}:d=${audioFade}` : ''}[audio]`);
      const script = path.join(temp, 'filters.txt'); fs.writeFileSync(script, filters.join(';\n'));
      args.push('-filter_complex_threads', '1', '-filter_complex', filters.join(';'), '-map', '[out]', '-map', '[audio]', '-t', String(plan.duration), '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath);
      await run('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024 });
      fs.writeFileSync(`${outputPath}.story.json`, JSON.stringify({ ...plan, order, sourceImages: selected, captions: layout.layouts, config }, null, 2));
    });
  } finally {
    // A unique renderer-owned directory, never source images or shared caches.
    if (path.dirname(path.resolve(temp)) !== outputDir || !path.basename(temp).startsWith('.tiktok-slideshow-')) throw new Error('Thư mục dọn dẹp không hợp lệ');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
