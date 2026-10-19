import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class EventStore {
  constructor(file) { this.file = file; this.events = []; this.ids = new Set(); this.pending = Promise.resolve(); }

  async load() {
    await mkdir(dirname(this.file), { recursive: true });
    let text = '';
    try { text = await readFile(this.file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let lineNumber = 0;
    for (const line of text.split('\n')) {
      lineNumber++;
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { throw new Error(`Registro NDJSON inválido na linha ${lineNumber}`); }
      if (!event.eventId || this.ids.has(event.eventId)) throw new Error(`ID duplicado ou ausente na linha ${lineNumber}`);
      this.ids.add(event.eventId);
      this.events.push(event);
    }
  }

  async append(event) {
    const write = async () => {
      if (this.ids.has(event.eventId)) return false;
      await appendFile(this.file, JSON.stringify(event) + '\n', { encoding: 'utf8', mode: 0o600 });
      this.ids.add(event.eventId);
      this.events.push(event);
      return true;
    };
    const result = this.pending.then(write);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }
}
