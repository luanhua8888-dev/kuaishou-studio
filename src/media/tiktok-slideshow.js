import fs from 'node:fs';
import { SLIDESHOW_CONFIG_FILE, PROJECT_ROOT } from '../paths.js';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderWithCache } from './render-cache.js';
import { generateAIStoryScenes } from '../content/ai-story.js';

const run = promisify(execFile);
const FPS = 30;
const VERSION = 6;
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
  const file = SLIDESHOW_CONFIG_FILE;
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

  // 1. Cố gắng chia thành tối đa 2 dòng đẹp mắt (size từ fontSize xuống 26)
  for (let size = fontSize; size >= 26; size--) {
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

  // 2. Nếu câu dài, cho phép hiển thị tối đa 3 dòng (size từ 36 xuống 24)
  for (let size = Math.min(fontSize, 36); size >= 24; size--) {
    const lines = [''];
    let fits = true;
    for (const word of words) {
      if (measure(word, size) > width) { fits = false; break; }
      const last = lines.length - 1;
      const candidate = lines[last] ? `${lines[last]} ${word}` : word;
      if (measure(candidate, size) <= width) lines[last] = candidate;
      else lines.push(word);
    }
    if (fits && lines.length <= 3) {
      return { text: lines.join('\n'), fontSize: size };
    }
  }

  // 3. Nếu câu cực kỳ dài vượt quá 3 dòng, tự động cắt ngắn nhẹ nhàng kèm dấu …
  // Đảm bảo pipeline luôn chạy thông suốt, không bị gián đoạn hay crash giữa chừng
  if (words.length > 3 && width >= 250) {
    const targetSize = 26;
    for (let count = words.length - 1; count >= 1; count--) {
      const candidateText = words.slice(0, count).join(' ') + '…';
      const subWords = candidateText.split(/\s+/);
      const lines = [''];
      let fits = true;
      for (const word of subWords) {
        if (measure(word, targetSize) > width) { fits = false; break; }
        const last = lines.length - 1;
        const candidate = lines[last] ? `${lines[last]} ${word}` : word;
        if (measure(candidate, targetSize) <= width) lines[last] = candidate;
        else lines.push(word);
      }
      if (fits && lines.length <= 3) {
        return { text: lines.join('\n'), fontSize: targetSize };
      }
    }
  }

  throw new Error('Chữ quá dài cho 2 dòng trong vùng an toàn; hãy rút ngắn nội dung cảnh');
}

const fontMeasurerCache = new Map();

