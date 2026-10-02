// Phone-side online forecasting. Dependency-free so the ESP32 can serve it offline.
// Every model sees one sample per tick: update(y) for a valid value, skip() for a missing
// tick. Missing ticks are never turned into fake observations; Kalman/Holt/ESN only run
// their prediction step across short gaps, and a long gap restarts the models.
import {finite} from './alerts.js';

export const PHONE_MODELS = ['Persistence', 'Kalman', 'Holt', 'ESN'];
export const SERVER_MODELS = ['RNN', 'LSTM', 'Chronos-2'];
export const GAP_RESET = 10;   // ticks; longer gaps restart every phone model
const Z80 = 1.2816;            // two-sided 80% normal interval

// Small seeded PRNG (mulberry32): a replay rebuilds the same ESN reservoir.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Tick-indexed values (null for missing ticks) from rows {tick, value}.
function series(rows) {
  const values = [];
  for (let i = 0; i < rows.length; i++) {
    if (i) for (let t = rows[i - 1].tick + 1; t < rows[i].tick; t++) values.push(null);
    values.push(rows[i].value);
  }
  return values;
}

// Replay each candidate and keep the one with the lowest mean error over horizons 1..H,
// i.e. the same multi-step error the accuracy table reports.
function gridFit(make, grid, values, H) {
  let best = null;
  for (const params of grid) {
    const m = make(params); let error = 0, count = 0, gap = 0;
    for (let i = 0; i < values.length; i++) {
      const y = values[i];
      if (!finite(y)) { if (++gap > GAP_RESET) m.reset(); else m.skip(); continue; }
      gap = 0; m.update(y);
      if (!m.ready() || m.n < 10 || i + 1 >= values.length) continue;
      const f = m.forecast(H).mean;
      for (let h = 1; h <= H && i + h < values.length; h++) if (finite(values[i + h])) { error += Math.abs(values[i + h] - f[h - 1]); count++; }
    }
    if (count && (!best || error / count < best.score)) best = {params, score: error / count};
  }
  return best?.params ?? null;
}

export class Persistence {
  constructor() { this.reset(); }
  reset() { this.last = null; this.n = 0; }
  update(y) { this.last = y; this.n++; }
  skip() {}
  ready() { return this.last !== null; }
  forecast(H) { return {mean: Array(H).fill(this.last)}; }
}

// Local linear trend Kalman filter: state = [level, slope], the same structure as the
// server's Kalman. Noise is scaled by an online estimate v of the first-difference variance,
// so the parameters are unit-free multipliers: Q = q·v·diag(0.1, 0.01), R = r·v.
// Only the ratio q/r changes the forecast; "auto" picks it from recent data.
export class Kalman {
  constructor(params = {}, quantum = .01) { this.params = {q: 1, r: 1, auto: true, ...params}; this.floor = quantum ** 2 / 12 + 1e-12; this.reset(); }
  reset() { this.x = null; this.P = null; this.v = null; this.prev = null; this.n = 0; }
  noise() {
    const v = Math.max(this.v ?? this.floor * 100, this.floor);
    return {R: this.params.r * v, q0: this.params.q * .1 * v, q1: this.params.q * .01 * v};
  }
  predictStep() {
    const [l, b] = this.x, [[a, c], [d, e]] = this.P, {q0, q1} = this.noise();
    this.x = [l + b, b];
    this.P = [[a + c + d + e + q0, c + e], [d + e, e + q1]];
  }
  update(y) {
    if (this.prev !== null) {
      const d2 = (y - this.prev) ** 2;
      this.v = this.v === null ? d2 : this.v + .05 * (d2 - this.v);
    }
    this.prev = y; this.n++;
    if (this.x === null) { const s = this.noise().R * 10; this.x = [y, 0]; this.P = [[s, 0], [0, s]]; return; }
    this.predictStep();
    const {R} = this.noise(), [[a, c], [d, e]] = this.P, s = a + R, k0 = a / s, k1 = d / s, innov = y - this.x[0];
    this.x = [this.x[0] + k0 * innov, this.x[1] + k1 * innov];
    this.P = [[a - k0 * a, c - k0 * c], [d - k1 * a, e - k1 * c]];
  }
  skip() { if (this.x !== null) { this.predictStep(); this.prev = null; } }
  ready() { return this.n >= 2; }
  forecast(H) {
    const mean = [], lower = [], upper = [], {R, q0, q1} = this.noise();
    let [l, b] = this.x, [[a, c], [d, e]] = this.P;
    for (let h = 1; h <= H; h++) {
      l += b; [a, c, d, e] = [a + c + d + e + q0, c + e, d + e, e + q1];
      const sd = Math.sqrt(Math.max(a + R, 0));
      mean.push(l); lower.push(l - Z80 * sd); upper.push(l + Z80 * sd);
    }
    return {mean, lower, upper};
  }
  static fit(values, H, quantum) {
    return gridFit(p => new Kalman(p, quantum), [.003, .01, .03, .1, .3, 1, 3].map(q => ({q, r: 1})), values, H);
  }
}

