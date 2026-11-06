export const MODEL_COLORS = {'Persistence':'#6c7976','Kalman':'#087f75','Holt':'#b45309','ESN':'#be185d','RNN':'#3d63b8','LSTM':'#7c4dbb','Chronos-2':'#5b7f12'};
export const MODEL_COLORS_DARK = {'Persistence':'#a3b0ad','Kalman':'#5fd4c0','Holt':'#f0a35e','ESN':'#f283b5','RNN':'#8fb0f5','LSTM':'#c3a3f5','Chronos-2':'#b5d86a'};
export const modelColor = (model, dark=false) => (dark ? MODEL_COLORS_DARK : MODEL_COLORS)[model] || (dark ? '#dddddd' : '#333333');
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export function defaultLimits(channel, initial) {
  if (channel.item_key === 'temperature' && ['°C','C','℃'].includes(channel.unit)) return {lower:20, upper:30, origin:'Water temperature default'};
  if (channel.item_key === 'tds' && (channel.unit||'').toLowerCase() === 'ppm') return {lower:null, upper:500, origin:'TDS default'};
  if (!finite(initial)) return null;
  const span = Math.max(Math.abs(initial) * .2, 10 ** -(channel.decimals ?? 2));
  return {lower:initial-span, upper:initial+span, origin: initial === 0 ? 'Zero baseline: ±1 resolution step' : 'Initial reading ±20%'};
}
export function outside(value, limits) {
  return finite(value) && !!limits && ((finite(limits.lower) && value < limits.lower) || (finite(limits.upper) && value > limits.upper));
}
// Latest available forecast per model from backend snapshot rows. The whole trajectory of that
// origin is returned; `lag` = how many ticks the origin is behind the current reading.
export function futureForecasts(snapshot, currentTick, now = Date.now()/1000, {horizon=10}={}) {
  const byModel = new Map();
  for (const f of snapshot?.forecasts ?? []) {
    if (!finite(f.prediction) || f.available_at > now || f.horizon > horizon) continue;
    const group = byModel.get(f.model);
    if (!group || f.origin_tick > group.origin) byModel.set(f.model, {origin:f.origin_tick, points:[f]});
    else if (f.origin_tick === group.origin) group.points.push(f);
  }
  return [...byModel].filter(([, g]) => g.points.some(p => p.target_tick > currentTick && p.target_tick <= currentTick+horizon))
    .map(([model, g]) => ({model, origin:g.origin, lag:currentTick-g.origin, points:g.points.sort((a,b)=>a.target_tick-b.target_tick)}));
}
// Each model is assessed separately; never join different models into one volatility range.
// rapid: (max − min) of the next `window` forecasts ÷ |current| ≥ 20%. Network/upload delay
// means a server forecast is usually 1–3 ticks behind the reading; up to `maxLag` ticks it
// still counts as current, older ones only show on the chart.
export function assess(current, limits, forecasts, {window=10, maxLag=3}={}) {
  if (!finite(current)) return {state:'unknown', label:'No valid reading', crossing:[], rapid:[]};
  const crossing = [], rapid = [];
  for (const group of forecasts) {
    const lag = group.lag ?? 0;
    if (lag > maxLag) continue;
    if (group.points.some(p => p.target_tick > group.origin + lag && outside(p.prediction, limits))) crossing.push(group.model);
    const head = group.points.slice(0, window);
    if (head.length !== window || head.some((p,i)=>p.target_tick !== group.origin+i+1)) continue;
    const values = head.map(p=>p.prediction);
    const range = Math.max(...values)-Math.min(...values);
    if (Math.abs(current) < 1e-9) {
      if (range > 0) rapid.push({model:group.model, ratio:null, range, zero:true});
    } else if (range / Math.abs(current) >= .2-1e-10) rapid.push({model:group.model, ratio:range/Math.abs(current), range});
  }
  if (outside(current, limits)) return {state:'danger', label:'Outside limits now', crossing, rapid};
  if (crossing.length || rapid.length) return {state:'warning', label:crossing.length ? 'Forecast exceeds limits' : 'Rapid change ahead', crossing, rapid};
  return {state:'normal', label:'Within limits', crossing, rapid};
}
// Accepts the bare server URL, a join link (…?server=…&code=…), or "link + code" pasted together.
export function parseJoin(text) {
  let server = '', code = '';
  for (const u of String(text).match(/https?:\/\/[^\s"'<>]+/g) || []) {
    try {
      const p = new URL(u), s = p.searchParams.get('server') || p.searchParams.get('backend'), c = p.searchParams.get('code');
      if (s) server = s; else if (p.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(p.hostname)) server = p.origin + p.pathname.replace(/\/+$/, '');
      if (c) code = c;
    } catch {}
  }
  if (!server && /^[a-z0-9-]+\.trycloudflare\.com\/?$/i.test(String(text).trim())) server = 'https://' + String(text).trim().replace(/\/$/, '');
  const m = String(text).match(/code\s*[:=]\s*([A-Za-z0-9_-]{4,})/i); if (m) code = m[1];
  return {server, code};
}