function createFontMeasurer(fontPath) {
  try {
    const buf = fs.readFileSync(fontPath);
    const numTables = buf.readUInt16BE(4);
    const tables = {};
    for (let i = 0; i < numTables; i++) {
      tables[buf.toString('ascii', 12 + i * 16, 16 + i * 16)] = {
        offset: buf.readUInt32BE(12 + i * 16 + 8),
        length: buf.readUInt32BE(12 + i * 16 + 12)
      };
    }

    if (!tables['head'] || !tables['hhea'] || !tables['hmtx'] || !tables['cmap']) {
      return (text, size) => text.length * size * 0.55;
    }

    const headOffset = tables['head'].offset;
    const unitsPerEm = buf.readUInt16BE(headOffset + 18) || 1000;
    const hheaOffset = tables['hhea'].offset;
    const numOfHMetrics = buf.readUInt16BE(hheaOffset + 34);
    const hmtxOffset = tables['hmtx'].offset;

    function getAdvanceWidth(glyphId) {
      if (glyphId < numOfHMetrics) {
        return buf.readUInt16BE(hmtxOffset + glyphId * 4);
      }
      return buf.readUInt16BE(hmtxOffset + (numOfHMetrics - 1) * 4);
    }

    const cmapOffset = tables['cmap'].offset;
    const numSubtables = buf.readUInt16BE(cmapOffset + 2);
    let format4Offset = null;
    let format12Offset = null;
    for (let i = 0; i < numSubtables; i++) {
      const offset = buf.readUInt32BE(cmapOffset + 4 + i * 8 + 4);
      const format = buf.readUInt16BE(cmapOffset + offset);
      if (format === 4 && !format4Offset) format4Offset = cmapOffset + offset;
      if (format === 12 && !format12Offset) format12Offset = cmapOffset + offset;
    }

    let getGlyphId = () => 0;

    if (format12Offset) {
      const nGroups = buf.readUInt32BE(format12Offset + 12);
      const groups = [];
      for (let i = 0; i < nGroups; i++) {
        groups.push({
          start: buf.readUInt32BE(format12Offset + 16 + i * 12),
          end: buf.readUInt32BE(format12Offset + 16 + i * 12 + 4),
          startGlyph: buf.readUInt32BE(format12Offset + 16 + i * 12 + 8)
        });
      }
      getGlyphId = (code) => {
        let l = 0, r = groups.length - 1;
        while (l <= r) {
          const mid = (l + r) >> 1;
          const g = groups[mid];
          if (code >= g.start && code <= g.end) return g.startGlyph + (code - g.start);
          if (code < g.start) r = mid - 1;
          else l = mid + 1;
        }
        return 0;
      };
    } else if (format4Offset) {
      const segCount = buf.readUInt16BE(format4Offset + 6) / 2;
      const endCodes = [];
      for (let i = 0; i < segCount; i++) endCodes.push(buf.readUInt16BE(format4Offset + 14 + i * 2));
      const startCodes = [];
      const startOffset = format4Offset + 16 + segCount * 2;
      for (let i = 0; i < segCount; i++) startCodes.push(buf.readUInt16BE(startOffset + i * 2));
      const idDeltas = [];
      const deltaOffset = startOffset + segCount * 2;
      for (let i = 0; i < segCount; i++) idDeltas.push(buf.readInt16BE(deltaOffset + i * 2));
      const idRangeOffsets = [];
      const rangeOffset = deltaOffset + segCount * 2;
      for (let i = 0; i < segCount; i++) idRangeOffsets.push(buf.readUInt16BE(rangeOffset + i * 2));

      getGlyphId = (code) => {
        for (let i = 0; i < segCount; i++) {
          if (code <= endCodes[i]) {
            if (code >= startCodes[i]) {
              if (idRangeOffsets[i] === 0) return (code + idDeltas[i]) & 0xFFFF;
              const ro = rangeOffset + i * 2 + idRangeOffsets[i] + (code - startCodes[i]) * 2;
              const glyph = buf.readUInt16BE(ro);
              return glyph ? (glyph + idDeltas[i]) & 0xFFFF : 0;
            }
            break;
          }
        }
        return 0;
      };
    }

    const charCache = new Map();
    function measureCharWidth(char) {
      if (charCache.has(char)) return charCache.get(char);
      const code = char.codePointAt(0);
      const gid = getGlyphId(code);
      const width = getAdvanceWidth(gid) / unitsPerEm;
      charCache.set(char, width);
      return width;
    }

    return function measureText(text, size = 1) {
      let w = 0;
      for (const ch of String(text).normalize('NFC')) {
        w += measureCharWidth(ch);
      }
      return w * size;
    };
  } catch {
    return (text, size) => text.length * size * 0.55;
  }
}

function getFontMeasurer(fontPath) {
  if (!fontMeasurerCache.has(fontPath)) {
    fontMeasurerCache.set(fontPath, createFontMeasurer(fontPath));
  }
  return fontMeasurerCache.get(fontPath);
}

