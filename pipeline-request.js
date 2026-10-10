import http from 'node:http';

// Wait for long local publishing jobs without fetch's header timeout.
export function requestPipeline(port, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/api/run-pipeline', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const result = JSON.parse(text);
          if (res.statusCode >= 400) throw new Error(result.error || `HTTP ${res.statusCode}`);
          resolve(result);
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
