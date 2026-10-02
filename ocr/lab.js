import {BrowserOCR, OCR_VERSION} from '../frontend/browser-ocr.js';
import {PanelTracker, roiPolygon, alignedCrop, sharpness} from '../frontend/panel-tracker.js';
import {assessReading, wireReading, validateReadings, decimalsOf} from '../frontend/reading-parser.js';
import {ChannelForecaster, latestGroups, scoreForecasts, PHONE_MODELS} from '../frontend2/forecast.js';
import {modelColor, finite} from '../frontend2/alerts.js';
import {drawChart} from '../frontend2/chart.js';
import {DemoPanel, demoItemFor} from './demo-panel.js';

const LAB_VERSION = 'Panel OCR Lab 1.0';
// Modular page: models and OpenCV from ../frontend/. The single-file build sets its own sources.
globalThis.OCR_ASSET_BASE ??= new URL('../frontend/', import.meta.url).href;
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ACCEPTED = new Set(['VALID', 'AUTO_DECIMAL_RECOVERY']);
const STATUS = {
  VALID: 'Accepted (有效)', AUTO_DECIMAL_RECOVERY: 'Accepted — a missed decimal point was restored from image evidence (補回小數點)',
  DECIMAL_UNCERTAIN: 'Decimal point or number of digits is uncertain (小數點不確定)', UNIT_MISMATCH: 'The unit read differs from the box setting (單位不符)',
  INVALID_FORMAT: 'Not exactly one number (格式不符)', LOW_CONFIDENCE: 'Model confidence below the threshold (信心不足)',
  OCR_CONFLICT: 'Photos disagree: fewer than 2 equal values (多張不一致)', OUT_OF_RANGE: 'Outside the box minimum/maximum (超出範圍)',
  TRUNCATED: 'Digits touch the crop edge — a digit may be cut off (數字被裁切)', TRACKING_ERROR: 'Panel lost — nothing read (追蹤遺失)',
  MISSING: 'No reading (缺值)', RATE_EXCEEDED: 'Changed faster than allowed (變化過快)',
};
const label = s => `${s}${STATUS[s] ? ' — ' + STATUS[s] : ''}`;
const saved = {get(k, d) { try { const v = localStorage.getItem('ocrlab.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('ocrlab.' + k, JSON.stringify(v)); } catch {} }};

// Engine progress messages are internal; the chip shows only the loading state.
const engine = new BrowserOCR(m => chip('ocr', m.progress >= 1 ? 'ok' : 'wait', m.progress >= 1 ? 'Ready' : m.progress > 0 ? `Loading ${Math.round(m.progress * 100)}%` : 'Working…'));
const tracker = new PanelTracker();
const preview = $('preview'), pctx = preview.getContext('2d');
const state = {source: null, stream: null, demo: null, photo: null, rois: [], active: 0, candidates: [], running: false, busy: false, gen: 0,
  t0: 0, lastTick: -1, skipped: 0, roundMs: null, tracking: null, hover: null, layout: null, horizon: saved.get('horizon', 5), visible: new Set(PHONE_MODELS)};

function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); }
function chip(id, kind, text) { const c = $(`chip-${id}`); c.className = `chip ${kind}`; c.querySelector('b').textContent = text; }
const guarded = fn => async e => { e?.preventDefault?.(); try { await fn(e); } catch (err) { notice(err.message, true); } };
const dark = () => document.documentElement.dataset.theme === 'dark';
const colorOf = m => modelColor(m, dark());

// ---------------- Sources ----------------
function stopSource() {
  state.stream?.getTracks().forEach(t => t.stop()); state.stream = null; state.demo?.stop(); state.demo = null; state.photo = null;
  $('video').srcObject = null; tracker.reset(); state.tracking = null;
}
async function useStream(stream, name) {
  state.stream = stream; $('video').srcObject = stream; await $('video').play();
  for (let i = 0; i < 50 && !$('video').videoWidth; i++) await sleep(50);
  if (!$('video').videoWidth) throw Error('The video did not start; try again.');
  preview.width = $('video').videoWidth; preview.height = $('video').videoHeight;
  sourceReady(name);
}
function sourceReady(name) {
  state.candidates = []; $('preview-hint').hidden = true; $('intro').hidden = true;
  chip('source', 'ok', name); render();
}
async function openDemo() {
  if (state.running) return;
  stopSource(); state.source = 'demo';
  state.demo = new DemoPanel({style: $('demo-style').value, shake: Number($('demo-shake').value), glare: $('demo-glare').value === '1'});
  await useStream(state.demo.stream, `Demo meter (${$('demo-style').value === 'segment' ? '7-segment' : 'LCD'})`);
  notice('Demo meter: true values are known, so OCR accuracy is measured. Find values marks the numbers.');
  await findValues();
}
async function openCamera() {
  if (state.running) return;
  if (!navigator.mediaDevices?.getUserMedia) throw Error('The camera needs an HTTPS page (or localhost).');
  stopSource(); state.source = 'camera';
  const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}, audio: false});
  await useStream(stream, stream.getVideoTracks()[0].label || 'Camera');
  notice('Camera ready. Hold the phone steady, then Find values.');
  await findValues();
}
async function openPhoto(file) {
  if (state.running || !file) return;
  const url = URL.createObjectURL(file), image = new Image();
  try { await new Promise((ok, bad) => { image.onload = ok; image.onerror = () => bad(Error('Cannot read this photo.')); image.src = url; }); }
  finally { URL.revokeObjectURL(url); }
  stopSource(); state.source = 'photo';
  const scale = Math.min(1, 1920 / image.naturalWidth), c = Object.assign(document.createElement('canvas'), {width: Math.round(image.naturalWidth * scale), height: Math.round(image.naturalHeight * scale)});
  c.getContext('2d').drawImage(image, 0, 0, c.width, c.height); state.photo = c;
  preview.width = c.width; preview.height = c.height; $('tracking').value = 'fixed';
  sourceReady('Photo (still image)'); await findValues();
}
function frame() {
  if (state.source === 'photo') return state.photo;
  const v = $('video'); if (!v.videoWidth) throw Error('Choose Demo meter, Camera or Photo first.');
  const c = Object.assign(document.createElement('canvas'), {width: v.videoWidth, height: v.videoHeight});
  c.getContext('2d').drawImage(v, 0, 0); return c;
}
// Of two consecutive frames, read the one whose box is sharper (less motion blur).
async function sharpestFrame(roi) {
  if (state.source === 'photo') return state.photo;
  const polygon = roiPolygon(roi, state.tracking?.ok ? state.tracking.h : undefined);
  let best = null, score = -1;
  for (let k = 0; k < 2; k++) { if (k) await sleep(70); const f = frame(), s = sharpness(f, polygon); if (s > score) { best = f; score = s; } }
  return best;
}

