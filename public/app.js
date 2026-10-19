const state = { incidents: [], filter: 'all' };
const labels = { open: 'ABERTO', acknowledged: 'RECONHECIDO', resolved: 'RESOLVIDO', critical: 'CRÍTICA', high: 'ALTA', medium: 'MÉDIA', low: 'BAIXA' };
const format = value => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const put = (id, value) => { document.getElementById(id).textContent = String(value); };
function cell(value, className) { const el = document.createElement('td'); if (className) el.className = className; el.textContent = value; return el; }
function render() {
  const visible = state.filter === 'all' ? state.incidents : state.incidents.filter(i => i.status === state.filter);
  const rows = document.getElementById('rows'); rows.replaceChildren();
  if (!visible.length) { const row = document.createElement('tr'); const td = cell('Nenhum incidente nesta visão. Envie um evento assinado para começar.', 'empty'); td.colSpan = 6; row.append(td); rows.append(row); }
  for (const item of visible) {
    const row = document.createElement('tr');
    const badge = document.createElement('span'); badge.className = `badge ${item.status}`; badge.textContent = labels[item.status];
    const status = document.createElement('td'); status.append(badge); row.append(status);
    const name = document.createElement('td'); const title = document.createElement('strong'); title.textContent = item.summary; const code = document.createElement('small'); code.textContent = item.incidentKey; name.append(title, code); row.append(name);
    row.append(cell(item.service.toUpperCase()));
    const severity = document.createElement('td'); const pill = document.createElement('span'); pill.className = `severity ${item.severity}`; pill.textContent = labels[item.severity]; severity.append(pill); row.append(severity);
    row.append(cell(format(item.updatedAt))); row.append(cell(item.timeline.length)); rows.append(row);
  }
  put('count', `${visible.length} INCIDENTE${visible.length === 1 ? '' : 'S'}`);
}
function update(data) {
  state.incidents = Array.isArray(data.incidents) ? data.incidents : [];
  for (const key of ['active', 'critical', 'acknowledged', 'resolved']) put(key, data.summary?.[key] ?? 0);
  render();
}
function connection(online) { const node = document.getElementById('connection'); node.classList.toggle('offline', !online); node.lastChild.textContent = online ? ' CONECTADO' : ' RECONECTANDO'; }
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('selected', b === button)); render(); }));
const stream = new EventSource('/api/stream'); stream.addEventListener('snapshot', event => { try { update(JSON.parse(event.data)); connection(true); } catch { connection(false); } }); stream.addEventListener('error', () => connection(false));
const clock = () => put('clock', new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())); clock(); setInterval(clock, 60_000);