// Holt's linear method with a damped trend (φ ≤ 1). φ < 1 stops a 10–30 step forecast from
// extrapolating a short-lived slope forever.
export class Holt {
  constructor(params = {}) { this.params = {alpha: .4, beta: .1, phi: .95, auto: true, ...params}; this.reset(); }
  reset() { this.L = null; this.B = 0; this.n = 0; }
  update(y) {
    const {alpha, beta, phi} = this.params;
    if (this.L === null) { this.L = y; this.B = 0; this.n = 1; return; }
    const prev = this.L;
    this.L = alpha * y + (1 - alpha) * (this.L + phi * this.B);
    this.B = beta * (this.L - prev) + (1 - beta) * phi * this.B;
    this.n++;
  }
  skip() { if (this.L !== null) { this.L += this.params.phi * this.B; this.B *= this.params.phi; } }
  ready() { return this.n >= 3; }
  forecast(H) {
    const {phi} = this.params, mean = [];
    let damp = 0, power = 1;
    for (let h = 1; h <= H; h++) { power *= phi; damp += power; mean.push(this.L + damp * this.B); }
    return {mean};
  }
  static fit(values, H) {
    const grid = [];
    for (const alpha of [.1, .2, .3, .5, .7, .9]) for (const beta of [.02, .05, .1, .2, .4]) for (const phi of [.8, .9, .95, 1]) grid.push({alpha, beta, phi});
    return gridFit(p => new Holt(p), grid, values, H);
  }
}

