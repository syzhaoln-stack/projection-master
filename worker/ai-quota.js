import { quotaLimits } from './ai-shared.js';

const DAY = 86400000;
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** One SQLite-backed Durable Object owns every shared reservation. No in-memory
 * fallback: a storage error prevents an upstream request rather than losing caps. */
export class AiQuota {
  constructor(state, env) { this.storage = state.storage; this.env = env; this.now = () => Date.now(); }

  async fetch(request) {
    try {
      const limits = quotaLimits(this.env);
      const path = new URL(request.url).pathname;
      if (path === '/status' && request.method === 'GET') {
        await this.storage.get('health');
        return reply({ ready: true });
      }
      if (path !== '/reserve' || request.method !== 'POST') return reply({ ready: false }, 404);
      const body = await request.json();
      if (!body || Object.keys(body).length !== 1 || !/^[0-9a-f]{64}$/.test(body.client)) return reply({ ready: false }, 400);
      const now = this.now(), day = new Date(now).toISOString().slice(0, 10), minute = Math.floor(now / 60000);
      const nextDay = (Math.floor(now / DAY) + 1) * DAY;
      const globalKey = `day:${day}:global`, clientKey = `day:${day}:client:${body.client}`;
      const reservation = await this.storage.transaction(async transaction => {
        const total = (await transaction.get(globalKey)) || 0;
        const existing = (await transaction.get(clientKey)) || { total: 0, minute, minuteCount: 0 };
        const minuteCount = existing.minute === minute ? existing.minuteCount : 0;
        if (total >= limits.globalPerDay || existing.total >= limits.perDay) return { ready: false, code: 'RATE_LIMIT', retryAfter: Math.max(1, Math.ceil((nextDay - now) / 1000)) };
        if (minuteCount >= limits.perMinute) return { ready: false, code: 'RATE_LIMIT', retryAfter: Math.max(1, 60 - Math.floor(now / 1000) % 60) };
        await transaction.put(globalKey, total + 1);
        await transaction.put(clientKey, { total: existing.total + 1, minute, minuteCount: minuteCount + 1 });
        return { ready: true };
      });
      // Reserve before calling DeepSeek. Failed/cancelled upstream attempts also
      // consume a slot, so repeated errors cannot create an unbounded relay.
      if (!await this.storage.getAlarm()) await this.storage.setAlarm(nextDay + 1000);
      return reply(reservation, reservation.ready ? 200 : 429);
    } catch { return reply({ ready: false, code: 'SERVICE_UNAVAILABLE' }, 503); }
  }

  async alarm() {
    const now = this.now(), day = new Date(now).toISOString().slice(0, 10);
    const old = await this.storage.list({ prefix: 'day:', end: `day:${day}:`, limit: 1000 });
    const keys = [...old.keys()];
    for (let i = 0; i < keys.length; i += 128) await this.storage.delete(keys.slice(i, i + 128));
    await this.storage.setAlarm(old.size === 1000 ? now + 1000 : (Math.floor(now / DAY) + 1) * DAY + 1000);
  }
}