// ---------------- Boxes (ROIs) ----------------
let nextId = 1;
function newBox(r, spec = {}) {
  const box = {id: nextId++, x: r.x, y: r.y, w: r.w, h: r.h, name: spec.name || `Reading ${nextId - 1}`, unit: spec.unit || '', decimals: spec.decimals ?? null,
    minimum: spec.minimum ?? -1e9, maximum: spec.maximum ?? 1e9, item_key: spec.item_key || 'reading', rows: [], last: null, stats: {}};
  box.forecaster = new ChannelForecaster({decimals: box.decimals ?? 2, horizon: state.horizon, seed: 11 + box.id});
  return box;
}
const threshold = () => Number($('confidence').value);
function spec(box) { return {decimals: box.decimals, unit: box.unit, minimum: box.minimum, maximum: box.maximum, confidence: threshold()}; }
function chooseCandidate(c) {
  if (state.running) return;
  const t = c.type;
  state.rois.push(newBox(c, {name: t?.name || c.label || 'Reading', unit: t?.unit || c.unit || '', decimals: c.decimals > 0 ? c.decimals : (t?.decimals ?? null),
    minimum: t?.minimum, maximum: t?.maximum, item_key: t?.item_key}));
  state.active = state.rois.length - 1; state.candidates = state.candidates.filter(x => x !== c); refreshBoxes();
  notice(`Box ${state.rois.length}: ${t ? `${t.name} (${t.unit})` : 'type not recognised'} · read “${c.rawText}”. Adjust it by dragging, then Test read or Start.`);
}
async function findValues() {
  if (state.running || state.busy) return;
  state.busy = true; $('find').disabled = true;
  try {
    notice('Finding numbers (text detection on the whole frame)…');
    const found = await engine.detect(frame());
    state.candidates = found.filter(c => !state.rois.some(r => Math.abs(r.x - c.x) < .02 && Math.abs(r.y - c.y) < .02));
    notice(found.length ? `${found.length} numbers found: tap one (orange) to make it a box.` : 'No number found. Draw a box with + Box.');
    refreshBoxes();
  } finally { state.busy = false; $('find').disabled = false; }
}
function refreshBoxes() {
  $('boxes').replaceChildren(...state.rois.map((b, i) => {
    const el = document.createElement('button'), last = b.last;
    el.type = 'button'; el.className = `box-chip ${i === state.active ? 'active' : ''} ${last && !ACCEPTED.has(last.status) ? 'reject' : ''}`;
    el.append(Object.assign(document.createElement('span'), {textContent: `${i + 1} · ${b.name}${b.unit ? ` (${b.unit})` : ''}`}),
      Object.assign(document.createElement('b'), {textContent: last ? (finite(last.value) ? last.value : '—') : '…'}),
      Object.assign(document.createElement('small'), {textContent: last ? last.status : 'not read yet'}));
    el.onclick = () => { state.active = i; refreshBoxes(); fillBoxForm(); renderPipeline(b.last); renderChart(); };
    return el;
  }), ...(state.running ? [] : state.candidates).map(c => {
    // Candidates are also buttons: easier to hit than a small dashed box on a phone screen.
    const el = Object.assign(document.createElement('button'), {type: 'button', className: 'box-chip candidate'});
    el.append(Object.assign(document.createElement('span'), {textContent: `+ ${c.type?.name ?? 'number'}`}), Object.assign(document.createElement('b'), {textContent: c.text}),
      Object.assign(document.createElement('small'), {textContent: c.type?.unit ? `unit ${c.type.unit}` : 'tap to add'}));
    el.onclick = () => chooseCandidate(c);
    return el;
  }));
  $('chart-box').replaceChildren(...state.rois.map((b, i) => new Option(`${i + 1} · ${b.name}`, String(i))));
  $('chart-box').value = String(state.active); fillBoxForm();
}
function fillBoxForm() {
  const b = state.rois[state.active], dis = !b || state.running;
  for (const id of ['box-name', 'box-unit', 'box-decimals', 'box-min', 'box-max']) $(id).disabled = dis;
  if (!b) return;
  $('box-name').value = b.name; $('box-unit').value = b.unit; $('box-decimals').value = b.decimals ?? '';
  $('box-min').value = b.minimum > -1e9 ? b.minimum : ''; $('box-max').value = b.maximum < 1e9 ? b.maximum : '';
}
for (const id of ['box-name', 'box-unit', 'box-decimals', 'box-min', 'box-max']) $(id).onchange = () => {
  const b = state.rois[state.active]; if (!b) return;
  b.name = $('box-name').value || b.name; b.unit = $('box-unit').value.trim();
  b.decimals = $('box-decimals').value === '' ? null : Number($('box-decimals').value);
  b.minimum = $('box-min').value === '' ? -1e9 : Number($('box-min').value); b.maximum = $('box-max').value === '' ? 1e9 : Number($('box-max').value);
  refreshBoxes();
};

