import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateEvent, projection } from '../src/domain.mjs';
import { EventStore } from '../src/store.mjs';
import { createApp, verifySignature } from '../src/server.mjs';

const event = (overrides = {}) => ({ eventId: 'evt-001', incidentKey: 'checkout-500', service: 'checkout', source: 'monitor', severity: 'critical', kind: 'triggered', summary: 'Taxa de erros elevada', occurredAt: new Date(Date.now() - 60_000).toISOString(), ...overrides });

test('contrato rejeita dados inválidos e data futura', () => {
  assert.equal(validateEvent(event()).service, 'checkout');
  assert.throws(() => validateEvent(event({ eventId: '../path' })), /eventId/);
  assert.throws(() => validateEvent(event({ severity: 'urgent' })), /Severidade/);
  assert.throws(() => validateEvent(event({ occurredAt: new Date(Date.now() + 600_000).toISOString() })), /futura/);
});

test('projeção respeita ciclo de vida e ignora atualização órfã', () => {
  const now = Date.now();
  const events = [
    event({ eventId: 'evt-003', kind: 'resolved', occurredAt: new Date(now - 1_000).toISOString() }),
    event({ eventId: 'evt-001', occurredAt: new Date(now - 3_000).toISOString() }),
    event({ eventId: 'evt-002', kind: 'acknowledged', occurredAt: new Date(now - 2_000).toISOString() }),
    event({ eventId: 'evt-004', incidentKey: 'missing', kind: 'resolved' })
  ];
  const view = projection(events);
  assert.equal(view.incidents.length, 1);
  assert.equal(view.incidents[0].status, 'resolved');
  assert.equal(view.incidents[0].timeline.length, 3);
  assert.equal(view.summary.resolved, 1);
});

test('assinatura HMAC é obrigatória e usa comparação segura', () => {
  const body = Buffer.from('{"ok":true}'); const key = 'a-very-long-development-secret';
  const signature = 'sha256=' + createHmac('sha256', key).update(body).digest('hex');
  assert.equal(verifySignature(body, signature, key), true);
  assert.equal(verifySignature(body, signature, 'wrong-secret'), false);
  assert.equal(verifySignature(body, 'sha256=abc', key), false);
});

test('armazenamento serializa escritas concorrentes e reconstrói log', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signal-room-'));
  try {
    const file = join(dir, 'events.ndjson'); const store = new EventStore(file); await store.load();
    assert.deepEqual(await Promise.all([store.append(event()), store.append(event())]), [true, false]);
    const restored = new EventStore(file); await restored.load();
    assert.equal(restored.events.length, 1);
    assert.equal((await readFile(file, 'utf8')).trim().split('\n').length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('API valida assinatura, deduplica e expõe projeção', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signal-room-http-'));
  const store = new EventStore(join(dir, 'events.ndjson')); await store.load();
  const key = 'a-very-long-development-secret'; const server = createApp({ store, ingestKey: key });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const body = JSON.stringify(event());
    assert.equal((await fetch(base + '/api/events', { method: 'POST', body })).status, 401);
    const headers = { 'x-signal-signature': 'sha256=' + createHmac('sha256', key).update(body).digest('hex') };
    const first = await fetch(base + '/api/events', { method: 'POST', headers, body });
    assert.equal(first.status, 201);
    const second = await fetch(base + '/api/events', { method: 'POST', headers, body });
    assert.equal(second.status, 200);
    assert.equal((await second.json()).duplicate, true);
    const result = await (await fetch(base + '/api/incidents')).json();
    assert.equal(result.summary.critical, 1);
    assert.equal(result.incidents.length, 1);
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(base + '/../secret')).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