// Echo State Network (reservoir computing, 儲備池計算) with online RLS readouts.
// Fixes vs. the HTML algorithm demo: it predicts the FUTURE (the demo trained the readout to
// copy the current input), inputs are normalised, the reservoir is leaky, RLS forgets old data,
// and each horizon h has its own linear readout (direct strategy) instead of feeding
// predictions back, which compounded errors over 10+ steps.
// Readout h learns Δ_h = (y(t+h) − y(t)) / sd; its update waits until y(t+h) is observed.
export class ESN {
  constructor(params = {}, seed = 7, horizon = 10) {
    this.params = {size: 40, rho: .9, leak: .3, inputScale: .5, forget: .998, delta: 1, ...params};
    this.seed = seed; this.H = horizon; this.reset();
  }
  reset() {
    const {size: N, rho, inputScale, delta} = this.params, rand = rng(this.seed);
    // Sparse reservoir: about 8 links per neuron keeps an update at O(8N).
    this.W = Array.from({length: N}, () => {
      const row = [];
      for (let k = 0; k < Math.min(8, N); k++) row.push([Math.floor(rand() * N), rand() * 2 - 1]);
      return row;
    });
    const scale = rho / (spectralRadius(this.W, N, rand) || 1);
    for (const row of this.W) for (const link of row) link[1] *= scale;
    this.Win = Array.from({length: N}, () => [(rand() * 2 - 1) * .2, (rand() * 2 - 1) * inputScale]);
    this.state = new Float64Array(N); this.d = N + 2;
    this.w = Array.from({length: this.H}, () => new Float64Array(this.d));
    this.P = Array.from({length: this.d}, (_, i) => { const r = new Float64Array(this.d); r[i] = 1 / delta; return r; });
    this.mu = null; this.var = null; this.n = 0; this.updates = 0;
    this.ms = new Float64Array(this.H);   // running mean square of each horizon's target
    this.past = [];   // last H+1 ticks: {x, y (null if missing), level, sd, settled}
  }
  sd() { return Math.sqrt(Math.max(this.var ?? 0, 1e-10)); }
  advance(state, u) {
    const {leak} = this.params, next = new Float64Array(state.length);
    for (let i = 0; i < state.length; i++) {
      let s = this.Win[i][0] + this.Win[i][1] * u;
      for (const [j, w] of this.W[i]) s += w * state[j];
      next[i] = (1 - leak) * state[i] + leak * Math.tanh(s);
    }
    return next;
  }
  features(u) { const x = new Float64Array(this.d); x[0] = 1; x[1] = u; x.set(this.state, 2); return x; }
  dot(w, x) { let s = 0; for (let i = 0; i < this.d; i++) s += w[i] * x[i]; return Math.max(-6, Math.min(6, s)); }
  update(y) {
    // Normalisation: plain running mean/variance for the first 30 samples, then a slow
    // exponential update so the scale the readout learned stays meaningful.
    if (this.mu === null) { this.mu = y; this.var = 0; }
    else {
      const e = y - this.mu, a = this.n < 30 ? 1 / (this.n + 1) : .01;
      this.mu += a * e; this.var = this.n < 30 ? this.var + (e * (y - this.mu) - this.var) / (this.n + 1) : this.var + a * (e * e - this.var);
    }
    this.input(y, y);
    this.n++;
  }
  // The reservoir input is clipped (tanh saturates anyway); the level itself never is.
  input(level, y) {
    const sd = this.sd(), u = Math.max(-5, Math.min(5, (level - this.mu) / sd));
    this.state = this.advance(this.state, u);
    this.remember({x: this.features(u), y, level, sd, settled: this.n >= 30});
  }
  skip() {
    if (!this.past.length) return;
    // Keep the reservoir moving with its own 1-step guess; no readout update uses it.
    const last = this.past.at(-1);
    this.input(last.level + this.dot(this.w[0], last.x) * last.sd, null);
  }
  remember(item) {
    this.past.push(item);
    if (this.past.length > this.H + 1) this.past.shift();
    // Oldest entry now has all H targets: one RLS step with a shared gain, H errors.
    const first = this.past[0];
    if (first.settled && this.past.length === this.H + 1 && first.y !== null && this.past.slice(1).every(p => p.y !== null)) {
      const targets = this.past.slice(1).map(p => Math.max(-6, Math.min(6, (p.y - first.y) / first.sd)));
      targets.forEach((t, h) => { this.ms[h] = this.updates ? this.ms[h] + .02 * (t * t - this.ms[h]) : t * t; });
      this.rls(first.x, targets);
    }
  }
  rls(x, targets) {
    const {forget} = this.params, d = this.d, Px = new Float64Array(d);
    let denom = forget;
    for (let i = 0; i < d; i++) { let s = 0; const row = this.P[i]; for (let j = 0; j < d; j++) s += row[j] * x[j]; Px[i] = s; denom += x[i] * s; }
    targets.forEach((t, h) => { const e = t - this.dot(this.w[h], x), w = this.w[h]; for (let i = 0; i < d; i++) w[i] += Px[i] / denom * e; });
    let trace = 0;
    for (let i = 0; i < d; i++) {
      const row = this.P[i], k = Px[i] / denom;
      for (let j = 0; j < d; j++) row[j] = (row[j] - k * Px[j]) / forget;
      trace += row[i];
    }
    // Forgetting can inflate P when the water is perfectly steady ("covariance wind-up").
    if (trace > 1e4 * d) for (const row of this.P) for (let j = 0; j < d; j++) row[j] *= 1e4 * d / trace;
    this.updates++;
  }
  ready() { return this.updates >= 20; }   // washout + first readout updates
  forecast(H) {
    const last = this.past.at(-1), mean = [];
    // A linear readout extrapolates wildly at an unseen extreme (e.g. a pollution spike), so
    // each step is capped at 3× the typical change seen for that horizon.
    for (let h = 0; h < H; h++) {
      const k = Math.min(h, this.H - 1), cap = 3 * Math.sqrt(this.ms[k]);
      mean.push(last.level + Math.max(-cap, Math.min(cap, this.dot(this.w[k], last.x))) * last.sd);
    }
    return {mean};
  }
}

// Power iteration on ‖W^k v‖; valid for the non-symmetric reservoir (complex eigenvalues).
function spectralRadius(W, N, rand) {
  let v = Array.from({length: N}, () => rand() - .5), logSum = 0, count = 0;
  for (let it = 0; it < 60; it++) {
    const next = new Array(N).fill(0);
    for (let i = 0; i < N; i++) for (const [j, w] of W[i]) next[i] += w * v[j];
    const norm = Math.hypot(...next) || 1e-12;
    if (it >= 20) { logSum += Math.log(norm); count++; }
    v = next.map(x => x / norm);
  }
  return Math.exp(logSum / count);
}