// Pointer: tap a candidate, drag a box, drag its corner to resize.
let drag = null;
function point(e) { const r = preview.getBoundingClientRect(), s = Math.min(r.width / preview.width, r.height / preview.height), w = preview.width * s, h = preview.height * s; return {x: (e.clientX - r.left - (r.width - w) / 2) / w, y: (e.clientY - r.top - (r.height - h) / 2) / h}; }
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
preview.onpointerdown = e => {
  if (state.running) return;
  const p = point(e);
  for (let i = state.rois.length - 1; i >= 0; i--) {
    const r = state.rois[i];
    if (inside(p, r)) { state.active = i; refreshBoxes(); drag = {p, o: {...r}, resize: p.x > r.x + r.w - .05 && p.y > r.y + r.h - .06}; preview.setPointerCapture(e.pointerId); return; }
  }
  const c = state.candidates.find(c => inside(p, c)); if (c) chooseCandidate(c);
};
preview.onpointermove = e => {
  if (!drag) return; const p = point(e), r = state.rois[state.active], o = drag.o;
  if (drag.resize) { r.w = Math.max(.03, Math.min(1 - o.x, o.w + p.x - drag.p.x)); r.h = Math.max(.03, Math.min(1 - o.y, o.h + p.y - drag.p.y)); }
  else { r.x = Math.max(0, Math.min(1 - r.w, o.x + p.x - drag.p.x)); r.y = Math.max(0, Math.min(1 - r.h, o.y + p.y - drag.p.y)); }
};
preview.onpointerup = preview.onpointercancel = () => { drag = null; };

