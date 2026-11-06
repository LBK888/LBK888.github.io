import {modelColor, finite, defaultLimits, assess, parseJoin} from './alerts.js';
import {drawChart} from './chart.js';
import {PHONE_MODELS, SERVER_MODELS, DEFAULT_PARAMS, ChannelForecaster, mergeServerRows, latestGroups, pastLine, scoreForecasts} from './forecast.js';
import {DemoSource, demoSchema} from './demo.js';

const $ = id => document.getElementById(id);
const ALL_MODELS = [...PHONE_MODELS, ...SERVER_MODELS];
const MAX_ROWS = 600, MAX_FRAMES = 300, MAX_LAG = 3;
// Per-phone conveniences only; the page works the same if storage is blocked.
const saved = {
  get(key, fallback) { try { const v = localStorage.getItem('waterlab.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('waterlab.' + key, JSON.stringify(value)); } catch {} },
  del(key) { try { localStorage.removeItem('waterlab.' + key); } catch {} },
};
const state = {
  source: null, info: null, schema: null, channels: [], interval: 1, selected: null,
  history: new Map(), frames: [], forecasters: new Map(), serverLogs: new Map(), limits: new Map(), params: structuredClone(DEFAULT_PARAMS),
  horizon: saved.get('horizon', 10), windowTicks: saved.get('window', 300), accH: saved.get('accH', 'avg'), visible: new Set(saved.get('visible', ALL_MODELS)),
  paused: false, frozenTick: null, frozenAt: null, hover: null, hoverTimer: null, layout: null, renderQueued: false,
  socket: null, generation: 0, base: '', lastMessage: 0, lastSample: 0, lastSeq: -1, lastTick: null, lastAt: null, retry: 0, retryTimer: null, localState: 'idle',
  demo: null, demoTimer: null, setupDismissed: saved.get('setupDismissed', false),
  server: {url: '', code: '', token: '', role: 'student', generation: 0, registered: false, registering: false, runId: null, bindings: new Map(),
    uploadedSeq: -1, dropped: 0, flushing: false, polling: false, clockOffset: 0, obsSince: null, fSince: null, models: new Map(), health: null, status: 'off', retryAt: 0},
};

function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function chip(id, kind, text) { $(`chip-${id}`).className = `chip ${kind}`; $(`${id}-state`).textContent = text; }
const deviceKey = () => state.info ? `${state.info.device_id}/${state.info.boot_id}` : '';
const selected = () => state.channels.find(c => c.id === state.selected);
const serverNow = () => Date.now() / 1000 + state.server.clockOffset;
const fresh = () => Date.now() - state.lastSample < Math.max(3000, state.interval * 3000);
const viewTick = () => state.paused ? state.frozenTick : state.lastTick;

async function request(base, path, {method = 'GET', body, token = '', timeout = 10000} = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(base + path, {method, signal: controller.signal, cache: 'no-store',
      headers: {...(body ? {'Content-Type': 'application/json'} : {}), ...(token ? {Authorization: `Bearer ${token}`} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
    if (!r.ok) { const data = await r.json().catch(() => null); const error = new Error(data?.detail || `HTTP ${r.status}`); error.status = r.status; throw error; }
    return await r.json();
  } catch (e) { if (e.name === 'AbortError') throw new Error('Request timed out'); throw e; }
  finally { clearTimeout(timer); }
}

// ---------- Device / data source ----------
function startDevice(info, schema, source) {
  state.source = source; state.info = info; state.schema = schema; state.interval = schema.sample_interval_ms / 1000;
  state.channels = schema.channels.filter(c => c.type === 'number').slice(0, 6).map(c => ({...c, unit: c.unit || ''}));
  for (const map of [state.history, state.forecasters, state.serverLogs, state.limits]) map.clear();
  Object.assign(state, {frames: [], lastSeq: -1, lastTick: null, lastAt: null, lastSample: 0, frozenTick: null, hover: null});
  if (!state.channels.some(c => c.id === state.selected)) state.selected = state.channels[0]?.id;
  state.channels.forEach((c, i) => {
    state.history.set(c.id, []); state.serverLogs.set(c.id, new Map()); state.limits.set(c.id, defaultLimits(c, null));
    state.forecasters.set(c.id, new ChannelForecaster({decimals: c.decimals ?? 2, horizon: state.horizon, params: state.params, seed: 7 + i}));
  });
  resetServerRun();
  $('device-name').textContent = info.device_id;
  $('device-detail').textContent = info.demo ? '· generated on this phone' : `· ${info.wifi?.ssid || 'local device'} · CH ${info.wifi?.channel ?? '—'} · boot ${info.boot_id}`;
  $('limit-channel').replaceChildren(...state.channels.map(c => new Option(`${c.name} (${c.unit})`, c.id)));
  $('device-interval').value = String(schema.sample_interval_ms);
  fillLimits(); buildToggles(); syncParams(); render();
}

function receiveSample(m) {
  if (m.device_id !== state.info?.device_id || m.boot_id !== state.info?.boot_id || m.schema_version !== state.schema?.schema_version) {
    if (state.source === 'esp32') { notice('The ESP32 restarted or changed — reloading its settings.'); connectLocal(state.base).catch(e => notice(e.message, true)); }
    return;
  }
  if (!Number.isSafeInteger(m.seq) || !Number.isSafeInteger(m.uptime_ms) || m.seq <= state.lastSeq || !m.data) return;
  if (state.channels.some(c => !(c.id in m.data) || (m.data[c.id] !== null && !finite(m.data[c.id])))) { notice('Ignored an invalid sample from the device.', true); return; }
  const tick = Math.round(m.uptime_ms / state.schema.sample_interval_ms);
  if (state.lastTick !== null && tick <= state.lastTick) return;
  const at = m.received_at ?? serverNow();
  state.lastSeq = m.seq; state.lastSample = Date.now(); $('sequence').textContent = `SEQ ${m.seq}`;
  for (const c of state.channels) {
    const quality = m.quality?.[c.id], valid = (quality === undefined || quality === 'VALID') && finite(m.data[c.id]);
    const value = valid ? m.data[c.id] : null, rows = state.history.get(c.id);
    // Lost ticks become explicit gaps (never values), so the chart and CSV show them.
    if (state.lastTick !== null) for (let t = Math.max(state.lastTick + 1, tick - MAX_ROWS); t < tick; t++) rows.push({tick: t, value: null, status: 'MISSING', at: null});
    rows.push({tick, value, status: valid ? 'VALID' : quality && quality !== 'VALID' ? quality : 'SENSOR_ERROR', at});
    while (rows.length > MAX_ROWS) rows.shift();
    state.forecasters.get(c.id).push(tick, value, at);
    if (!state.limits.get(c.id) && finite(value)) state.limits.set(c.id, defaultLimits(c, value));
  }
  state.lastTick = tick; state.lastAt = at;
  const {type, protocol_version = '1.0', device_id, boot_id, schema_version, seq, uptime_ms, data, quality = {}} = m;
  state.frames.push({type, protocol_version, device_id, boot_id, schema_version, seq, uptime_ms, data, quality, received_at: at});
  if (state.frames.length > MAX_FRAMES) state.frames.shift();
  scheduleRender();
}

function stopDemo() { clearInterval(state.demoTimer); state.demoTimer = null; state.demo = null; }
function stopLocal() { ++state.generation; clearTimeout(state.retryTimer); if (state.socket) { state.socket.onclose = null; state.socket.close(); state.socket = null; } }

function startDemo() {
  stopLocal(); stopDemo();
  const demo = new DemoSource({intervalMs: Number($('demo-interval').value), scenario: $('demo-scenario').value, missing: $('demo-missing').value});
  state.demo = demo; startDevice(demo.info(), demoSchema(demo.intervalMs), 'demo');
  // Back-dated prefill (≈4 minutes) so forecasts and accuracy appear at once.
  const count = Math.min(240, Math.round(240000 / demo.intervalMs)), now = serverNow();
  for (let i = 0; i < count; i++) { const f = demo.next(); if (f) receiveSample({...f, received_at: now - (count - i) * demo.intervalMs / 1000}); }
  state.demoTimer = setInterval(() => { const f = demo.next(); if (f) receiveSample(f); }, demo.intervalMs);
  saved.set('demo', {scenario: $('demo-scenario').value, missing: $('demo-missing').value, interval: $('demo-interval').value});
  selectSource('demo'); notice('Demo data: generated on this phone. Labels show DEMO; no hardware reading.');
}

async function connectLocal(url) {
  if (state.source === 'demo') state.source = null;
  stopDemo();
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Use the ESP32 address, e.g. http://192.168.51.1');
  if (location.protocol === 'https:' && parsed.protocol === 'http:') throw new Error('Open this page from the ESP32 itself (http://192.168.5X.1): an HTTPS page cannot reach a local HTTP device.');
  stopLocal(); state.base = parsed.origin; $('local-url').value = state.base; selectSource('esp32');
  const gen = state.generation; state.localState = 'connecting'; renderStatus();
  try {
    const info = await request(state.base, '/api/v1/info'), schema = await request(state.base, '/api/v1/schema');
    if (gen !== state.generation) return;
    if (info.protocol_version !== '1.0' || !Array.isArray(schema.channels) || !finite(schema.sample_interval_ms) || schema.sample_interval_ms < 500) throw new Error('Unsupported ESP32 firmware (protocol 1.0 expected)');
    if (state.source !== 'esp32' || deviceKey() !== `${info.device_id}/${info.boot_id}` || JSON.stringify(schema) !== JSON.stringify(state.schema)) startDevice(info, schema, 'esp32');
    const ws = new URL('/api/v1/ws', state.base); ws.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(ws); state.socket = socket;
    socket.onopen = () => { if (gen !== state.generation) return; state.retry = 0; state.lastMessage = Date.now(); state.localState = 'live'; notice('Sensor connected.'); renderStatus(); };
    socket.onmessage = event => {
      if (gen !== state.generation) return;
      state.lastMessage = Date.now();
      try { const m = JSON.parse(event.data); if (m.type === 'sample') receiveSample(m); } catch (e) { notice(`Device message: ${e.message}`, true); }
    };
    socket.onclose = () => { if (gen !== state.generation) return; state.localState = 'reconnecting'; scheduleReconnect(gen); renderStatus(); };
    socket.onerror = () => { state.localState = 'error'; renderStatus(); };
    request(state.base, '/api/v1/snapshot').then(m => { if (gen === state.generation && m.type === 'sample') receiveSample(m); }).catch(() => {});
    pollStatus(gen);
  } catch (e) {
    if (gen === state.generation) { state.localState = 'offline'; renderStatus(); notice(`ESP32: ${e.message}`, true); scheduleReconnect(gen); }
  }
}
function scheduleReconnect(gen) {
  clearTimeout(state.retryTimer); const delay = Math.min(8000, 1000 * 2 ** state.retry++);
  state.retryTimer = setTimeout(() => { if (gen === state.generation && state.source !== 'demo') connectLocal(state.base).catch(e => notice(e.message, true)); }, delay);
}
async function pollStatus(gen = state.generation) {
  if (state.source !== 'esp32' || !state.base) return;
  try {
    const s = await request(state.base, '/api/v1/status', {timeout: 4000}); if (gen !== state.generation) return;
    const r = s.client_rssi_dbm;
    $('signal').textContent = finite(r) ? `RSSI ${r} dBm · ${r >= -60 ? 'strong' : r >= -75 ? 'fair' : 'weak'}` : 'RSSI unavailable';
    $('clients').textContent = `Phones ${s.wifi_clients ?? '—'} / ${s.max_clients ?? 8}`;
  } catch { if (gen === state.generation) $('signal').textContent = 'RSSI unavailable'; }
}
async function applyDeviceInterval() {
  if (state.source !== 'esp32') throw new Error('Connect an ESP32 first (or change the demo interval below).');
  const interval_ms = Number($('device-interval').value);
  if (interval_ms === state.schema.sample_interval_ms) return notice('The ESP32 already uses this interval.');
  // text/plain keeps this a "simple" request (no CORS preflight the ESP32 would have to answer).
  const r = await fetch(state.base + '/api/v1/config', {method: 'POST', headers: {'Content-Type': 'text/plain'}, body: JSON.stringify({interval_ms, pin: $('device-pin').value})});
  if (r.status === 404 || r.status === 405) throw new Error('This firmware cannot change the interval remotely. Use the serial commands "interval 2000" then "reboot".');
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    let detail = text; try { detail = JSON.parse(text).detail ?? text; } catch {}
    throw new Error(`ESP32 refused: ${String(detail).slice(0, 120) || `HTTP ${r.status}`}`);
  }
  notice('The ESP32 is restarting with the new interval; this page reconnects by itself.');
}
function selectSource(kind) {
  for (const input of document.querySelectorAll('input[name=source]')) input.checked = input.value === kind;
  $('esp32-box').hidden = kind !== 'esp32'; $('demo-box').hidden = kind !== 'demo';
}

// ---------- Forecast server ----------
function resetServerRun() {
  Object.assign(state.server, {registered: false, runId: null, uploadedSeq: -1, obsSince: null, fSince: null});
  state.server.bindings.clear(); state.server.models.clear();
}
async function joinServer() {
  const s = state.server, r = await request(s.url, '/api/sessions', {method: 'POST', body: {code: s.code}});
  s.token = r.token; s.role = r.role; s.registered = false;
  saved.set('session', {url: s.url, code: s.code, token: r.token, role: r.role});
}
async function cloud(path, options = {}, retry = true) {
  const s = state.server;
  try { return await request(s.url, path, {...options, token: s.token}); }
  catch (e) {
    if (e.status === 401 && retry && s.code) { await joinServer(); if (path !== '/api/devices/register') await registerDevice(); return cloud(path, options, false); }
    throw e;
  }
}
async function connectServer(url, code) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('The server link must start with https://');
  if (!code) throw new Error('Enter the class code (課堂代碼).');
  const s = state.server, gen = ++s.generation;
  Object.assign(s, {url: parsed.origin + parsed.pathname.replace(/\/+$/, ''), code, token: '', status: 'connecting', health: null});
  resetServerRun(); for (const log of state.serverLogs.values()) log.clear(); renderStatus();
  try {
    const health = await request(s.url, '/api/health'); if (gen !== s.generation) return;
    s.health = health; s.clockOffset = health.server_time - Date.now() / 1000; $('internet-state').textContent = 'Internet ✓';
    const session = saved.get('session', null);
    if (session?.url === s.url && session.code === code) { s.token = session.token; s.role = session.role; } else await joinServer();
    if (gen !== s.generation) return;
    saved.set('server', {url: s.url, code}); $('server-url').value = s.url; $('class-code').value = code;
    s.status = 'on'; s.retryAt = 0; buildToggles();
    await registerDevice();
    notice(`Server connected${s.role === 'ta' ? ' as TA' : ''}. RNN / LSTM / Chronos‑2 forecasts appear when ready.`);
  } catch (e) { if (gen === s.generation) serverFailure(e); throw e; }
  finally { renderStatus(); }
}
function disconnectServer(forget = false) {
  const s = state.server; ++s.generation;
  Object.assign(s, {url: '', token: '', role: 'student', status: 'off', health: null}); resetServerRun();
  for (const log of state.serverLogs.values()) log.clear();
  if (forget) { saved.del('server'); saved.del('session'); $('server-url').value = ''; $('class-code').value = ''; }
  buildToggles(); render();
}
function serverFailure(error) {
  const s = state.server;
  s.status = error.status === 403 ? 'denied' : 'retrying';
  notice(`Server: ${error.message}. Phone forecasts continue.`, true); renderStatus();
}
async function registerDevice() {
  const s = state.server;
  if (!s.token || !state.info || s.registered || s.registering) return;
  const gen = s.generation, key = deviceKey(); s.registering = true;
  try {
    const body = {protocol_version: '1.0', device_id: state.info.device_id, boot_id: state.info.boot_id, schema_version: state.schema.schema_version, sample_interval_ms: state.schema.sample_interval_ms,
      channels: state.channels.map(c => ({id: c.id, name: c.name, type: 'number', item_key: c.item_key || c.id.toLowerCase(), unit: c.unit || '', decimals: c.decimals ?? 2, minimum: c.minimum ?? -1000, maximum: c.maximum ?? 1000}))};
    if (state.source === 'demo') body.simulated = true;
    const r = await cloud('/api/devices/register', {method: 'POST', body});
    if (gen !== s.generation || key !== deviceKey()) return;
    s.bindings = new Map(r.channels.map(c => [c.sensor_id, c.id])); s.runId = r.run_id; s.registered = true; s.uploadedSeq = -1;
  } finally { s.registering = false; }
}
// Upload every frame newer than the last acknowledged one. A new phone also back-fills the
// last 300 frames; the server stores each ESP32 sample once, however many phones send it.
async function flush() {
  const s = state.server;
  if (s.flushing || !s.token || !state.info || s.status === 'denied') return;
  s.flushing = true;
  try {
    if (!s.registered) await registerDevice();
    if (!s.registered) return;
    const pending = state.frames.filter(f => f.seq > s.uploadedSeq);
    if (pending.length) {
      const batch = pending.slice(0, 32), gen = s.generation, key = deviceKey();
      const r = await cloud('/api/devices/samples', {method: 'POST', body: {samples: batch}});
      if (gen !== s.generation || key !== deviceKey()) return;
      s.uploadedSeq = Math.max(s.uploadedSeq, batch.at(-1).seq);
      const bad = r.results.filter(p => p.status === 'REJECTED');
      if (bad.length) {
        s.dropped += bad.length;
        if (bad.some(p => p.code === 403)) s.registered = false;
        notice(`Upload: ${bad[0].detail || bad[0].status} (${bad.length} samples)`, true);
      }
    }
    s.status = 'on';
    await poll();
  } catch (e) { serverFailure(e); }
  finally { s.flushing = false; }
}
async function poll() {
  const s = state.server;
  if (s.polling || !s.token || !s.registered) return;
  const gen = s.generation, key = deviceKey(); s.polling = true;
  try {
    const q = new URLSearchParams({count: String(Math.min(600, state.windowTicks)), models: SERVER_MODELS.join(',')});
    if (s.obsSince !== null) q.set('since', s.obsSince);
    if (s.fSince !== null) q.set('fsince', s.fSince);
    const r = await cloud(`/api/devices/runs/${s.runId}/snapshot?${q}`);
    if (gen !== s.generation || key !== deviceKey()) return;
    for (const [id, snap] of Object.entries(r.channels)) {
      if (!state.history.has(id)) continue;
      mergeObservations(id, snap.observations);
      const latest = mergeServerRows(state.serverLogs.get(id), snap.forecasts ?? []);
      if (latest !== null) s.fSince = Math.max(s.fSince ?? latest, latest);
      for (const o of snap.observations) s.obsSince = Math.max(s.obsSince ?? o.tick, o.tick);
      s.models.set(id, snap.models);
    }
    scheduleRender();
  } finally { s.polling = false; }
}
// Server rows fill this phone's gaps and, on first join, the history before the page opened.
function mergeObservations(id, observations) {
  if (!observations?.length) return;
  const rows = state.history.get(id), index = new Map(rows.map(r => [r.tick, r])), first = rows[0]?.tick ?? Infinity, older = [];
  for (const o of observations) {
    const value = finite(o.value) ? o.value : null, row = index.get(o.tick);
    if (row) { if (row.status === 'MISSING' && value !== null) Object.assign(row, {value, status: 'VALID'}); }
    else if (o.tick < first) older.push({tick: o.tick, value, status: value === null ? o.status || 'SENSOR_ERROR' : 'VALID', at: o.captured_at});
  }
  if (!older.length) return;
  older.sort((a, b) => a.tick - b.tick);
  const merged = [];
  for (const r of [...older, ...rows]) {
    const last = merged.at(-1);
    if (last) for (let t = last.tick + 1; t < r.tick; t++) merged.push({tick: t, value: null, status: 'MISSING', at: null});
    merged.push(r);
  }
  rows.splice(0, rows.length, ...merged.slice(-MAX_ROWS));
  const f = state.forecasters.get(id);
  f.rows = rows.filter(r => r.status !== 'MISSING').map(r => ({tick: r.tick, value: r.value, at: r.at ?? 0}));
  f.replay();
}

// ---------- Rendering ----------
function scheduleRender() { if (!state.renderQueued) { state.renderQueued = true; requestAnimationFrame(() => { state.renderQueued = false; render(); }); } }
function logsFor(id, models = state.visible) {
  const logs = new Map();
  for (const [m, log] of state.forecasters.get(id)?.log ?? []) if (models.has(m)) logs.set(m, log);
  for (const [m, log] of state.serverLogs.get(id) ?? []) if (models.has(m) && state.server.url) logs.set(m, log);
  return logs;
}
function actualMap(id) { const map = new Map(); for (const r of state.history.get(id) ?? []) if (finite(r.value)) map.set(r.tick, r.value); return map; }
function groupsNow(id) {
  if (!fresh() || state.lastTick === null) return [];
  return latestGroups(logsFor(id), state.lastTick, serverNow(), state.horizon).filter(g => g.lag <= MAX_LAG);
}
const dark = () => document.documentElement.dataset.theme === 'dark';
const colorOf = m => modelColor(m, dark());
const fixed = (v, d) => finite(v) ? v.toFixed(d) : '—';

function renderStatus() {
  const s = state.server;
  if (state.source === 'demo') chip('source', 'ok', 'Demo data');
  else if (state.source === 'esp32' || state.localState !== 'idle') {
    const map = {live: fresh() ? ['ok', 'Live'] : ['wait', 'No data'], connecting: ['wait', 'Connecting…'], reconnecting: ['wait', 'Reconnecting…'], offline: ['bad', 'Offline'], error: ['bad', 'Error']};
    chip('source', ...(map[state.localState] || ['', 'Not connected']));
  } else chip('source', '', 'Not connected');
  const sv = {off: ['', 'Phone only'], connecting: ['wait', 'Connecting…'], on: s.registered ? ['ok', s.role === 'ta' ? 'TA' : 'Connected'] : ['wait', 'Signing in…'], retrying: ['wait', 'Retrying…'], denied: ['bad', 'Code rejected']};
  chip('server', ...(sv[s.status] || sv.off));
  $('rate-state').textContent = state.schema ? `${+state.interval.toFixed(2)} s/sample` : '— s';
  $('role-state').textContent = s.token ? `Signed in as ${s.role === 'ta' ? 'TA' : 'student'}` : 'Not signed in';
  const pending = s.token ? state.frames.filter(f => f.seq > s.uploadedSeq).length : 0;
  $('queue').textContent = `Queue ${pending}${s.dropped ? ` · rejected ${s.dropped}` : ''}`;
  $('ta-tools').hidden = s.role !== 'ta' || !s.token;
  for (const id of ['train', 'import-train', 'export-readings', 'export-forecasts']) $(id).disabled = !s.registered;
  const setup = !state.source || (!s.url && !state.setupDismissed);
  $('setup').hidden = !setup; $('setup-source').hidden = !!state.source; $('setup-server').hidden = !!s.url || !state.source || state.setupDismissed;
}

function render() {
  renderStatus();
  $('updated').textContent = state.lastSample ? `${new Date(state.lastSample).toLocaleTimeString([], {hour12: false})} · every ${+state.interval.toFixed(2)} s` : 'No data yet';
  if (!state.channels.length) return;
  renderCards(); renderChart(); renderAccuracy(); renderServerModels();
  if ($('learn').open) syncParams();
}

function bestModel(id) {
  const scores = scoreForecasts(logsFor(id), actualMap(id), {h: 'avg', H: state.horizon, fromTick: (state.lastTick ?? 0) - state.windowTicks + 1, common: false});
  return scores.filter(s => s.n >= 20).sort((a, b) => a.mae - b.mae)[0]?.model ?? null;
}
function renderCards() {
  const container = $('readings'), existing = new Map([...container.children].map(b => [b.dataset.channel, b]));
  const cards = state.channels.map(c => {
    const row = state.history.get(c.id)?.at(-1), live = fresh(), limits = state.limits.get(c.id), groups = groupsNow(c.id);
    const a = assess(live ? row?.value : null, limits, groups, {window: Math.min(10, state.horizon), maxLag: MAX_LAG});
    const button = existing.get(c.id) || Object.assign(document.createElement('button'), {type: 'button'});
    button.dataset.channel = c.id; button.className = `reading ${a.state} ${state.selected === c.id ? 'selected' : ''}`;
    button.setAttribute('aria-pressed', String(state.selected === c.id));
    const d = c.decimals ?? 2, best = bestModel(c.id), next = groups.find(g => g.model === best) || groups.find(g => g.model === 'Kalman');
    const end = next?.points.at(-1), delta = end && finite(row?.value) ? end.prediction - row.value : null;
    const parts = [['reading-name', c.name], ['value', finite(row?.value) ? row.value.toFixed(d) : '—'], ['state-label', !live ? 'No recent data' : a.label],
      ['next', end ? `In ${+(state.horizon * state.interval).toFixed(1)} s ${delta > 0 ? '↗' : delta < 0 ? '↘' : '→'} ${end.prediction.toFixed(d)} (${next.model})` : 'Forecast: warming up'],
      ['limits', limits ? `Limits ${limits.lower ?? '—'} – ${limits.upper ?? '—'} ${c.unit}` : 'Limits: after first reading']];
    button.replaceChildren(...parts.map(([cls, text]) => Object.assign(document.createElement('span'), {className: cls, textContent: text})));
    button.querySelector('.value').append(Object.assign(document.createElement('small'), {textContent: c.unit}));
    button.setAttribute('aria-label', `${c.name}: ${row?.value ?? 'no data'} ${c.unit}, ${a.label}`);
    button.onclick = () => { state.selected = c.id; state.hover = null; $('limit-channel').value = c.id; fillLimits(); render(); };
    return button;
  });
  if (cards.length !== container.children.length || cards.some((b, i) => b !== container.children[i])) container.replaceChildren(...cards);
}

function pastStep() { return state.accH === 'avg' ? Math.ceil(state.horizon / 2) : Math.min(Number(state.accH), state.horizon); }
function renderChart() {
  const c = selected(); if (!c) return;
  const view = viewTick(), logs = logsFor(c.id), rows = state.history.get(c.id) || [], limits = state.limits.get(c.id), d = c.decimals ?? 2;
  const asOf = state.paused ? state.frozenAt : serverNow();
  const groups = view === null ? [] : latestGroups(logs, view, asOf ?? Infinity, state.horizon);
  const from = (view ?? 0) - state.windowTicks + 1, h = pastStep();
  const past = $('historical').checked && view !== null ? [...logs].map(([model, log]) => ({model, points: pastLine(log, h, from, view)})) : [];
  $('chart-title').textContent = `${c.name} (${c.unit})`;
  state.layout = drawChart($('chart'), {history: rows, groups, past, pastH: h, limits, unit: c.unit, decimals: d, interval: state.interval,
    windowTicks: state.windowTicks, horizon: state.horizon, now: view, anchor: state.paused ? state.frozenAt : state.lastAt, colorOf, hover: state.hover, frozen: state.paused});
  const inWindow = rows.filter(r => r.tick >= from && r.tick <= (view ?? 0));
  const missing = inWindow.filter(r => r.status === 'MISSING').length, errors = inWindow.filter(r => r.value === null && r.status !== 'MISSING').length;
  $('gap-stats').textContent = inWindow.length ? `Missing ${missing} · sensor errors ${errors} · of ${inWindow.length} samples${$('historical').checked ? ` · past line = ${h}-step forecasts` : ''}` : '';
  // Alert text always describes the live situation, also while the chart is paused.
  const live = fresh(), row = rows.at(-1), now = groupsNow(c.id);
  const a = assess(live ? row?.value : null, limits, now, {window: Math.min(10, state.horizon), maxLag: MAX_LAG}), detail = [];
  if (a.state === 'danger') detail.push('Outside the alarm limits now.');
  if (a.crossing.length) detail.push(`Forecast crosses a limit: ${a.crossing.join(', ')}.`);
  for (const r of a.rapid) detail.push(`${r.model}: ${r.zero ? 'current value is 0, so the % change is undefined — check by eye' : `next ${Math.min(10, state.horizon)} forecasts change ${(r.ratio * 100).toFixed(1)}% (Δ ${r.range.toFixed(d)} ${c.unit})`}.`);
  const idle = !live ? 'No recent data — alerts cannot be judged.' : !finite(row?.value) ? 'Sensor value invalid — alerts cannot be judged.'
    : now.length ? 'Current value and forecasts are within limits.' : 'Alarms on. Forecasts start after a few samples.';
  $('alert-detail').textContent = (state.paused ? 'Chart paused (data still recording). ' : '') + (detail.join(' ') || idle);
  $('alert-detail').className = `alert-detail ${a.state}`;
}

function renderAccuracy() {
  const c = selected(); if (!c) return;
  const view = state.lastTick ?? 0, d = (c.decimals ?? 2) + 1;
  const scores = scoreForecasts(logsFor(c.id), actualMap(c.id), {h: state.accH === 'avg' ? 'avg' : Number(state.accH), H: state.horizon, fromTick: view - state.windowTicks + 1, common: $('common').checked})
    .sort((a, b) => ALL_MODELS.indexOf(a.model) - ALL_MODELS.indexOf(b.model));
  const best = scores.filter(s => s.n).sort((a, b) => a.mae - b.mae)[0]?.model;
  const body = $('metrics'); body.replaceChildren();
  for (const s of scores) {
    const tr = document.createElement('tr'); if (s.model === best && s.n) tr.className = 'best';
    const name = document.createElement('td'), sw = document.createElement('span');
    sw.className = 'swatch'; sw.style.background = colorOf(s.model);
    name.append(sw, s.model, Object.assign(document.createElement('span'), {className: 'tag', textContent: s.source === 'server' ? 'server' : 'phone'}));
    const skill = document.createElement('td');
    skill.textContent = s.skill === null ? '—' : `${s.skill > 0 ? '+' : ''}${(s.skill * 100).toFixed(0)}%`; skill.className = s.skill > 0 ? 'pos' : s.skill < 0 ? 'neg' : '';
    tr.append(name, ...[s.n, s.n ? fixed(s.mae, d) : 'warming up', fixed(s.rmse, d), s.smape === null ? '—' : `${s.smape.toFixed(2)}%`].map(v => Object.assign(document.createElement('td'), {textContent: v})), skill);
    body.append(tr);
  }
  if (!scores.some(s => s.n)) {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan = 6; td.textContent = 'Collecting… a forecast is scored once its target time arrives.'; tr.append(td); body.append(tr);
  }
  const step = state.accH === 'avg' ? `steps 1–${state.horizon}` : `${state.accH}-step`;
  $('acc-note').textContent = `${step} forecasts over the last ${state.windowTicks} samples${best ? ` · best now: ${best}` : ''}. Skill = 1 − MAE ÷ MAE of Persistence: above 0% beats “no change”. MAE/RMSE in ${c.unit}.`;
}

function renderServerModels() {
  const s = state.server, c = selected();
  if (!s.url) { $('server-models').textContent = 'Server models: not connected — phone models only.'; return; }
  const m = c && s.models.get(c.id);
  if (!m) { $('server-models').textContent = 'Server models: waiting for the first snapshot…'; return; }
  const parts = Object.entries(m.models || {}).map(([name, v]) => `${name}: ${v.state}${finite(v.val_mae) ? ` (val MAE ${v.val_mae.toFixed(3)} vs naive ${finite(v.baseline_mae) ? v.baseline_mae.toFixed(3) : '—'})` : ''}`);
  const ft = m.finetune ? ` · fine-tune: ${m.finetune.state}${m.finetune.new_points !== undefined ? ` (${m.finetune.new_points}/${m.finetune.every} new samples)` : ''}` : '';
  $('server-models').textContent = `Server models — ${parts.join(' · ') || 'none'}${ft}`;
}

function buildToggles() {
  const models = [...PHONE_MODELS, ...(state.server.url ? SERVER_MODELS : [])];
  $('models').replaceChildren(...models.map(model => {
    const label = document.createElement('label'), input = document.createElement('input'), sw = document.createElement('span');
    input.type = 'checkbox'; input.checked = state.visible.has(model);
    input.onchange = () => { input.checked ? state.visible.add(model) : state.visible.delete(model); saved.set('visible', [...state.visible]); render(); };
    sw.className = 'swatch'; label.style.color = colorOf(model);
    const text = Object.assign(document.createElement('span'), {textContent: model}); text.style.color = 'var(--ink)';
    label.append(input, sw, text, Object.assign(document.createElement('em'), {textContent: SERVER_MODELS.includes(model) ? 'server' : 'phone'}));
    return label;
  }));
}
function buildStepOptions() {
  const select = $('acc-h'), options = [new Option(`Avg 1–${state.horizon}`, 'avg')];
  for (let h = 1; h <= state.horizon; h++) options.push(new Option(`${h}`, String(h)));
  select.replaceChildren(...options);
  if (state.accH !== 'avg' && Number(state.accH) > state.horizon) state.accH = 'avg';
  select.value = String(state.accH);
}
function fillLimits() {
  const c = state.channels.find(c => c.id === $('limit-channel').value) || selected(); if (!c) return;
  const limits = state.limits.get(c.id);
  $('lower').value = limits?.lower ?? ''; $('upper').value = limits?.upper ?? ''; $('limit-origin').textContent = limits?.origin ?? 'First valid reading sets a ±20% baseline';
}

// ---------- Model parameters (How the models work) ----------
// Sliders show the selected reading's parameters, including values chosen by "Auto".
function syncParams() {
  const source = state.forecasters.get(state.selected)?.params ?? state.params;
  for (const box of document.querySelectorAll('.params[data-model]')) {
    const model = box.dataset.model, params = source[model];
    for (const input of box.querySelectorAll('[data-param]')) {
      if (input === document.activeElement && input.type !== 'checkbox') continue;
      const value = params[input.dataset.param];
      if (input.type === 'checkbox') input.checked = !!value;
      else { input.value = input.hasAttribute('data-log') ? Math.log10(value) : value; input.previousElementSibling.textContent = (+value).toPrecision(3).replace(/\.?0+$/, ''); }
    }
  }
}
function applyParam(model, name, value) {
  const update = {[name]: value};
  if (name !== 'auto' && 'auto' in state.params[model]) update.auto = false;   // moving a slider = manual mode
  Object.assign(state.params[model], update);
  for (const f of state.forecasters.values()) f.setParams(model, update);
  syncParams(); render();
}
for (const box of document.querySelectorAll('.params[data-model]')) {
  for (const input of box.querySelectorAll('[data-param]')) {
    const read = () => input.type === 'checkbox' ? input.checked : input.hasAttribute('data-log') ? 10 ** Number(input.value) : Number(input.value);
    input.addEventListener('input', () => { if (input.type !== 'checkbox') input.previousElementSibling.textContent = (+read()).toPrecision(3).replace(/\.?0+$/, ''); });
    input.addEventListener('change', () => applyParam(box.dataset.model, input.dataset.param, read()));
  }
}
for (const tab of document.querySelectorAll('[role=tab]')) tab.onclick = () => {
  for (const t of document.querySelectorAll('[role=tab]')) t.setAttribute('aria-selected', String(t === tab));
  for (const p of document.querySelectorAll('.learn')) p.hidden = p.dataset.panel !== tab.dataset.tab;
};

// ---------- Export ----------
function save(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function exportPhone() {
  const c = selected(); if (!c) throw new Error('No reading yet');
  const lines = ['kind,tick,timestamp,value,status,model,source,origin_tick,horizon,prediction'];
  for (const r of state.history.get(c.id)) lines.push(['observation', r.tick, r.at ?? '', r.value ?? '', r.status, '', '', '', '', ''].join(','));
  for (const [model, log] of logsFor(c.id, new Set(ALL_MODELS))) for (const e of log.values()) e.mean.forEach((p, i) => { if (finite(p)) lines.push(['forecast', e.origin + i + 1, '', '', '', model, e.source, e.origin, i + 1, p].join(',')); });
  save(new Blob(['﻿' + lines.join('\n')], {type: 'text/csv'}), `${state.info.device_id}-${c.id}-phone.csv`);
}
async function exportServer(kind) {
  const s = state.server, cid = s.bindings.get(state.selected);
  if (!cid) throw new Error('Connect the server first');
  const r = await fetch(`${s.url}/api/channels/${cid}/export?kind=${kind}`, {headers: {Authorization: `Bearer ${s.token}`}});
  if (!r.ok) throw new Error(`Export HTTP ${r.status}`);
  save(await r.blob(), `${state.info.device_id}-${state.selected}-${kind}.csv`);
}

// ---------- Wiring ----------
const action = fn => event => { event?.preventDefault(); Promise.resolve().then(fn).catch(e => notice(e.message, true)); };
$('start-demo').onclick = action(startDemo);
$('open-source').onclick = () => { selectSource('esp32'); $('source-settings').open = true; $('local-url').focus(); };
$('demo-restart').onclick = action(startDemo);
for (const id of ['demo-scenario', 'demo-missing', 'demo-interval']) $(id).onchange = action(() => { if (state.source === 'demo') startDemo(); });
for (const input of document.querySelectorAll('input[name=source]')) input.onchange = action(() => input.value === 'demo' ? startDemo() : (selectSource('esp32'), $('local-url').focus()));
$('local-form').onsubmit = action(() => connectLocal($('local-url').value || 'http://192.168.51.1'));
$('interval-form').onsubmit = action(applyDeviceInterval);
$('quick-server').onsubmit = action(() => {
  const join = parseJoin($('quick-link').value);
  return connectServer(join.server || $('quick-link').value.trim(), join.code || $('quick-code').value.trim());
});
$('quick-link').addEventListener('input', () => { const j = parseJoin($('quick-link').value); if (j.code) $('quick-code').value = j.code; });
$('setup-skip').onclick = () => { state.setupDismissed = true; saved.set('setupDismissed', true); renderStatus(); };
$('server-form').onsubmit = action(() => { const j = parseJoin($('server-url').value); return connectServer(j.server || $('server-url').value.trim(), $('class-code').value.trim() || j.code); });
$('disconnect-server').onclick = () => { disconnectServer(false); notice('Server disconnected. Phone forecasts continue.'); };
$('forget-server').onclick = () => { disconnectServer(true); notice('Server link and code removed from this phone.'); };
for (const el of document.querySelectorAll('[data-open]')) el.onclick = () => { const d = $(el.dataset.open); d.open = true; d.scrollIntoView({behavior: 'smooth', block: 'start'}); };
$('pause').onclick = () => {
  state.paused = !state.paused; state.frozenTick = state.lastTick; state.frozenAt = state.lastAt;
  $('pause').textContent = state.paused ? 'Live ▶' : 'Pause'; $('pause').setAttribute('aria-pressed', String(state.paused)); render();
};
$('theme').onclick = () => { const next = dark() ? 'light' : 'dark'; document.documentElement.dataset.theme = next; saved.set('theme', next); buildToggles(); render(); };
document.documentElement.dataset.theme = saved.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
$('limits-form').onsubmit = action(() => {
  const lower = $('lower').value === '' ? null : Number($('lower').value), upper = $('upper').value === '' ? null : Number($('upper').value);
  if ((lower !== null && !finite(lower)) || (upper !== null && !finite(upper)) || (finite(lower) && finite(upper) && lower >= upper)) throw new Error('Lower must be below upper; use numbers.');
  state.limits.set($('limit-channel').value, {lower, upper, origin: 'Custom limits (this phone)'}); fillLimits(); render(); notice('Alarm limits updated.');
});
$('limit-channel').onchange = fillLimits;
$('reset-limits').onclick = () => { const c = state.channels.find(c => c.id === $('limit-channel').value); if (c) { state.limits.set(c.id, defaultLimits(c, state.history.get(c.id)?.find(p => finite(p.value))?.value)); fillLimits(); render(); } };
$('window').value = String(state.windowTicks); $('horizon').value = String(state.horizon);
$('window').onchange = () => { state.windowTicks = Number($('window').value); saved.set('window', state.windowTicks); render(); };
$('horizon').onchange = () => { state.horizon = Number($('horizon').value); saved.set('horizon', state.horizon); for (const f of state.forecasters.values()) f.setHorizon(state.horizon); buildStepOptions(); render(); };
$('acc-h').onchange = () => { state.accH = $('acc-h').value === 'avg' ? 'avg' : Number($('acc-h').value); saved.set('accH', state.accH); render(); };
$('common').onchange = render; $('historical').onchange = render;
$('train').onclick = action(async () => {
  const cid = state.server.bindings.get(state.selected); if (!cid) throw new Error('Connect the server first');
  const r = await cloud(`/api/channels/${cid}/train?retrain=true`, {method: 'POST'}); notice(`Fine-tuning: ${r.state}`);
});
$('import-train').onclick = action(async () => {
  const c = selected(), file = $('csv-file').files[0];
  if (!c || !file || state.server.role !== 'ta') throw new Error('TA sign-in and a CSV file are required');
  const r = await cloud('/api/ta/import', {method: 'POST', body: {name: `TA ${c.name}`, item_key: c.item_key || c.id, unit: c.unit, interval: state.interval, decimals: c.decimals ?? 2,
    minimum: c.minimum ?? -1000, maximum: c.maximum ?? 1000, device_id: state.info.device_id, csv: await file.text()}});
  notice(`Imported ${r.imported} rows · fine-tuning: ${r.training?.state ?? 'queued'}`);
});
$('export-local').onclick = action(exportPhone);
$('export-readings').onclick = action(() => exportServer('observations')); $('export-forecasts').onclick = action(() => exportServer('forecasts'));

const canvas = $('chart');
function hoverAt(event) {
  const layout = state.layout; if (!layout) return;
  const t = layout.tickAt(event.clientX - canvas.getBoundingClientRect().left);
  state.hover = Math.max(layout.left, Math.min(layout.right, t));
  clearTimeout(state.hoverTimer); state.hoverTimer = setTimeout(() => { state.hover = null; renderChart(); }, 8000);
  renderChart();
}
canvas.addEventListener('pointerdown', hoverAt);
canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') hoverAt(e); });
canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { state.hover = null; renderChart(); } });
new ResizeObserver(() => renderChart()).observe(canvas);

setInterval(() => {
  if (state.socket?.readyState === WebSocket.OPEN && Date.now() - state.lastMessage > 10000) state.socket.close();
  flush(); render();
}, 1000);
setInterval(() => { pollStatus(); }, 5000);
setInterval(async () => {
  const s = state.server;
  if (!s.url) return;
  try {
    await request(s.url, '/api/health', {timeout: 6000}); $('internet-state').textContent = 'Internet ✓';
    if (!s.token && s.code && Date.now() > s.retryAt) { s.retryAt = Date.now() + 30000; connectServer(s.url, s.code).catch(() => {}); }
  } catch (e) { $('internet-state').textContent = 'Internet ✗ (server unreachable)'; if (s.token) serverFailure(e); }
}, 15000);

// ---------- Start-up: zero clicks on the ESP32 page; join links connect in one tap ----------
buildStepOptions(); buildToggles();
const demoSettings = saved.get('demo', null);
if (demoSettings) { $('demo-scenario').value = demoSettings.scenario; $('demo-missing').value = demoSettings.missing; $('demo-interval').value = demoSettings.interval; }
const params = new URLSearchParams(location.search), link = params.get('server') || params.get('backend');
const remembered = saved.get('server', null);
if (params.get('demo') === '1') startDemo();
else if (location.protocol === 'http:' && /^192\.168\./.test(location.hostname)) connectLocal(location.origin).catch(e => notice(e.message, true));
else { $('local-url').value = 'http://192.168.51.1'; selectSource('esp32'); }
if (link || remembered) {
  const url = link || remembered.url, code = params.get('code') || remembered?.code || '';
  $('server-url').value = url; $('class-code').value = code; $('quick-link').value = url; $('quick-code').value = code;
  if (link) history.replaceState(null, '', location.pathname + (params.get('demo') === '1' ? '?demo=1' : ''));
  if (code) connectServer(url, code).catch(() => {});
}
render();
