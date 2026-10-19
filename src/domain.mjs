const levels = new Set(['critical', 'high', 'medium', 'low']);
const kinds = new Set(['triggered', 'acknowledged', 'resolved']);
const idPattern = /^[a-zA-Z0-9:_-]{3,80}$/;

export function validateEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Evento inválido');
  const { eventId, incidentKey, service, source, severity, kind, summary, occurredAt } = input;
  for (const [field, value] of Object.entries({ eventId, incidentKey, service, source })) {
    if (typeof value !== 'string' || !idPattern.test(value)) throw new Error(`${field} inválido`);
  }
  if (!levels.has(severity) || !kinds.has(kind)) throw new Error('Severidade ou tipo inválido');
  if (typeof summary !== 'string' || summary.trim().length < 4 || summary.length > 240) throw new Error('Resumo inválido');
  const timestamp = Date.parse(occurredAt);
  if (typeof occurredAt !== 'string' || !Number.isFinite(timestamp)) throw new Error('Data inválida');
  if (timestamp > Date.now() + 5 * 60_000) throw new Error('Data futura não permitida');
  return { eventId, incidentKey, service, source, severity, kind, summary: summary.trim(), occurredAt: new Date(timestamp).toISOString() };
}

export function projection(events) {
  const byKey = new Map();
  const ordered = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  for (const event of ordered) {
    const key = `${event.service}:${event.incidentKey}`;
    const previous = byKey.get(key);
    if (!previous && event.kind !== 'triggered') continue;
    const current = previous ?? { id: key, service: event.service, incidentKey: event.incidentKey, source: event.source, severity: event.severity, openedAt: event.occurredAt, timeline: [] };
    current.severity = event.severity;
    current.summary = event.summary;
    current.status = event.kind === 'resolved' ? 'resolved' : event.kind === 'acknowledged' ? 'acknowledged' : 'open';
    current.updatedAt = event.occurredAt;
    current.timeline.push({ kind: event.kind, at: event.occurredAt, summary: event.summary });
    byKey.set(key, current);
  }
  const incidents = [...byKey.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return { incidents, summary: {
    active: incidents.filter(i => i.status !== 'resolved').length,
    critical: incidents.filter(i => i.status !== 'resolved' && i.severity === 'critical').length,
    acknowledged: incidents.filter(i => i.status === 'acknowledged').length,
    resolved: incidents.filter(i => i.status === 'resolved').length
  } };
}
