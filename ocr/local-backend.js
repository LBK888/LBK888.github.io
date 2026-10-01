/* Local mode: the same API paths as backend/app.py, answered in the browser.
   Used when no class server is connected (e.g. a GitHub Pages test). Readings
   stay in this browser (localStorage); there are no forecasts. */
import {validateReadings, NUMBER} from './reading-parser.js';
const KEY = 'read-predict-local-v1', MAX_POINTS = 20000;
const httpError = (status, message) => Object.assign(Error(`${status}: ${message}`), {status});

export class LocalBackend {
  constructor(storage = globalThis.localStorage, clock = () => Date.now() / 1000) {
    this.storage = storage; this.clock = clock; this.saveError = null; this.load();
  }
  read(key, fallback) { try { return JSON.parse(this.storage?.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } }
  load() {
    this.channels = this.read(KEY, {channels: []}).channels || [];
    this.observations = new Map(this.channels.map(c => [c.id, this.read(`${KEY}:${c.id}`, [])]));
  }
  save(id) {
    try {
      this.storage?.setItem(KEY, JSON.stringify({channels: this.channels}));
      if (id) this.storage?.setItem(`${KEY}:${id}`, JSON.stringify(this.observations.get(id)));
      this.saveError = null;
    } catch (error) { this.saveError = error; }
  }
  clear() {
    for (const c of this.channels) this.storage?.removeItem(`${KEY}:${c.id}`);
    this.channels = []; this.observations = new Map(); this.save();
  }
  channel(id) { const c = this.channels.find(x => x.id === id); if (!c) throw httpError(404, 'Channel not found'); return c; }
  async request(path, {method = 'GET', body} = {}) {
    const url = new URL(path, 'http://local'), parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/api/health') return {status: 'ok', mode: 'local', server_time: this.clock()};
    if (url.pathname === '/api/catalog') return [];
    if (url.pathname === '/api/channels' && method === 'GET') return this.channels.map(c => ({...c}));
    if (url.pathname === '/api/channels' && method === 'POST') return this.create(body);
    if (parts[0] === 'api' && parts[1] === 'channels' && parts[2]) {
      const c = this.channel(parts[2]), action = parts[3];
      if (action === 'client-ocr') { if (c.source !== 'ocr') throw httpError(409, 'This channel is not a camera channel'); return this.ingest(c, body); }
      if (action === 'observations') { if (c.source === 'ocr') throw httpError(403, 'Use OCR endpoint for camera channels'); return this.ingest(c, body); }
      if (action === 'snapshot') return this.snapshot(c);
      if (action === 'train' || action === 'import') throw httpError(409, 'Local mode: model training/CSV import needs the Colab backend. 本機模式不做訓練／匯入，請連線後端。');
    }
    throw httpError(404, `Not available in local mode: ${url.pathname}`);
  }
  create(spec) {
    if (this.channels.length >= 3) throw httpError(409, 'Maximum 3 channels per session');
    const interval = Number(spec.interval), minimum = Number(spec.minimum), maximum = Number(spec.maximum);
    if (!spec.name || !/^[a-z0-9_-]{1,40}$/.test(spec.item_key || '')) throw httpError(422, 'Name and item key (a-z, 0-9, _ -) are required');
    if (!(interval >= .5 && interval <= 600)) throw httpError(422, 'Sampling interval must be 0.5–600 s');
    if (!(minimum < maximum)) throw httpError(422, 'minimum must be below maximum');
    const id = crypto.randomUUID().replaceAll('-', ''), channel = {id, epoch: this.clock(), confidence: .9, ...spec, interval, minimum, maximum};
    this.channels.push(channel); this.observations.set(id, []); this.save(id);
    return {...channel};
  }
  /* Same sampling-grid, idempotency and validation rules as the server. */
  ingest(c, body) {
    const rows = this.observations.get(c.id), now = this.clock();
    const existing = rows.find(r => r.event_id === body.event_id); if (existing) return existing;
    if (body.captured_at > now + 2 || body.captured_at < now - 60) throw httpError(422, 'Capture time stale or in future');
    const tick = Math.round((body.captured_at - c.epoch) / c.interval);
    if (Math.abs(body.captured_at - (c.epoch + tick * c.interval)) > .45 * c.interval) throw httpError(422, 'Capture outside sampling grid tolerance');
    if (rows.length && tick <= rows.at(-1).tick) throw httpError(409, 'Duplicate or out-of-order sample');
    for (const r of body.readings || []) if (typeof r.text !== 'string' || !(r.confidence >= 0 && r.confidence <= 1)) throw httpError(422, 'Invalid reading');
    const previous = [...rows].reverse().find(r => r.value != null);
    const {value, status} = validateReadings(c, body, previous ? [previous.captured_at, previous.value] : null);
    const row = {id: (rows.at(-1)?.id || 0) + 1, channel_id: c.id, event_id: body.event_id, tick, captured_at: body.captured_at, received_at: now, value, status, raw: body};
    rows.push(row); if (rows.length > MAX_POINTS) rows.splice(0, rows.length - MAX_POINTS);
    this.save(c.id);
    return row;
  }
  snapshot(c) {
    return {channel: {...c}, observations: this.observations.get(c.id).slice(-600), forecasts: [], metrics: [],
      models: {local: true, saveError: this.saveError?.message || null}, server_time: this.clock()};
  }
  /* Every reading with raw OCR text, final value and reason, for checking data on the phone. */
  csv(id) {
    const c = this.channel(id), quote = v => `"${String(v ?? '').replaceAll('"', '""')}"`, safe = v => typeof v === 'string' && /^[=+\-@]/.test(v) && !NUMBER.test(v) ? `'${v}` : v;
    const header = ['tick', 'captured_at', 'local_time', 'value', 'status', 'raw_ocr', 'numeric_text', 'unit_seen', 'confidence', 'client_status', 'tracking', 'tracking_confidence', 'name', 'item_key', 'unit', 'interval_s'];
    const lines = this.observations.get(id).map(r => {
      const readings = r.raw?.readings || [], join = f => readings.map(f).join(' | ');
      return [r.tick, r.captured_at, new Date(r.captured_at * 1000).toISOString(), r.value, r.status, join(x => x.raw_text ?? ''), join(x => x.text),
        join(x => x.unit ?? ''), join(x => x.confidence?.toFixed(3)), join(x => x.client_status ?? ''), r.raw?.tracking, r.raw?.tracking_confidence, c.name, c.item_key, c.unit, c.interval];
    });
    return '﻿' + [header, ...lines].map(row => row.map(v => quote(safe(v))).join(',')).join('\r\n');
  }
}
