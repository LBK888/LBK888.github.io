/* Pure reading logic shared by the browser, local mode and Node tests.
   Raw OCR is always kept; uncertainty rejects instead of guessing. */
export const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const NUMERIC = new Set([...'0123456789.,+-−']);
// Letters the recognizer confuses with digits. Mapped only inside a number,
// and every substitution lowers confidence to the weakest character.
const CONFUSABLE = new Set([...'OoDQIl|iZzSsGbBgq']);
const isDigit = c => c >= '0' && c <= '9';
const isLetter = c => /\p{L}/u.test(c);

/* Greedy CTC collapse. steps.best[t] is '' for blank. */
export function collapse(best, probability) {
  const chars = []; let previous = null;
  for (let t = 0; t < best.length; t++) {
    const c = best[t];
    if (c && c !== previous) chars.push({c, p: probability[t], t, end: t});
    else if (c && c === previous) chars.at(-1).end = t;
    previous = c;
  }
  return chars;
}

/* Find the single number in a recognized line, re-decoding only its time
   steps with digits/sign/point. Labels before it and units after it are kept
   as text (pH, DO, %, °C, mg/L) for type and unit checks. */
export function decodeReading(steps) {
  const raw = collapse(steps.best, steps.bestP), T = steps.best.length;
  const rawText = raw.map(x => x.c).join('').trim();
  const kind = raw.map(x => NUMERIC.has(x.c) ? 'n' : CONFUSABLE.has(x.c) ? 'c' : 'o');
  const runs = [];
  for (let i = 0; i < raw.length; i++) {
    if (kind[i] !== 'n') continue;
    let j = i;
    while (j + 1 < raw.length && (kind[j + 1] === 'n' || (kind[j + 1] === 'c' && kind[j + 2] === 'n'))) j++;
    let start = i, end = j;
    const core = raw.slice(i, j + 1).map(x => x.c).join('');
    // "O2", "CH1", "T1": a short integer glued to a word is part of a label.
    if (i > 0 && isLetter(raw[i - 1].c) && !core.includes('.') && core.length <= 2) { i = j; continue; }
    // One confusable at an edge belongs to the number only when no other letter touches it.
    if (start > 0 && kind[start - 1] === 'c' && !(start > 1 && isLetter(raw[start - 2].c))) start--;
    if (end + 1 < raw.length && kind[end + 1] === 'c' && !(end + 2 < raw.length && isLetter(raw[end + 2].c))) end++;
    if (/\d/.test(core)) runs.push({start, end, point: core.includes('.') || core.includes(',')});
    i = j;
  }
  // Extra integer tokens (channel numbers) yield to the one decimal number.
  const chosen = runs.length > 1 && runs.filter(r => r.point).length === 1 ? runs.filter(r => r.point) : runs;
  const base = {rawText, text: '', unit: '', label: rawText, confidence: 0, characterScores: [],
    substitutions: 0, numericConflict: false, multiple: chosen.length > 1, dots: [], span: null, steps: T};
  if (chosen.length !== 1) return base;
  const {start, end} = chosen[0];
  const t0 = start ? Math.floor((raw[start - 1].end + raw[start].t) / 2) + 1 : 0;
  const t1 = end + 1 < raw.length ? Math.ceil((raw[end].end + raw[end + 1].t) / 2) - 1 : T - 1;
  const rawSlots = new Map(raw.slice(start, end + 1).map(x => [x.t, x.c]));
  let text = '', previous = null, substitutions = 0; const scores = [], digitSteps = [];
  for (let t = t0; t <= t1; t++) {
    const useNumber = steps.numP[t] > steps.blankP[t];
    const c = useNumber ? steps.num[t] : '';
    if (c && c !== previous) {
      const exact = steps.best[t] === c;
      if (!exact && steps.best[t]) substitutions++;
      text += c; scores.push(exact ? steps.bestP[t] : steps.numP[t]);
      if (isDigit(c)) digitSteps.push(t);
    }
    previous = c;
  }
  text = text.replaceAll('−', '-');
  if (!text.includes('.') && (text.match(/,/g) || []).length === 1) text = text.replace(',', '.');
  // Soft evidence: the recognizer's own probability of a point between two digits.
  const dots = [];
  for (let k = 0; k + 1 < digitSteps.length; k++) {
    let p = 0;
    for (let t = digitSteps[k] + 1; t < digitSteps[k + 1]; t++) p = Math.max(p, steps.dotP[t] || 0);
    dots.push({digitsRight: digitSteps.length - k - 1, p});
  }
  const conflict = substitutions > 0 || [...rawSlots.values()].some(c => !NUMERIC.has(c));
  const confidence = scores.length ? (conflict ? Math.min(...scores) : scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  return {...base, text, label: raw.slice(0, start).map(x => x.c).join('').trim(),
    unit: raw.slice(end + 1).map(x => x.c).join('').trim(), confidence, characterScores: scores,
    substitutions, numericConflict: conflict, dots, span: {t0, t1}};
}

/* Item types recognized from labels and units near a value. */
export const TYPE_PRESETS = {
  do_sat: {item_key: 'do_sat', name: 'DO saturation', unit: '%', minimum: 0, maximum: 200, decimals: 1},
  do: {item_key: 'do', name: 'DO', unit: 'mg/L', minimum: 0, maximum: 20, decimals: 2},
  ph: {item_key: 'ph', name: 'pH', unit: 'pH', minimum: 0, maximum: 14, decimals: 2},
  orp: {item_key: 'orp', name: 'ORP', unit: 'mV', minimum: -2000, maximum: 2000, decimals: 0},
  conductivity: {item_key: 'conductivity', name: 'Conductivity', unit: 'µS/cm', minimum: 0, maximum: 200000, decimals: null},
  conductivity_ms: {item_key: 'conductivity_ms', name: 'Conductivity', unit: 'mS/cm', minimum: 0, maximum: 500, decimals: null},
  salinity: {item_key: 'salinity', name: 'Salinity', unit: 'ppt', minimum: 0, maximum: 80, decimals: null},
  tds: {item_key: 'tds', name: 'TDS', unit: 'ppm', minimum: 0, maximum: 100000, decimals: null},
  turbidity: {item_key: 'turbidity', name: 'Turbidity', unit: 'NTU', minimum: 0, maximum: 4000, decimals: null},
  humidity: {item_key: 'humidity', name: 'Humidity', unit: '%RH', minimum: 0, maximum: 100, decimals: 1},
  temperature: {item_key: 'temperature', name: 'Temperature', unit: '°C', minimum: -20, maximum: 100, decimals: 1},
  temperature_f: {item_key: 'temperature_f', name: 'Temperature', unit: '°F', minimum: -4, maximum: 212, decimals: 1},
  percent: {item_key: 'percent', name: 'Percent', unit: '%', minimum: 0, maximum: 200, decimals: null},
  ppm: {item_key: 'ppm', name: 'Concentration', unit: 'ppm', minimum: 0, maximum: 100000, decimals: null},
};
function normalizeText(text) {
  return ` ${String(text || '')} `.replace(/℃/g, '°C').replace(/℉/g, '°F').replace(/[μµ]/g, 'u')
    .replace(/[º˚]/g, '°').toUpperCase().replace(/\s+/g, ' ');
}
const word = token => new RegExp(`(^|[^A-Z])${token}([^A-Z]|$)`);
const RULES = [
  ['do_sat', u => /(^|[^A-Z])(D\.? ?O|O2|OXY)/.test(u) && u.includes('%')],
  ['tds', u => word('TDS').test(u)],
  ['do', u => /MG ?\/ ?L/.test(u) || /(^|[^A-Z])(D\.? ?O\.?|O2|OXY[A-Z]*)([^A-Z]|$)/.test(u)],
  ['ph', u => word('P ?H').test(u)],
  ['orp', u => word('ORP').test(u) || /\dMV|[^A-Z]MV([^A-Z]|$)/.test(u)],
  ['conductivity_ms', u => /MS ?\/ ?CM/.test(u)],
  ['conductivity', u => /US ?\/ ?CM/.test(u) || word('COND[A-Z]*').test(u) || word('EC').test(u)],
  ['salinity', u => word('SAL[A-Z]*').test(u) || word('PSU').test(u) || word('PPT').test(u) || u.includes('‰')],
  ['turbidity', u => word('NTU').test(u) || word('FNU').test(u) || word('TURB[A-Z]*').test(u)],
  ['humidity', u => /%\s?RH/.test(u) || word('RH').test(u)],
  ['temperature_f', u => /°\s?F/.test(u)],
  ['temperature', u => /°\s?C/.test(u) || word('TEMP[A-Z]*').test(u)],
  ['temperature', u => /\d\s?°|^ °/.test(u)], // a degree sign whose C was not read
  ['percent', u => u.includes('%')],
  ['ppm', u => word('PPM').test(u)],
];
export function classifyType(texts) {
  const u = normalizeText([].concat(texts).filter(Boolean).join(' '));
  for (const [key, test] of RULES) if (test(u)) return {key, ...TYPE_PRESETS[key]};
  return null;
}
/* Type of one value: its own unit/label wins; an ambiguous unit (%/ppm) is
   refined by the nearest label; otherwise the nearest classifiable label. */
export function inferType(value, nearTexts = []) {
  const own = [value.unit, value.label].filter(Boolean).join(' '), ownType = classifyType(own);
  if (ownType && !['percent', 'ppm'].includes(ownType.key)) return ownType;
  if (ownType) {
    for (const text of nearTexts.slice(0, 2)) { const refined = classifyType(`${own} ${text}`); if (refined && refined.key !== ownType.key) return refined; }
    return ownType;
  }
  for (const text of nearTexts.slice(0, 3)) { const type = classifyType(text); if (type) return type; }
  return null;
}
export function decimalsOf(text) { return /\.\d+$/.test(text || '') ? text.split('.')[1].length : 0; }

/* Units are compared only when both sides contain a known unit token;
   labels such as "DO" are not units. */
const UNITS = [[/%\s?RH/, '%RH'], [/%/, '%'], [/°\s?C/, '°C'], [/°\s?F/, '°F'], [/MG ?\/ ?L/, 'mg/L'],
  [/US ?\/ ?CM/, 'µS/cm'], [/MS ?\/ ?CM/, 'mS/cm'], [word('PPM'), 'ppm'], [word('PPT'), 'ppt'], [/‰/, 'ppt'],
  [word('NTU'), 'NTU'], [word('MV'), 'mV'], [word('P ?H'), 'pH']];
export function unitFamily(unit) {
  if (!unit) return null;
  const u = normalizeText(unit);
  return UNITS.find(([pattern]) => pattern.test(u))?.[1] ?? null;
}

/* Decimal decision for one reading. Policy from the v2.0 review: a missing
   point is inserted only with a fixed decimal count AND positional visual
   evidence; any disagreement rejects. */
export function assessReading(reading, spec = {}) {
  const text = reading.text || '', d = spec.decimals ?? null;
  if (reading.multiple) return {text, status: 'INVALID_FORMAT'};
  if (reading.truncated) return {text, status: 'TRUNCATED'};
  if (!NUMBER.test(text)) return {text, status: 'INVALID_FORMAT'};
  // ".79": displays print "0.79", so a bare leading point means a digit was cut off.
  if (/^[+-]?\./.test(text)) return {text, status: 'DECIMAL_UNCERTAIN'};
  const channelUnit = unitFamily(spec.unit), readUnit = unitFamily(reading.unit);
  if (channelUnit && readUnit && channelUnit !== readUnit) return {text, status: 'UNIT_MISMATCH'};
  const pixel = reading.decimal || {}, digits = text.replace(/\D/g, '').length;
  if (text.includes('.')) {
    const after = text.split('.')[1].length;
    if (d === 0) return {text, status: 'DECIMAL_UNCERTAIN'};
    if (d !== null) return {text, status: after === d ? 'VALID' : 'DECIMAL_UNCERTAIN'};
    if (pixel.hasPoint) return {text, status: pixel.digitsRight === after ? 'VALID' : 'DECIMAL_UNCERTAIN'};
    return {text, status: pixel.reliable && pixel.points?.length === 0 ? 'DECIMAL_UNCERTAIN' : 'VALID'};
  }
  if (d === 0) return {text, status: 'VALID'};
  // Auto decimals never insert a point; a visible or likely point rejects.
  if (d === null) return {text, status: pixel.hasPoint || (reading.dots || []).some(dot => dot.p >= .3) ? 'DECIMAL_UNCERTAIN' : 'VALID'};
  const positions = new Set();
  if (pixel.hasPoint) positions.add(pixel.digitsRight);
  for (const dot of reading.dots || []) if (dot.p >= .2) positions.add(dot.digitsRight);
  if (positions.size === 1 && positions.has(d) && digits > d) {
    const sign = /^[+-]/.test(text) ? text[0] : '', body = text.replace(/^[+-]/, '');
    return {text: `${sign}${body.slice(0, -d)}.${body.slice(-d)}`, status: 'AUTO_DECIMAL_RECOVERY', recovered: true};
  }
  return {text, status: 'DECIMAL_UNCERTAIN'};
}

/* Payload sent to the backend (/client-ocr) and stored locally. */
export function wireReading(reading, assessed) {
  const accepted = ['VALID', 'AUTO_DECIMAL_RECOVERY'].includes(assessed.status);
  const hasPoint = assessed.text.includes('.');
  return {text: assessed.text.slice(0, 100), confidence: Math.max(0, Math.min(1, reading.confidence || 0)),
    decimal_checked: true, decimal_evidence: accepted ? hasPoint : !hasPoint,
    raw_text: (reading.rawText || '').slice(0, 100) || null, unit: (reading.unit || '').slice(0, 20) || null,
    client_status: assessed.status};
}

/* Mirrors backend/domain.py validate_readings for local (no-server) mode. */
export function validateReadings(spec, observation, previous = null) {
  if (observation.tracking === 'lost') return {value: null, status: 'TRACKING_ERROR'};
  const votes = [], recovered = new Set(), failures = [];
  for (const r of observation.readings || []) {
    const text = String(r.text || '').trim().replaceAll('−', '-');
    if (r.confidence < (spec.confidence ?? .9)) { failures.push('LOW_CONFIDENCE'); continue; }
    if (r.client_status && !['VALID', 'AUTO_DECIMAL_RECOVERY'].includes(r.client_status)) { failures.push(r.client_status); continue; }
    if (!NUMBER.test(text)) { failures.push('INVALID_FORMAT'); continue; }
    if (r.decimal_checked && Boolean(r.decimal_evidence) !== text.includes('.')) { failures.push('DECIMAL_UNCERTAIN'); continue; }
    let v = Number(text);
    if (spec.decimals > 0 && !text.includes('.')) {
      if (r.decimal_evidence && !(spec.minimum <= v && v <= spec.maximum)) { v /= 10 ** spec.decimals; recovered.add(v); }
      else { failures.push('DECIMAL_UNCERTAIN'); continue; }
    }
    if (!Number.isFinite(v) || v < spec.minimum || v > spec.maximum) { failures.push('OUT_OF_RANGE'); continue; }
    if (previous && spec.max_rate != null) {
      const dt = observation.captured_at - previous[0];
      if (dt <= 0 || Math.abs(v - previous[1]) > spec.max_rate * dt) { failures.push('RATE_EXCEEDED'); continue; }
    }
    if (r.client_status === 'AUTO_DECIMAL_RECOVERY') recovered.add(v);
    votes.push(v);
  }
  const n = (observation.readings || []).length, required = n >= 2 ? 2 : 1;
  if (!votes.length) return {value: null, status: failures[0] || 'MISSING'};
  const counts = new Map(); for (const v of votes) counts.set(v, (counts.get(v) || 0) + 1);
  const [value, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (count < required) return {value: null, status: 'OCR_CONFLICT'};
  return {value, status: recovered.has(value) ? 'AUTO_DECIMAL_RECOVERY' : 'VALID'};
}