export const DEFAULT_PARAMS = {Kalman: {q: 1, r: 1, auto: true}, Holt: {alpha: .4, beta: .1, phi: .95, auto: true}, ESN: {size: 40, rho: .9, leak: .3, inputScale: .5, forget: .998, delta: 1}};
const REFIT_EVERY = 60;

// One forecaster per sensor channel: owns the replayable history and the phone forecast log.
export class ChannelForecaster {
  constructor({decimals = 2, horizon = 10, params = DEFAULT_PARAMS, seed = 7, maxOrigins = 600} = {}) {
    this.quantum = 10 ** -decimals; this.horizon = horizon; this.seed = seed; this.maxOrigins = maxOrigins;
    this.params = structuredClone(params); this.rows = []; this.build();
  }
  build() {
    this.models = {Persistence: new Persistence(), Kalman: new Kalman(this.params.Kalman, this.quantum),
      Holt: new Holt(this.params.Holt), ESN: new ESN(this.params.ESN, this.seed, this.horizon)};
    this.log = new Map(PHONE_MODELS.map(m => [m, new Map()]));
    this.lastTick = null; this.sinceFit = 0;
  }
  setParams(model, params) { Object.assign(this.params[model], params); this.replay(); }
  setHorizon(H) { if (H !== this.horizon) { this.horizon = H; this.replay(); } }
  replay() {
    const rows = this.rows; this.rows = []; this.build();
    this.autoFit(rows);
    for (const r of rows) this.push(r.tick, r.value, r.at, false);
  }
  // Auto parameters are chosen from the recent past and apply from the next sample on.
  autoFit(rows = this.rows) {
    const values = series(rows.slice(-300)), H = Math.min(this.horizon, 10);
    if (values.filter(finite).length < 40) return;
    for (const [name, Model, extra] of [['Holt', Holt], ['Kalman', Kalman, this.quantum]]) {
      if (!this.params[name].auto) continue;
      const fit = Model.fit(values, H, extra);
      if (fit) { Object.assign(this.params[name], fit); this.models[name].params = {...this.params[name]}; }
    }
    this.sinceFit = 0;
  }
  // tick: integer sample index; value: number or null (sensor fault). Absent ticks = missing.
  push(tick, value, at = Date.now() / 1000, refit = true) {
    if (this.lastTick !== null && tick <= this.lastTick) return;
    const gap = this.lastTick === null ? 0 : tick - this.lastTick - 1, models = Object.values(this.models);
    if (gap > GAP_RESET) models.forEach(m => m.reset());
    else for (let i = 0; i < gap; i++) models.forEach(m => m.skip());
    this.lastTick = tick; this.rows.push({tick, value, at}); if (this.rows.length > this.maxOrigins) this.rows.shift();
    if (!finite(value)) { models.forEach(m => m.skip()); return; }
    models.forEach(m => m.update(value));
    if (refit && ++this.sinceFit >= REFIT_EVERY) this.autoFit();
    for (const [name, m] of Object.entries(this.models)) {
      if (!m.ready()) continue;
      const f = m.forecast(this.horizon);
      if (!f.mean.every(finite)) continue;
      const log = this.log.get(name);
      log.set(tick, {model: name, source: 'phone', origin: tick, available_at: at, ...f});
      if (log.size > this.maxOrigins) log.delete(log.keys().next().value);
    }
  }
  status() {
    const esn = this.models.ESN;
    return {ESN: esn.ready() ? 'ready' : `warming up ${Math.min(esn.updates, 20)}/20`, Kalman: this.params.Kalman, Holt: this.params.Holt};
  }
}

// Server rows {model, origin_tick, horizon, prediction, lower, upper, available_at, target_time}
// become log entries shaped like phone entries. A forecast that finished after its target time
// is kept for drawing but never scored.
export function mergeServerRows(logs, rows, skip = new Set(['Persistence', 'Kalman']), maxOrigins = 600) {
  let latest = null;
  for (const r of rows) {
    if (skip.has(r.model) || !finite(r.prediction)) continue;
    if (!logs.has(r.model)) logs.set(r.model, new Map());
    const log = logs.get(r.model);
    let e = log.get(r.origin_tick);
    if (!e) { e = {model: r.model, source: 'server', origin: r.origin_tick, available_at: r.available_at, mean: [], lower: [], upper: [], late: []}; log.set(r.origin_tick, e); }
    const i = r.horizon - 1;
    e.mean[i] = r.prediction; e.lower[i] = r.lower ?? null; e.upper[i] = r.upper ?? null;
    e.late[i] = finite(r.target_time) && finite(r.available_at) && r.available_at >= r.target_time;
    e.available_at = Math.max(e.available_at, r.available_at);
    latest = Math.max(latest ?? r.origin_tick, r.origin_tick);
  }
  for (const log of logs.values()) {
    if (log.size <= maxOrigins) continue;
    const keys = [...log.keys()].sort((a, b) => a - b);
    for (const k of keys.slice(0, log.size - maxOrigins)) log.delete(k);
  }
  return latest;
}