async function layoutTexts(texts, config) {
  const style = config.style || 'editorial';
  if (!['editorial', 'bold', 'paper', 'diary'].includes(style)) throw new Error('text.style phải là editorial, bold, paper hoặc diary');
  const font = config.fontPath || (!['bold', 'diary'].includes(style) ? path.join(PROJECT_ROOT, 'assets/fonts/Lora-Italic.ttf') :
    ['C:/Windows/Fonts/arialbd.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find(p => fs.existsSync(p)));
  if (!font || !fs.existsSync(font)) throw new Error('Không tìm thấy font; cấu hình text.fontPath với font hỗ trợ tiếng Việt');
  const marginLeft = number(config.marginLeft, 140, 24, 400, 'text.marginLeft');
  const marginRight = number(config.marginRight, 180, 120, 400, 'text.marginRight');
  const marginTop = number(config.marginTop, 180, 100, 600, 'text.marginTop');
  const marginBottom = number(config.marginBottom, 420, 300, 700, 'text.marginBottom');
  const fontSize = number(config.fontSize, 64, 30, 80, 'text.fontSize');
  const position = number(config.positionY, 0.72, 0, 1, 'text.positionY');
  // Centre on the actual video, while respecting the larger of both safe margins.
  const width = 1080 - 2 * Math.max(marginLeft, marginRight) - 40;

  const measure = getFontMeasurer(font);
  const layouts = texts.map((text) => wrapStory(text, width, fontSize, measure));
  return { font, style, marginLeft, marginRight, marginTop, marginBottom, position, width, layouts };
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
  const story = config.sceneTexts !== undefined
    ? config.sceneTexts
    : await generateAIStoryScenes({
        title: config.title,
        moodQuote: config.moodQuote,
        author: config.author,
        musicName: config.musicName,
        musicArtist: config.musicArtist,
        sceneCount: plan.scenes.length,
        seed: config.seed || config.title || config.moodQuote || outputPath,
        apiKey: config.apiKey || config.geminiApiKey
      });
  if (!Array.isArray(story) || story.some(t => typeof t !== 'string')) throw new Error('sceneTexts phải là mảng các câu chữ');
  if (config.sceneTexts && story.length > plan.scenes.length) throw new Error('sceneTexts có nhiều câu hơn số cảnh; tăng sceneCount/số ảnh hoặc rút gọn câu chuyện');
  if (story.length) console.log('[TikTok Slideshow] Câu chữ từng cảnh theo bối cảnh:', story);
  // Story beats span the whole film, without repeating a sentence on each image.
  const texts = plan.scenes.map((_, i) => {
    const beat = Math.floor(i * story.length / plan.scenes.length);
    const previous = Math.floor((i - 1) * story.length / plan.scenes.length);
    return i === 0 || beat !== previous ? (story[beat] || '') : '';
  });
  const layout = await layoutTexts(texts, config.text || {});
  const zoom = number(config.zoomAmount, 0, 0, 0.04, 'zoomAmount');
  const volume = number(config.audio?.volume, 1.0, 0, 1, 'audio.volume');
  const audioFade = Math.min(plan.duration / 2, number(config.audio?.fadeSeconds, 0.5, 0, 2, 'audio.fadeSeconds'));
  const hasAudio = Boolean(audioPath && fs.existsSync(audioPath));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const outputDir = path.resolve(path.dirname(outputPath));
  const temp = fs.mkdtempSync(path.join(outputDir, '.tiktok-slideshow-'));
  try {
    return await renderWithCache(outputPath, [...selected, hasAudio ? audioPath : null, layout.font], { config, version: VERSION, texts }, async () => {
      console.log(`[TikTok Slideshow] Dựng đồng thời ${plan.scenes.length} cảnh đa luồng…`);
      const sceneTasks = plan.scenes.map(async scene => {
        const frame = path.join(temp, `frame-${scene.index}.png`);
        // Only the decorative background is cropped; foreground fits inside motion margins.
        await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '0', '-i', selected[scene.index], '-filter_complex',
          '[0:v]split[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:3,eq=brightness=-0.15[back];[fg]scale=1000:1760:force_original_aspect_ratio=decrease:flags=lanczos[front];[back][front]overlay=(W-w)/2:(H-h)/2,setsar=1[out]',
          '-map', '[out]', '-frames:v', '1', frame]);
        const clip = path.join(temp, `scene-${scene.index}.mp4`);
        if (zoom <= 0) {
          await run('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-y', '-threads', '0',
            '-framerate', '30', '-loop', '1', '-i', frame,
            '-t', String(scene.frames / FPS),
            '-frames:v', String(scene.frames),
            '-r', '30', '-g', '60', '-keyint_min', '30', '-sc_threshold', '0',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
            clip
          ], { maxBuffer: 8 * 1024 * 1024 });
        } else {
          const progress = `on/${Math.max(1, scene.frames - 1)}`;
          const z = scene.index % 2 ? `1+${zoom}*(1-${progress})` : `1+${zoom}*${progress}`;
          // Zoom is bounded by the inset; subjects at image edges remain visible.
          const motion = `scale=2160:3840,zoompan=z='${z}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${scene.frames}:s=1080x1920:fps=30,setsar=1`;
          await run('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-y', '-threads', '0',
            '-framerate', '30', '-i', frame,
            '-vf', motion,
            '-frames:v', String(scene.frames),
            '-r', '30', '-g', '60', '-keyint_min', '30', '-sc_threshold', '0',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
            clip
          ], { maxBuffer: 8 * 1024 * 1024 });
        }
        return { index: scene.index, clip };
      });
      const renderedScenes = await Promise.all(sceneTasks);
      renderedScenes.sort((a, b) => a.index - b.index);
      const clips = renderedScenes.map(s => s.clip);
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
        const lineHeight = Math.round(item.fontSize * 1.38);
        const height = item.text.split('\n').length * lineHeight + 32;
        const y = Math.round(layout.marginTop + layout.position * (1920 - layout.marginTop - layout.marginBottom - height));
        const scene = plan.scenes[i];
        // The caption changes at the midpoint of each dissolve, never two captions together.
        const begin = (scene.start + (i ? plan.transitionFrames / 2 : 0)) / FPS;
        let endIndex = i + 1;
        while (endIndex < texts.length && !texts[endIndex]) endIndex++;
        const end = endIndex === texts.length ? plan.duration : (plan.scenes[endIndex].start + plan.transitionFrames / 2) / FPS;
        const enable = `gte(t,${begin})*lt(t,${end})`;
        // Short fades soften scene changes while keeping most of each beat fully readable.
        const fade = Math.min(0.22, (end - begin) / 4);
        const alpha = `min(1,min(max(0,(t-${begin})/${fade}),max(0,(${end}-t)/${fade})))`;
        const left = (1080 - layout.width) / 2;
        if (layout.style === 'editorial') {
          // A broad feathered scrim supports bright footage without outlining the letterforms.
          const top = y - 100;
          const bandHeight = height + 200;
          for (let strip = 0; strip < 32; strip++) {
            const opacity = (0.48 * Math.sin(Math.PI * (strip + 0.5) / 32) ** 2).toFixed(3);
            textFilters.push(`drawbox=x=0:y=${Math.round(top + strip * bandHeight / 32)}:w=iw:h=${Math.ceil(bandHeight / 32)}:color=0x101719@${opacity}:t=fill:enable='${enable}'`);
          }
        } else if (layout.style === 'paper') {
          textFilters.push(`drawbox=x=${left - 30}:y=${y - 18}:w=${layout.width + 60}:h=${height + 24}:color=0xF3EDDF@0.96:t=fill:enable='${enable}'`);
          textFilters.push(`drawbox=x=${left - 30}:y=${y - 18}:w=5:h=${height + 24}:color=0xB64B36:t=fill:enable='${enable}'`);
        }
        item.text.split('\n').forEach((line, lineIndex) => {
          const lineFile = path.join(temp, `text-${i}-${lineIndex}.txt`);
          fs.writeFileSync(lineFile, line, 'utf8');
          const treatment = layout.style === 'diary'
            ? 'fontcolor=white:borderw=0:shadowcolor=black@0.22:shadowx=0:shadowy=2:x=(w-text_w)/2'
            : layout.style === 'bold'
            ? `fontcolor=${lineIndex === 0 ? '0xDFFF70' : 'white'}:borderw=0:box=1:boxcolor=0x101719@0.90:boxborderw=14:shadowx=0:shadowy=0:x=(w-text_w)/2`
            : `fontcolor=${layout.style === 'paper' ? '0x252C2A' : '0xFFF5E5'}:borderw=0:shadowcolor=black@${layout.style === 'paper' ? '0' : '0.35'}:shadowx=0:shadowy=2:x=${left}`;
          textFilters.push(`drawtext=fontfile='${filterPath(layout.font)}':textfile='${filterPath(lineFile)}':expansion=none:fontsize=${item.fontSize}:alpha='${alpha}':${treatment}:y=${y + 16 + lineIndex * lineHeight}:enable='${enable}'`);
        });
        if (layout.style === 'diary' && config.sceneSubtitles?.[i]) {
          const subtitleFile = path.join(temp, `subtitle-${i}.txt`);
          fs.writeFileSync(subtitleFile, String(config.sceneSubtitles[i]).normalize('NFC').toUpperCase().split('').join(' '), 'utf8');
          textFilters.push(`drawtext=fontfile='${filterPath(layout.font)}':textfile='${filterPath(subtitleFile)}':expansion=none:fontsize=18:fontcolor=white:alpha='${alpha}':shadowcolor=black@0.25:shadowy=1:x=(w-text_w)/2:y=${y + 24 + item.text.split('\n').length * lineHeight}:enable='${enable}'`);
        }
      });
      const grade = layout.style === 'diary' ? 'eq=saturation=0.80:contrast=1.025:brightness=0.012,colorbalance=rs=0.018:bs=-0.018,noise=alls=2:allf=t,' : '';
      filters.push(`[${last}]${grade}${textFilters.length ? textFilters.join(',') + ',' : ''}fps=30,format=yuv420p[out]`);
      filters.push(`[${clips.length}:a]volume=${volume},apad,atrim=duration=${plan.duration},asetpts=PTS-STARTPTS${audioFade ? `,afade=t=in:d=${audioFade},afade=t=out:st=${plan.duration - audioFade}:d=${audioFade}` : ''}[audio]`);
      const script = path.join(temp, 'filters.txt'); fs.writeFileSync(script, filters.join(';\n'));
      args.push(
        '-threads', '0',
        '-filter_complex', filters.join(';'),
        '-map', '[out]',
        '-map', '[audio]',
        '-t', String(plan.duration),
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-profile:v', 'high',
        '-level', '4.2',
        '-g', '60',
        '-keyint_min', '30',
        '-sc_threshold', '0',
        '-b:v', '6M',
        '-maxrate', '8M',
        '-bufsize', '12M',
        '-pix_fmt', 'yuv420p',
        '-colorspace', 'bt709',
        '-color_primaries', 'bt709',
        '-color_trc', 'bt709',
        '-color_range', 'tv',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '44100',
        '-movflags', '+faststart',
        outputPath
      );
      await run('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024 });
      fs.writeFileSync(`${outputPath}.story.json`, JSON.stringify({ ...plan, order, sourceImages: selected, captions: layout.layouts, config }, null, 2));
    });
  } finally {
    // A unique renderer-owned directory, never source images or shared caches.
    if (path.dirname(path.resolve(temp)) !== outputDir || !path.basename(temp).startsWith('.tiktok-slideshow-')) throw new Error('Thư mục dọn dẹp không hợp lệ');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
