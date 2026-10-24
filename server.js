import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { streamAnswer, describeProvider } from './adapters/llm.js';
import { loadFixture, listFixtures } from './engine/fixture.js';
import { lawsCorpus, corpusStats } from './engine/rules.js';
import { PERSONA, buildQuestion } from './engine/context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 4200;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Forbidden' });

  try {
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

async function handleAsk(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return json(res, 400, { error: err.message });
  }

  const { fixtureId, minute, question } = body;
  if (!question?.trim()) return json(res, 400, { error: 'Ask something.' });

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const fixture = await loadFixture(fixtureId || 'argentina-egypt-2026-r16');
    const laws = await lawsCorpus();
    const prompt = buildQuestion({ fixture, minute: Number(minute) || 90, question });

    const usage = await streamAnswer({
      persona: PERSONA,
      laws,
      question: prompt,
      onThinking: (t) => emit('thinking', { text: t }),
      onText: (t) => emit('text', { text: t }),
    });

    emit('done', { usage });
  } catch (err) {
    // The stream is already open, so failures have to ride the stream, not a status code.
    emit('error', { message: err.message });
  } finally {
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/health') {
    let corpus = null;
    let corpusError = null;
    try {
      corpus = await corpusStats();
    } catch (err) {
      corpusError = err.message;
    }
    return json(res, 200, {
      ok: true,
      ...describeProvider(),
      corpus,
      corpusError,
      fixtures: await listFixtures().catch(() => []),
    });
  }

  if (url.pathname === '/api/fixture') {
    try {
      return json(res, 200, await loadFixture(url.searchParams.get('id') || 'argentina-egypt-2026-r16'));
    } catch (err) {
      return json(res, 404, { error: err.message });
    }
  }

  if (url.pathname === '/api/ask' && req.method === 'POST') return handleAsk(req, res);

  return serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  const p = describeProvider();
  console.log(`\n  ⚽  Ball Knowledge  →  http://localhost:${PORT}\n`);
  console.log(p.ready ? `      brain: ${p.provider} / ${p.model}` : '      ⚠️  no API key — chat will fail. See .env.example');
  console.log('');
});