// Latest forecast per model whose origin is at or before `tick` and available by `now`.
export function latestGroups(logs, tick, now, horizon = 10) {
  const groups = [];
  for (const [model, log] of logs) {
    let best = null;
    for (const e of log.values()) if (e.origin <= tick && e.available_at <= now && (!best || e.origin > best.origin)) best = e;
    if (!best || best.origin + horizon <= tick) continue;
    const points = [];
    for (let h = 1; h <= Math.min(horizon, best.mean.length); h++) {
      const p = best.mean[h - 1];
      if (finite(p)) points.push({target_tick: best.origin + h, prediction: p, lower: best.lower?.[h - 1] ?? null, upper: best.upper?.[h - 1] ?? null});
    }
    if (points.length) groups.push({model, source: best.source, origin: best.origin, lag: tick - best.origin, points});
  }
  return groups;
}

// Past h-step-ahead forecasts as one line per model: the point at target t was issued at t−h.
export function pastLine(log, h, fromTick, toTick) {
  const points = [];
  for (const e of log.values()) {
    const t = e.origin + h;
    if (t < fromTick || t > toTick || e.late?.[h - 1]) continue;
    const p = e.mean[h - 1];
    if (finite(p)) points.push({tick: t, value: p});
  }
  return points.sort((a, b) => a.tick - b.tick);
}

// Rolling live accuracy. h = number, or 'avg' for horizons 1..H. With common=true every model
// is scored on the same (origin, horizon) pairs. Skill compares with Persistence on the pairs
// both models share: skill = 1 − MAE_model / MAE_persistence (> 0 means better than naive).
export function scoreForecasts(logs, actual, {h = 1, H = 10, fromTick = -Infinity, common = true, models = null} = {}) {
  const pairs = new Map();
  for (const [model, log] of logs) {
    if (models && !models.has(model)) continue;
    const rows = new Map();
    for (const e of log.values()) {
      const hs = h === 'avg' ? Array.from({length: Math.min(H, e.mean.length)}, (_, i) => i + 1) : [h];
      for (const k of hs) {
        const t = e.origin + k, a = actual.get(t), p = e.mean[k - 1];
        if (t < fromTick || !finite(a) || !finite(p) || e.late?.[k - 1]) continue;
        rows.set(`${e.origin}:${k}`, [a, p]);
      }
    }
    pairs.set(model, rows);
  }
  const active = [...pairs.values()].filter(r => r.size);
  const shared = common && active.length ? new Set([...active[0].keys()].filter(k => active.every(r => r.has(k)))) : null;
  const stats = list => {
    let n = 0, abs = 0, sq = 0, sm = 0;
    for (const [a, p] of list) { const e = Math.abs(a - p), den = Math.abs(a) + Math.abs(p); n++; abs += e; sq += e * e; sm += den > 1e-12 ? 200 * e / den : 0; }
    return n ? {n, mae: abs / n, rmse: Math.sqrt(sq / n), smape: sm / n} : {n: 0, mae: null, rmse: null, smape: null};
  };
  const base = pairs.get('Persistence'), result = [];
  for (const [model, rows] of pairs) {
    const s = stats([...rows].filter(([k]) => !shared || shared.has(k)).map(([, v]) => v));
    let skill = null;
    if (base && model !== 'Persistence') {
      const both = [...rows.keys()].filter(k => base.has(k) && (!shared || shared.has(k)));
      const m = stats(both.map(k => rows.get(k))), b = stats(both.map(k => base.get(k)));
      if (m.n && b.mae > 1e-12) skill = 1 - m.mae / b.mae;
    }
    result.push({model, source: logs.get(model).values().next().value?.source ?? 'phone', ...s, skill});
  }
  return result;
}