let lastTrack = 0;
function drawPreview(ts = 0) {
  requestAnimationFrame(drawPreview);
  if (!state.source) return;
  const src = state.source === 'photo' ? state.photo : $('video');
  try { pctx.drawImage(src, 0, 0, preview.width, preview.height); } catch { return; }
  // While running hand-held, keep tracking ~5×/s so the boxes follow the panel on screen.
  if (state.running && $('tracking').value === 'handheld' && ts - lastTrack > 180 && !state.reading) {
    lastTrack = ts; try { state.tracking = tracker.track(frame()); } catch { state.tracking = {ok: false, reason: 'tracking failed'}; }
  }
  const W = preview.width, H = preview.height, lw = Math.max(2, W / 400);
  pctx.lineWidth = lw; pctx.font = `${Math.round(W / 55)}px system-ui, sans-serif`;
  if (!state.running) {
    pctx.setLineDash([lw * 4, lw * 3]); pctx.strokeStyle = pctx.fillStyle = '#ff9e64';
    state.candidates.forEach((c, i) => { pctx.strokeRect(c.x * W, c.y * H, c.w * W, c.h * H); pctx.fillText(`${c.type?.name ?? 'number'} ${c.text}`, c.x * W, c.y * H - lw * 3); });
    pctx.setLineDash([]);
  }
  state.rois.forEach((r, i) => {
    const lost = state.running && $('tracking').value === 'handheld' && state.tracking && !state.tracking.ok;
    const poly = roiPolygon(r, state.running && state.tracking?.ok ? state.tracking.h : undefined);
    pctx.strokeStyle = pctx.fillStyle = lost ? '#ff6b6b' : i === state.active ? '#3fcfa5' : '#58a6ff';
    pctx.beginPath(); poly.forEach((p, j) => j ? pctx.lineTo(p.x * W, p.y * H) : pctx.moveTo(p.x * W, p.y * H)); pctx.closePath(); pctx.stroke();
    if (!state.running) pctx.fillRect(poly[2].x * W - lw * 7, poly[2].y * H - lw * 7, lw * 7, lw * 7);
    pctx.fillText(`${i + 1} ${r.name}`, poly[0].x * W, poly[0].y * H - lw * 3);
  });
}
requestAnimationFrame(drawPreview);

// ---------------- Reading ----------------
async function readFrame(box, shot, h, line) {
  const crop = alignedCrop(shot, box, h, {pad: .5, cv: tracker.cv}), mode = $('preprocess').value;
  let r = await engine.readROI(crop.canvas, crop.inner, {mode: mode === 'auto-retry' ? 'auto' : mode, line});
  let assessed = assessReading(r, spec(box)), retried = false;
  // Seven-segment digits are separate bars: the plain read is often right but unsure (≈0.85–0.89).
  // Then join the bars and read again. The retry is used only if it is confident AND, when the
  // first read was a well-formed number, gives the same number — two different images agreeing.
  if (mode === 'auto-retry' && assessed.status !== 'TRUNCATED' && (!ACCEPTED.has(assessed.status) || r.confidence < threshold())) {
    const r2 = await engine.readROI(crop.canvas, crop.inner, {mode: 'segment', line: r.line ?? line});
    const a2 = assessReading(r2, spec(box)), agrees = !ACCEPTED.has(assessed.status) || a2.text === assessed.text;
    if (ACCEPTED.has(a2.status) && r2.confidence >= threshold() && agrees) { r = r2; assessed = a2; retried = true; }
  }
  return {r, assessed, crop, retried};
}
async function readBox(box, {burst = Number($('burst').value)} = {}) {
  const handheld = $('tracking').value === 'handheld' && state.source !== 'photo', frames = [], start = performance.now();
  let line = null, trackingConfidence = 1;
  state.reading = true;
  try {
    for (let n = 0; n < burst; n++) {
      const shot = await sharpestFrame(box), truth = truthFor(box); let h;
      if (handheld && state.running) {
        const t = tracker.track(shot); state.tracking = t;
        if (!t.ok) return {value: null, status: 'TRACKING_ERROR', reason: t.reason, frames, ms: performance.now() - start};
        h = t.h; trackingConfidence = Math.min(trackingConfidence, t.confidence);
      }
      const f = await readFrame(box, shot, h, line); line ??= f.r.line; frames.push({...f, truth});
      if (n < burst - 1) await sleep(60);
    }
  } finally { state.reading = false; }
  const decision = validateReadings(spec(box), {readings: frames.map(f => wireReading(f.r, f.assessed)), tracking: handheld ? 'verified' : 'fixed', captured_at: Date.now() / 1000});
  return {...decision, frames, trackingConfidence, ms: performance.now() - start};
}
function truthFor(box) {
  if (state.source !== 'demo') return null;
  const t = state.demo.truth(), key = demoItemFor(box);
  return key ? {value: Number(t[key]), text: t[key], edge: t.edge} : null;
}
function burstTruth(frames) {
  const seen = frames.map(f => f.truth).filter(Boolean);
  if (!seen.length) return null;
  const values = new Set(seen.map(t => t.text));
  return {value: seen.at(-1).value, text: [...values].join(' → '), edge: values.size > 1 || seen.some(t => t.edge)};
}
function record(box, tick, result) {
  const at = Date.now() / 1000, status = result.status, value = ACCEPTED.has(status) ? result.value : null, truth = burstTruth(result.frames);
  const prev = box.rows.at(-1);
  if (prev) for (let t = prev.tick + 1; t < tick; t++) box.rows.push({tick: t, value: null, status: 'MISSING', at: null});
  box.rows.push({tick, value, status, at, raw: result.frames.map(f => f.r.rawText || '').join(' | '), truth: truth?.value ?? null});
  if (box.rows.length > 600) box.rows.shift();
  box.forecaster.push(tick, value, at);
  const s = box.stats; s.total = (s.total || 0) + 1; s[status] = (s[status] || 0) + 1;
  if (truth && !truth.edge) {
    s.checked = (s.checked || 0) + 1;
    if (value !== null) { if (Math.abs(value - truth.value) < 1e-9) s.correct = (s.correct || 0) + 1; else s.wrong = (s.wrong || 0) + 1; }
    else if (status !== 'TRACKING_ERROR') s.missed = (s.missed || 0) + 1;
  }
  box.last = {...result, value, tick, truth, at};
  // Recent readings with every photo's raw text, decision and confidence (shown under OCR quality).
  box.recent = [{tick, status, value, truth: truth?.text ?? null, frames: result.frames.map(f => ({raw: f.r.rawText || '', text: f.assessed.text, status: f.assessed.status,
    confidence: f.r.confidence || 0, min: Math.min(1, ...(f.r.characterScores || [])), substitutions: f.r.substitutions || 0, retried: f.retried}))}, ...(box.recent || [])].slice(0, 8);
}

