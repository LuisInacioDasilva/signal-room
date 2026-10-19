import { createHmac, randomUUID } from 'node:crypto';

const key = process.env.INGEST_KEY;
if (!key || key.length < 24) throw new Error('Defina INGEST_KEY antes de rodar a demo');
const base = process.env.SIGNAL_ROOM_URL || 'http://127.0.0.1:3000';
const now = Date.now();
const samples = [
  { incidentKey: 'checkout-latency', service: 'checkout', source: 'apm', severity: 'critical', kind: 'triggered', summary: 'Latência acima do limite no checkout', occurredAt: new Date(now - 12 * 60_000).toISOString() },
  { incidentKey: 'queue-backlog', service: 'worker', source: 'queue', severity: 'high', kind: 'triggered', summary: 'Fila de processamento acumulando eventos', occurredAt: new Date(now - 9 * 60_000).toISOString() },
  { incidentKey: 'queue-backlog', service: 'worker', source: 'queue', severity: 'high', kind: 'acknowledged', summary: 'Escalado para a equipe de plataforma', occurredAt: new Date(now - 7 * 60_000).toISOString() },
  { incidentKey: 'billing-errors', service: 'billing', source: 'monitor', severity: 'medium', kind: 'triggered', summary: 'Falhas intermitentes na conciliação', occurredAt: new Date(now - 6 * 60_000).toISOString() },
  { incidentKey: 'billing-errors', service: 'billing', source: 'monitor', severity: 'medium', kind: 'resolved', summary: 'Conciliação estabilizada', occurredAt: new Date(now - 2 * 60_000).toISOString() }
];
for (const sample of samples) {
  const body = JSON.stringify({ eventId: randomUUID(), ...sample });
  const signature = 'sha256=' + createHmac('sha256', key).update(body).digest('hex');
  const response = await fetch(base + '/api/events', { method: 'POST', headers: { 'content-type': 'application/json', 'x-signal-signature': signature }, body });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
}
console.log('5 eventos de demonstração enviados. Abra', base);
