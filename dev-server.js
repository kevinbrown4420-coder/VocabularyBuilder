const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png'
};

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function apiLookup(req, res) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) return json(res, 413, { error: 'Request too large.' });
  }
  try {
    const body = JSON.parse(raw || '{}');
    const { kind, word, apiKey } = body;
    if (!apiKey || typeof apiKey !== 'string') return json(res, 400, { error: 'Missing API key.' });
    if (!word || typeof word !== 'string' || word.length > 80) return json(res, 400, { error: 'Invalid word.' });
    if (!['dictionary', 'thesaurus'].includes(kind)) return json(res, 400, { error: 'Invalid lookup type.' });
    const reference = kind === 'dictionary' ? 'collegiate' : 'thesaurus';
    const target = `https://www.dictionaryapi.com/api/v3/references/${reference}/json/${encodeURIComponent(word)}?key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(target, { headers: { Accept: 'application/json' } });
    const data = await upstream.json();
    return json(res, upstream.status, data);
  } catch (e) {
    return json(res, 502, { error: 'Reference lookup failed.' });
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/api/lookup') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
    return apiLookup(req, res);
  }

  let pathname = decodeURIComponent(u.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT) || filePath.includes(`${path.sep}api${path.sep}`) || filePath.endsWith('dev-server.js')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Vocabulary Tracker running at http://localhost:${PORT}`);
});