async function loop(gen) {
  const interval = Number($('interval').value);
  while (state.running && gen === state.gen) {
    const tick = Math.round((performance.now() - state.t0) / interval);
    if (tick <= state.lastTick) { await sleep(30); continue; }
    if (state.lastTick >= 0 && tick > state.lastTick + 1) state.skipped += tick - state.lastTick - 1;  // too slow: a missing tick, never queued
    state.lastTick = tick;
    const t = performance.now();
    for (const box of state.rois) {
      if (!state.running || gen !== state.gen) break;
      try { const result = await readBox(box); if (gen === state.gen) record(box, tick, result); }
      catch (e) { notice(e.message, true); }
    }
    state.roundMs = performance.now() - t;
    refreshBoxes(); renderPipeline(state.rois[state.active]?.last); renderChart(); renderStatus();
  }
}
// At Start the hand may have moved since the box was drawn: fit each box to its text row.
async function snapBoxes(shot) {
  for (const box of state.rois) {
    const crop = alignedCrop(shot, box, undefined, {pad: .5}), row = await engine.locate(crop.canvas, crop.inner); if (!row) continue;
    const e = crop.region, sx = e.w / crop.canvas.width, sy = e.h / crop.canvas.height, m = row.h * .12;
    const x = Math.max(0, e.x + (row.x - m) * sx), y = Math.max(0, e.y + (row.y - m) * sy);
    Object.assign(box, {x, y, w: Math.min(1, e.x + (row.x + row.w + m) * sx) - x, h: Math.min(1, e.y + (row.y + row.h + m) * sy) - y});
  }
}
async function start() {
  if (state.running) { stop(); return; }
  if (!state.source) throw Error('Choose Demo meter, Camera or Photo first.');
  if (!state.rois.length) throw Error('Make at least one box: Find values and tap a number, or + Box.');
  $('start').disabled = true;
  try {
    notice('Preparing: loading OCR, fitting boxes to the text and storing the panel reference…');
    await engine.initialize();
    const shot = frame(); await snapBoxes(shot);
    if ($('tracking').value === 'handheld' && state.source !== 'photo') {
      chip('track', 'wait', 'Loading OpenCV…'); await tracker.initialize();
      const n = tracker.setReference(shot, state.rois); state.tracking = tracker.track(frame());
      chip('track', state.tracking.ok ? 'ok' : 'bad', `${n} reference points`);
      if (!state.tracking.ok) throw Error(`Tracking: ${state.tracking.reason}. Keep panel edges or buttons in view.`);
    } else chip('track', '', 'Fixed');
    state.running = true; state.gen++; state.t0 = performance.now(); state.lastTick = -1; state.skipped = 0;
    $('start').textContent = 'Stop'; $('start').classList.replace('primary', 'danger'); fillBoxForm();
    notice(`Running: one reading every ${Number($('interval').value) / 1000} s per box. Rejected readings stay gaps.`);
    navigator.wakeLock?.request('screen').then(l => { state.wake = l; }).catch(() => {});
    loop(state.gen);
  } finally { $('start').disabled = false; }
}
function stop() {
  state.running = false; state.gen++; state.wake?.release?.(); state.wake = null;
  $('start').textContent = 'Start'; $('start').classList.replace('danger', 'primary'); fillBoxForm(); renderStatus();
  notice('Stopped. Boxes can be edited again; data is kept until Clear data.');
}
async function testRead() {
  const box = state.rois[state.active]; if (!box) throw Error('Select or make a box first.');
  if (state.running) throw Error('Stop first.');
  $('test-read').disabled = true;
  try { notice('Test read (detection + recognition)…'); const r = await readBox(box, {burst: 1}); box.last = {...r, value: ACCEPTED.has(r.status) ? r.value : null, truth: burstTruth(r.frames)}; renderPipeline(box.last); refreshBoxes(); notice(`Test read: ${label(r.status)}`); }
  finally { $('test-read').disabled = false; }
}

