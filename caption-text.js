// Normalize decorative alphabets before translation or rendering with video fonts.
export function normalizeCaptionText(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\uFFFD\u25A1\u25A0]/gu, ' ')
    .replace(/\?{3,}/g, ' ')
    .replace(/[\u200B\u200C\u200D\uFEFF]/gu, '')
    .replace(/[^\S\n]+/g, ' ').trim();
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
