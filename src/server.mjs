import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventStore } from './store.mjs';
import { validateEvent, projection } from './domain.mjs';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };

export function verifySignature(body, header, key) {
  if (!key || !header?.startsWith('sha256=')) return false;
  const supplied = header.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac('sha256', key).update(body).digest();
  return timingSafeEqual(Buffer.from(supplied, 'hex'), expected);
}

async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('payload_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createApp({ store, ingestKey }) {
  const clients = new Set();
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    try {
      if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { status: 'ok', events: store.events.length });
      if (req.method === 'GET' && pathname === '/api/incidents') return json(res, 200, projection(store.events));
      if (req.method === 'GET' && pathname === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(`event: snapshot\ndata: ${JSON.stringify(projection(store.events))}\n\n`);
        clients.add(res);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25_000);
        req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
        return;
      }
      if (req.method === 'POST' && pathname === '/api/events') {
        const body = await readBody(req);
        if (!verifySignature(body, req.headers['x-signal-signature'], ingestKey)) return json(res, 401, { error: 'Assinatura inválida' });
        let data;
        try { data = JSON.parse(body.toString('utf8')); } catch { return json(res, 400, { error: 'JSON inválido' }); }
        let event;
        try { event = validateEvent(data); } catch (error) { return json(res, 422, { error: error.message }); }
        const created = await store.append(event);
        if (created) {
          const snapshot = `event: snapshot\ndata: ${JSON.stringify(projection(store.events))}\n\n`;
          for (const client of clients) client.write(snapshot);
        }
        return json(res, created ? 201 : 200, { eventId: event.eventId, duplicate: !created });
      }
      if (req.method !== 'GET' || !['/', '/app.js', '/style.css'].includes(pathname)) return json(res, 404, { error: 'Não encontrado' });
      const file = resolve(publicDir, pathname === '/' ? 'index.html' : pathname.slice(1));
      const content = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)], 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(content);
    } catch (error) {
      if (error.message === 'payload_too_large') return json(res, 413, { error: 'Payload acima de 64 KiB' });
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: 'Erro interno' });
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const store = new EventStore(resolve(process.env.DATA_FILE || './data/events.ndjson'));
  await store.load();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida');
  const key = process.env.INGEST_KEY;
  if (!key || key.length < 24) throw new Error('Defina INGEST_KEY com pelo menos 24 caracteres');
  createApp({ store, ingestKey: key }).listen(port, host, () => console.log(`Signal Room em http://${host}:${port}`));
}
