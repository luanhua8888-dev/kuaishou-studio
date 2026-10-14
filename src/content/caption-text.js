// Normalize decorative alphabets before translation or rendering with video fonts.
export function normalizeCaptionText(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\uFFFD\u25A1\u25A0]/gu, ' ')
    .replace(/\?{3,}/g, ' ')
    .replace(/[\u200B\u200C\u200D\uFEFF]/gu, '')
    .replace(/[^\S\n]+/g, ' ').trim();
}

// Captions are published without account mentions, including mentions in custom text.
export function removeCaptionMentions(value) {
  return String(value ?? '')
    .replace(/\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/gu, '')
    .replace(/@[\p{L}\p{N}._-]+/gu, '')
    .replace(/@/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    // Decode after collecting bytes: a Vietnamese character can span chunks.
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}
