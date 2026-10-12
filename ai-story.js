import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateStoryScenes } from './tiktok-story.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Đọc Gemini API Key từ tham số, biến môi trường hoặc file .setting
 */
export function resolveGeminiApiKey(explicitKey = '') {
  if (explicitKey && typeof explicitKey === 'string' && explicitKey.trim()) {
    return explicitKey.trim();
  }
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }
  if (process.env.AI_API_KEY && process.env.AI_API_KEY.trim()) {
    return process.env.AI_API_KEY.trim();
  }
  const settingPath = path.join(__dirname, '.setting');
  try {
    if (fs.existsSync(settingPath)) {
      const data = JSON.parse(fs.readFileSync(settingPath, 'utf8'));
      if (data.geminiApiKey && typeof data.geminiApiKey === 'string' && data.geminiApiKey.trim()) {
        return data.geminiApiKey.trim();
      }
      if (data.aiApiKey && typeof data.aiApiKey === 'string' && data.aiApiKey.trim()) {
        return data.aiApiKey.trim();
      }
    }
  } catch {}
  return '';
}

/**
 * Xây dựng prompt chất lượng cao cho Gemini để sinh ra các câu phù hợp với bối cảnh video/ảnh TikTok
 */
export function buildGeminiPrompt({ title = '', moodQuote = '', author = '', musicName = '', musicArtist = '', sceneCount = 4 } = {}) {
  return `Bạn là một chuyên gia sáng tạo nội dung TikTok triệu view.
Hãy sáng tạo đúng ${sceneCount} câu ngắn (bằng tiếng Việt có dấu) xuất hiện trên màn hình video TikTok (slideshow ảnh).

Thông tin bài đăng Kuaishou gốc:
- Tiêu đề gốc: "${title || 'Khoảnh khắc bình yên'}"
- Ý nghĩa/bối cảnh dịch tiếng Việt: "${moodQuote || title || 'Cuộc sống thường ngày'}"
${author ? `- Tác giả: "${author}"\n` : ''}${musicName ? `- Âm nhạc: "${musicName}${musicArtist ? ' - ' + musicArtist : ''}"\n` : ''}

YÊU CẦU BẮT BUỘC:
1. Viết đúng chính xác ${sceneCount} câu, mỗi câu tương ứng với một cảnh trong video.
2. Nội dung PHẢI hoàn toàn bám sát chủ đề và cảm xúc của bài đăng (ví dụ: thiên nhiên bình yên, hoàng hôn, mưa rơi, tình yêu dịu dàng, phố đêm, ẩm thực ấm áp, mèo/chó đáng yêu, du lịch tự do, chữa lành tâm hồn, động lực sống...).
3. Tuyệt đối KHÔNG viết chung chung, KHÔNG lặp lại câu từ giữa các bài. Mỗi bài đăng phải có một câu chuyện và cảm xúc riêng biệt.
4. Giọng điệu: Sâu lắng, thơ mộng, chạm cảm xúc hoặc dí dỏm tự nhiên, cực kỳ hợp gu giới trẻ TikTok.
5. Độ dài mỗi câu: Ngắn gọn từ 6 đến 16 từ (để chữ không bị tràn màn hình video 9:16).
6. Định dạng kết quả: CHỈ trả về một JSON array chứa ${sceneCount} chuỗi, ví dụ:
["câu 1", "câu 2", "câu 3", "câu 4"]
Không thêm bất kỳ lời giải thích nào ngoài mảng JSON này.`;
}

/**
 * Gọi REST API tới Google Gemini
 */
export async function callGeminiApi({ prompt, apiKey, model = 'gemini-2.5-flash', timeoutMs = 15000 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini API HTTP ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini API không trả về nội dung hợp lệ');
  }

  return rawText.trim();
}

/**
 * Parse và chuẩn hóa kết quả từ Gemini JSON
 */
export function parseGeminiStoryResponse(rawText, sceneCount = 4) {
  let cleaned = rawText.trim();
  // Loại bỏ markdown code block nếu có
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

  let parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null) {
    // Có thể trả về { scenes: [...] } hoặc { story: [...] }
    const possibleArray = Object.values(parsed).find(v => Array.isArray(v));
    if (possibleArray) parsed = possibleArray;
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Kết quả từ AI không phải là mảng câu chuyện');
  }

  const sanitized = parsed
    .map(s => String(s || '').replace(/\r?\n/g, ' ').trim())
    .filter(s => s.length > 0);

  if (sanitized.length === 0) {
    throw new Error('AI không sinh ra câu nào hợp lệ');
  }

  // Cắt bớt nếu thừa câu, hoặc lặp lại nếu thiếu
  if (sanitized.length > sceneCount) {
    return sanitized.slice(0, sceneCount);
  }
  return sanitized;
}

/**
 * Sinh câu chuyện từng cảnh cho video TikTok bằng Google Gemini AI (có fallback sang quy tắc theo chủ đề nếu không có API key)
 */
export async function generateAIStoryScenes({
  title = '',
  moodQuote = '',
  author = '',
  musicName = '',
  musicArtist = '',
  sceneCount = 4,
  seed = '',
  apiKey = null,
  geminiApiKey = null
} = {}) {
  const key = resolveGeminiApiKey(apiKey || geminiApiKey);

  if (key) {
    try {
      const prompt = buildGeminiPrompt({ title, moodQuote, author, musicName, musicArtist, sceneCount });
      console.log(`[TikTok AI] Đang gửi yêu cầu sinh câu chuyện tới Google Gemini AI cho bài viết: "${title || moodQuote}"...`);
      
      let rawText;
      try {
        rawText = await callGeminiApi({ prompt, apiKey: key, model: 'gemini-2.5-flash' });
      } catch (err25) {
        try {
          console.warn(`[TikTok AI] Thử lại với model gemini-flash-latest (${err25.message.slice(0, 80)})...`);
          rawText = await callGeminiApi({ prompt, apiKey: key, model: 'gemini-flash-latest' });
        } catch {
          console.warn(`[TikTok AI] Thử lại với model gemini-2.5-flash-lite...`);
          rawText = await callGeminiApi({ prompt, apiKey: key, model: 'gemini-2.5-flash-lite' });
        }
      }

      const aiScenes = parseGeminiStoryResponse(rawText, sceneCount);
      console.log('[TikTok AI] Đã tạo thành công câu chuyện từ Gemini AI:');
      aiScenes.forEach((s, idx) => console.log(`  [Cảnh ${idx + 1}] ${s}`));
      return aiScenes;
    } catch (err) {
      console.warn(`[TikTok AI] Không thể tạo bằng AI Gemini (${err.message}) -> Tự động chuyển sang câu chuyện theo bối cảnh Kuaishou.`);
    }
  } else {
    console.log('[TikTok AI] Chưa có Gemini API Key -> Dùng bộ tạo câu chuyện theo bối cảnh Kuaishou (nhập API Key trong Cài đặt để AI tự viết).');
  }

  // Fallback sang bộ tạo theo bối cảnh Kuaishou đã có
  return generateStoryScenes({ title, moodQuote, sceneCount, seed });
}