// ---------------- Rendering ----------------
function scoreColor(p) { return p >= .95 ? 'var(--normal)' : p >= .9 ? 'var(--warning)' : 'var(--danger)'; }
function renderPipeline(last) {
  const box = state.rois[state.active];
  $('pipe-box').textContent = box ? `box ${state.active + 1} · ${box.name}` : '—';
  const f = last?.frames?.at(-1);
  if (!f) { for (const id of ['pipe-chars', 'pipe-burst', 'pipe-decision']) $(id).textContent = last?.status ? label(last.status) : '—'; return; }
  // 1 aligned crop with the user's box (dashed) and the detected text line (solid)
  const c = $('pipe-crop'), src = f.crop.canvas, k = Math.min(1, 640 / src.width);
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  const g = c.getContext('2d'); g.drawImage(src, 0, 0, c.width, c.height); g.lineWidth = 2;
  const i = f.crop.inner; g.setLineDash([6, 4]); g.strokeStyle = '#3d8bfd'; g.strokeRect(i.x * k, i.y * k, i.w * k, i.h * k); g.setLineDash([]);
  if (f.r.line) { const l = f.r.line; g.strokeStyle = '#22a06b'; g.strokeRect(l.x * k, l.y * k, l.w * k, l.h * k); }
  // 2 the line image the recogniser sees
  const p = $('pipe-input'), pr = f.r.processed;
  if (pr) { const kk = Math.min(1, 640 / pr.width); p.width = Math.round(pr.width * kk); p.height = Math.round(pr.height * kk); p.getContext('2d').drawImage(pr, 0, 0, p.width, p.height); }
  // 3 characters
  const chars = $('pipe-chars'); chars.replaceChildren();
  if (f.r.label) chars.append(Object.assign(document.createElement('span'), {className: 'lab', textContent: f.r.label}));
  [...(f.r.text || '')].forEach((ch, j) => { const s = Object.assign(document.createElement('span'), {className: 'ch', textContent: ch}); const sc = f.r.characterScores?.[j]; if (finite(sc)) { s.style.color = scoreColor(sc); s.title = `${(sc * 100).toFixed(1)}%`; } chars.append(s); });
  if (!f.r.text) chars.append(Object.assign(document.createElement('span'), {className: 'lab', textContent: '(no number)'}));
  if (f.r.unit) chars.append(Object.assign(document.createElement('span'), {className: 'lab', textContent: f.r.unit}));
  const d = f.r.decimal || {};
  $('pipe-raw').textContent = `raw “${f.r.rawText || ''}” · confidence ${Math.round((f.r.confidence || 0) * 100)}% (threshold ${Math.round(threshold() * 100)}%)${f.r.substitutions ? ` · ${f.r.substitutions} letter→digit` : ''} · dot in image: ${d.hasPoint ? `yes (${d.digitsRight} after)` : d.reliable ? 'no' : 'unclear'}${f.retried ? ' · read after 7-segment retry' : ''} · ${Math.round(f.r.milliseconds || 0)} ms`;
  // 4 burst
  $('pipe-burst').replaceChildren(...last.frames.map((x, j) => { const ok = ACCEPTED.has(x.assessed.status) && x.r.confidence >= threshold();
    return Object.assign(document.createElement('span'), {className: ok ? 'ok' : 'bad', textContent: `#${j + 1}  ${x.r.rawText || '(blank)'}  →  ${x.assessed.text || '—'}  ${ACCEPTED.has(x.assessed.status) && !ok ? 'LOW_CONFIDENCE' : x.assessed.status}  ${Math.round(x.r.confidence * 100)}%${x.retried ? ' (7-seg retry)' : ''}`}); }));
  // 5 decision
  const ok = ACCEPTED.has(last.status), t = last.truth, dec = $('pipe-decision');
  dec.className = `decision ${ok ? 'ok' : 'bad'}`; dec.replaceChildren(Object.assign(document.createElement('b'), {textContent: ok ? `${last.value} ${box?.unit || ''}` : '—'}), document.createElement('br'), document.createTextNode(label(last.status)));
  if (t) dec.append(document.createElement('br'), document.createTextNode(t.edge ? `Demo truth ${t.text} — the display changed during or just before these photos, so this reading is not scored.`
    : `Demo truth ${t.text} → ${ok ? (Math.abs(last.value - t.value) < 1e-9 ? 'correct ✓' : 'WRONG ✗ (false accept, 誤接受)') : 'rejected (false reject, 誤拒絕)'}`));
}
function renderChart() {
  const box = state.rois[state.active], canvas = $('chart');
  if (!box) { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); $('metrics').replaceChildren(); $('quality').replaceChildren(); return; }
  const now = box.rows.at(-1)?.tick ?? null, f = box.forecaster, d = box.decimals ?? Math.max(0, ...box.rows.filter(r => finite(r.value)).map(r => decimalsOf(String(r.value))));
  const logs = new Map([...f.log].filter(([m]) => state.visible.has(m)));
  $('chart-title').textContent = `${box.name}${box.unit ? ` (${box.unit})` : ''}`;
  const interval = Number($('interval').value) / 1000;
  state.layout = drawChart(canvas, {history: box.rows, groups: now === null ? [] : latestGroups(logs, now, Infinity, state.horizon), past: [], limits: null,
    unit: box.unit, decimals: d, interval, windowTicks: 120, horizon: state.horizon, now, anchor: box.rows.at(-1)?.at, colorOf, hover: state.hover});
  const actual = new Map(box.rows.filter(r => finite(r.value)).map(r => [r.tick, r.value]));
  const scores = scoreForecasts(logs, actual, {h: 'avg', H: state.horizon, common: true});
  const best = scores.filter(s => s.n).sort((a, b) => a.mae - b.mae)[0]?.model;
  $('metrics').replaceChildren(...scores.map(s => {
    const tr = document.createElement('tr'), name = document.createElement('td'), sw = Object.assign(document.createElement('span'), {className: 'swatch'});
    sw.style.background = colorOf(s.model); name.append(sw, s.model + (s.model === best ? ' ★' : ''));
    const skill = Object.assign(document.createElement('td'), {textContent: s.skill === null ? '—' : `${s.skill > 0 ? '+' : ''}${Math.round(s.skill * 100)}%`, className: s.skill > 0 ? 'pos' : s.skill < 0 ? 'neg' : ''});
    tr.append(name, ...[s.n, s.n ? s.mae.toFixed(d + 1) : 'warming up', s.smape === null ? '—' : `${s.smape.toFixed(2)}%`].map(v => Object.assign(document.createElement('td'), {textContent: v})), skill);
    return tr;
  }));
  const st = box.stats, rows = [['Readings', st.total || 0], ['Accepted', `${(st.VALID || 0) + (st.AUTO_DECIMAL_RECOVERY || 0)}${st.total ? ` (${Math.round(((st.VALID || 0) + (st.AUTO_DECIMAL_RECOVERY || 0)) / st.total * 100)}%)` : ''}`]];
  for (const k of Object.keys(STATUS)) if (!ACCEPTED.has(k) && st[k]) rows.push([`Rejected: ${k}`, st[k]]);
  if (st.AUTO_DECIMAL_RECOVERY) rows.push(['…of which dot restored', st.AUTO_DECIMAL_RECOVERY]);
  if (state.skipped) rows.push(['Skipped ticks (too slow)', state.skipped]);
  if (st.checked) rows.push(['Correct (demo truth)', `${st.correct || 0} / ${st.checked}`], ['False accepts (誤接受)', st.wrong || 0], ['False rejects (誤拒絕)', st.missed || 0]);
  $('quality').replaceChildren(...rows.map(([k, v]) => { const tr = document.createElement('tr'); tr.append(Object.assign(document.createElement('td'), {textContent: k}), Object.assign(document.createElement('td'), {textContent: v})); return tr; }));
  $('quality-note').textContent = state.source === 'demo' ? 'Demo meter: each accepted value is compared with the value on screen. A false accept is worse than a rejection — it silently enters the forecasts.' : 'With a real meter, compare a few accepted values with the display yourself; confidence is not a probability of being right.';
  $('readings').replaceChildren(...state.rois.map((b, i) => { const s = document.createElement('span'); s.append(`${i + 1} ${b.name} `, Object.assign(document.createElement('b'), {textContent: finite(b.last?.value) ? b.last.value : '—'}), ` ${b.unit}`); return s; }));
}
function renderStatus() {
  if (!state.running) return;
  const interval = Number($('interval').value);
  if (state.roundMs !== null) $('engine').textContent = `${OCR_VERSION} · last round ${Math.round(state.roundMs)} ms for ${state.rois.length} box(es) × ${$('burst').value} photo(s) · interval ${interval / 1000} s${state.roundMs > interval ? ' — too slow: ticks are skipped; use 1 photo or a longer interval' : ''}`;
  if ($('tracking').value === 'handheld' && state.tracking) chip('track', state.tracking.ok ? 'ok' : 'bad', state.tracking.ok ? `${Math.round(state.tracking.confidence * 100)}%` : 'Lost');
}
function render() { refreshBoxes(); renderChart(); }
function buildToggles() {
  $('models').replaceChildren(...PHONE_MODELS.map(m => {
    const l = document.createElement('label'), i = Object.assign(document.createElement('input'), {type: 'checkbox', checked: state.visible.has(m)});
    i.onchange = () => { i.checked ? state.visible.add(m) : state.visible.delete(m); renderChart(); };
    const sw = Object.assign(document.createElement('span'), {className: 'swatch'}); l.style.color = colorOf(m);
    const t = Object.assign(document.createElement('span'), {textContent: m}); t.style.color = 'var(--ink)'; l.append(i, sw, t); return l;
  }));
}
function exportCSV() {
  const lines = ['box,name,unit,tick,timestamp,value,status,raw_ocr,demo_truth'];
  state.rois.forEach((b, i) => b.rows.forEach(r => lines.push([i + 1, `"${b.name}"`, `"${b.unit}"`, r.tick, r.at ?? '', r.value ?? '', r.status, `"${(r.raw || '').replaceAll('"', "'")}"`, r.truth ?? ''].join(','))));
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], {type: 'text/csv'})), a = Object.assign(document.createElement('a'), {href: url, download: 'panel-ocr-lab.csv'});
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------- Wiring ----------------
$('src-demo').onclick = guarded(openDemo);
$('src-camera').onclick = guarded(openCamera);
$('src-photo').onchange = guarded(() => openPhoto($('src-photo').files[0]));
$('find').onclick = guarded(findValues);
$('add-box').onclick = () => { if (state.running) return; state.rois.push(newBox({x: .35, y: .4, w: .3, h: .14})); state.active = state.rois.length - 1; refreshBoxes(); };
$('remove-box').onclick = () => { if (state.running || !state.rois.length) return; state.rois.splice(state.active, 1); state.active = Math.max(0, state.active - 1); refreshBoxes(); renderChart(); };
$('test-read').onclick = guarded(testRead);
$('start').onclick = guarded(start);
$('chart-box').onchange = () => { state.active = Number($('chart-box').value); refreshBoxes(); renderPipeline(state.rois[state.active]?.last); renderChart(); };
$('horizon').value = String(state.horizon);
$('horizon').onchange = () => { state.horizon = Number($('horizon').value); saved.set('horizon', state.horizon); for (const b of state.rois) b.forecaster.setHorizon(state.horizon); renderChart(); };
for (const id of ['demo-style', 'demo-shake', 'demo-glare']) $(id).onchange = guarded(async () => { if (state.source === 'demo' && !state.running) { const boxes = state.rois; await openDemo(); state.rois = boxes; refreshBoxes(); } });
$('export').onclick = exportCSV;
$('clear').onclick = () => { for (const b of state.rois) { b.rows = []; b.stats = {}; b.last = null; b.forecaster = new ChannelForecaster({decimals: b.decimals ?? 2, horizon: state.horizon, seed: 11 + b.id}); } state.skipped = 0; render(); };
$('theme').onclick = () => { document.documentElement.dataset.theme = dark() ? 'light' : 'dark'; saved.set('theme', document.documentElement.dataset.theme); buildToggles(); renderChart(); };
document.documentElement.dataset.theme = saved.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
for (const tab of document.querySelectorAll('[role=tab]')) tab.onclick = () => {
  for (const t of document.querySelectorAll('[role=tab]')) t.setAttribute('aria-selected', String(t === tab));
  for (const p of document.querySelectorAll('.learn')) p.hidden = p.dataset.panel !== tab.dataset.tab;
};
const chart = $('chart');
chart.addEventListener('pointerdown', e => { const l = state.layout; if (!l) return; state.hover = Math.max(l.left, Math.min(l.right, l.tickAt(e.clientX - chart.getBoundingClientRect().left))); renderChart(); setTimeout(() => { state.hover = null; renderChart(); }, 8000); });
new ResizeObserver(() => renderChart()).observe(chart);
document.addEventListener('visibilitychange', () => { if (document.hidden && state.running) { stop(); notice('Stopped because the page went to the background.', true); } });
$('version').textContent = LAB_VERSION; $('engine').textContent = OCR_VERSION;
globalThis.ocrLab = {state, engine, tracker};   // for inspection in the browser console
buildToggles(); refreshBoxes();
if (new URLSearchParams(location.search).get('demo') === '1') openDemo().catch(e => notice(e.message, true));
