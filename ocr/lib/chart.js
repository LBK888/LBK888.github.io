import {finite, outside} from './alerts.js';

function niceStep(span) {
  const raw = span / 4, power = 10 ** Math.floor(Math.log10(raw || 1)), unit = raw / power;
  return (unit < 1.5 ? 1 : unit < 3 ? 2 : unit < 7 ? 5 : 10) * power;
}
const fmt = (v, decimals) => finite(v) ? v.toFixed(decimals) : '—';

// Time-series chart on a plain canvas (no CDN: the ESP32 serves this page offline).
// x is the sample tick, so a missing tick leaves a visible hole instead of being squeezed out.
export function drawChart(canvas, {history = [], groups = [], past = [], pastH = 1, limits, unit = '', decimals = 2,
  interval = 1, windowTicks = 300, horizon = 10, now = null, anchor = null, colorOf, hover = null, frozen = false}) {
  const dpr = window.devicePixelRatio || 1, width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return null;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const css = getComputedStyle(canvas), v = name => css.getPropertyValue(name).trim();
  const ink = v('--ink'), muted = v('--muted'), line = v('--line'), danger = v('--danger'), warning = v('--warning'), paper = v('--paper');
  ctx.font = '12px Consolas, monospace'; ctx.fillStyle = muted;
  const rows = history.filter(r => now !== null && r.tick <= now && r.tick > now - windowTicks);
  const valid = rows.filter(r => finite(r.value));
  if (now === null || !valid.length) { ctx.fillText('Waiting for valid sensor data…', 24, 60); return null; }
  const left = now - windowTicks + 1, right = now + horizon;
  const box = {x: 54, y: 24, w: width - 68, h: height - 76};
  // The forecast zone gets its own, zoomed time scale (≥ 28% of the width): on a 5-minute
  // window a 10-step forecast would otherwise be a 3% sliver at the right edge.
  const futureFrac = Math.min(.4, Math.max(.28, horizon / (windowTicks + horizon)));
  const split = box.x + box.w * (1 - futureFrac), end = box.x + box.w;
  const x = t => t <= now ? box.x + (t - left) / Math.max(1, now - left) * (split - box.x) : split + (t - now) / horizon * (end - split);
  const tickAt = px => Math.round(px <= split ? left + (px - box.x) / (split - box.x) * (now - left) : now + (px - split) / (end - split) * horizon);

  // Value range: data and forecasts first; limits and bands only widen it moderately.
  const core = [...valid.map(r => r.value), ...groups.flatMap(g => g.points.map(p => p.prediction)), ...past.flatMap(p => p.points.map(q => q.value))].filter(finite);
  let low = Math.min(...core), high = Math.max(...core);
  const span0 = Math.max(high - low, 10 ** -decimals * 4), low0 = low, high0 = high;
  for (const g of groups) for (const p of g.points) for (const b of [p.lower, p.upper]) if (finite(b)) { low = Math.min(low, Math.max(b, low0 - span0 * .6)); high = Math.max(high, Math.min(b, high0 + span0 * .6)); }
  // A limit far from the data would flatten the curves; it is then marked at the edge instead.
  for (const b of [limits?.lower, limits?.upper]) if (finite(b) && b > low0 - span0 && b < high0 + span0) { low = Math.min(low, b); high = Math.max(high, b); }
  const pad = Math.max((high - low) * .08, 10 ** -decimals); low -= pad; high += pad;
  const y = val => box.y + (high - val) / (high - low) * box.h;

  // Future region and the "now" boundary.
  ctx.fillStyle = v('--future'); ctx.fillRect(x(now), box.y, x(right) - x(now), box.h);

  // Missing ticks: grey band; sensor-error ticks get a red mark on the axis.
  const byTick = new Map(rows.map(r => [r.tick, r]));
  ctx.save(); ctx.globalAlpha = .55;
  for (let t = Math.max(left, rows[0].tick); t <= now; t++) {
    const r = byTick.get(t);
    if (r && finite(r.value)) continue;
    ctx.fillStyle = line; ctx.fillRect(x(t - .5), box.y, Math.max(1.5, x(t + .5) - x(t - .5)), box.h);
    if (r && r.status && r.status !== 'MISSING') { ctx.fillStyle = danger; ctx.fillRect(x(t - .5), box.y + box.h - 5, Math.max(2, x(t + .5) - x(t - .5)), 5); }
  }
  ctx.restore();

  // Grid and y labels.
  const step = niceStep(high - low), digits = Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));
  ctx.textAlign = 'right'; ctx.lineWidth = 1;
  for (let val = Math.ceil(low / step) * step; val <= high; val += step) {
    ctx.strokeStyle = line; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(box.x, y(val)); ctx.lineTo(box.x + box.w, y(val)); ctx.stroke();
    ctx.fillStyle = muted; ctx.fillText(val.toFixed(digits), box.x - 8, y(val) + 4);
  }
  ctx.textAlign = 'left'; ctx.fillText(unit, 4, 14);

  // X labels: clock time at both ends of the window and "now", forecast reach on the right.
  const clock = t => finite(anchor) ? new Date((anchor + (t - now) * interval) * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}) : `t${t}`;
  const base = box.y + box.h + 16;
  ctx.fillStyle = muted; ctx.textAlign = 'left'; if (x(now) - box.x > 110) ctx.fillText(clock(left), box.x, base);
  ctx.textAlign = 'center'; ctx.fillText(frozen ? `paused ${clock(now)}` : 'now', x(now), base);
  ctx.textAlign = 'right'; ctx.fillText(`+${+(horizon * interval).toFixed(1)} s`, end, base);
  ctx.textAlign = 'left'; ctx.fillText(`← observed (${Math.round(windowTicks * interval / 60 * 10) / 10} min)`, box.x, base + 18);
  ctx.textAlign = 'right'; ctx.fillText(`forecast (${horizon} steps, zoomed) →`, end, base + 18);

  ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  for (const bound of ['lower', 'upper']) if (finite(limits?.[bound])) {
    const value = limits[bound];
    if (value > high || value < low) {
      ctx.fillStyle = danger; ctx.textAlign = 'right';
      ctx.fillText(`${value > high ? '▲ max' : '▼ min'} ${value} (off chart)`, x(now) - 6, value > high ? box.y + 13 : box.y + box.h - 6);
      continue;
    }
    ctx.strokeStyle = danger; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(box.x, y(limits[bound])); ctx.lineTo(box.x + box.w, y(limits[bound])); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = danger; ctx.textAlign = 'right';
    ctx.fillText(`${bound === 'upper' ? 'max' : 'min'} ${limits[bound]}`, x(now) - 6, y(limits[bound]) + (bound === 'upper' ? -5 : 13));
  }
  const path = (points, color, {dash = [], width = 2, alpha = 1, join = 1} = {}) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.setLineDash(dash); ctx.beginPath();
    let last = null;
    for (const p of points) {
      if (!finite(p.value)) { last = null; continue; }
      if (last !== null && p.tick - last <= join) ctx.lineTo(x(p.tick), y(p.value)); else ctx.moveTo(x(p.tick), y(p.value));
      last = p.tick;
    }
    ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
  };
  // Past h-step forecasts: where each model said "now" would be, h steps earlier.
  for (const p of past) path(p.points, colorOf(p.model), {dash: [2, 3], width: 1.6, alpha: .8});
  path(rows, ink);
  for (const r of valid) {
    const out = outside(r.value, limits);
    ctx.fillStyle = out ? danger : ink; ctx.beginPath(); ctx.arc(x(r.tick), y(r.value), out ? 3.5 : 1.6, 0, Math.PI * 2); ctx.fill();
  }
  // Latest forecast of each model, drawn from its origin so a delayed server forecast is visible as such.
  for (const g of groups) {
    const color = colorOf(g.model), pts = g.points;
    if (pts.every(p => finite(p.lower) && finite(p.upper))) {
      ctx.fillStyle = color; ctx.globalAlpha = .12; ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(x(p.target_tick), y(p.lower)) : ctx.moveTo(x(p.target_tick), y(p.lower)));
      [...pts].reverse().forEach(p => ctx.lineTo(x(p.target_tick), y(p.upper)));
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    }
    const start = byTick.get(g.origin);
    const line = [...(finite(start?.value) ? [{tick: g.origin, value: start.value}] : []), ...pts.map(p => ({tick: p.target_tick, value: p.prediction}))];
    path(line, color, {dash: [6, 4], width: 2.2, join: 2});
    for (const p of pts) { ctx.fillStyle = outside(p.prediction, limits) ? warning : color; ctx.beginPath(); ctx.arc(x(p.target_tick), y(p.prediction), 2.6, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
  ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x(now), box.y); ctx.lineTo(x(now), box.y + box.h); ctx.stroke();

  if (hover !== null && hover >= left && hover <= right) {
    const lines = [], dot = (val, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x(hover), y(val), 4, 0, Math.PI * 2); ctx.fill(); };
    ctx.strokeStyle = ink; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x(hover), box.y); ctx.lineTo(x(hover), box.y + box.h); ctx.stroke(); ctx.setLineDash([]);
    const r = byTick.get(hover), actual = r?.value;
    lines.push([hover <= now ? clock(hover) : `${clock(hover)} (+${hover - now})`, ink]);
    if (hover <= now) lines.push([finite(actual) ? `Observed ${fmt(actual, decimals)} ${unit}` : r?.status && r.status !== 'MISSING' ? `Sensor error (${r.status})` : 'Missing sample', finite(actual) ? ink : danger]);
    if (finite(actual)) dot(actual, ink);
    const seen = new Set();
    for (const g of groups) {
      const p = g.points.find(q => q.target_tick === hover);
      if (!p) continue;
      seen.add(g.model); dot(p.prediction, colorOf(g.model));
      lines.push([`${g.model} ${fmt(p.prediction, decimals)}${finite(actual) ? `  err ${fmt(p.prediction - actual, decimals)}` : ''}`, colorOf(g.model)]);
    }
    for (const p of past) {
      const q = p.points.find(q => q.tick === hover);
      if (!q || seen.has(p.model)) continue;
      dot(q.value, colorOf(p.model));
      lines.push([`${p.model} (h=${pastH}) ${fmt(q.value, decimals)}${finite(actual) ? `  err ${fmt(q.value - actual, decimals)}` : ''}`, colorOf(p.model)]);
    }
    ctx.font = '12px Consolas, monospace';
    const w = Math.max(...lines.map(([t]) => ctx.measureText(t).width)) + 16, h = lines.length * 16 + 10;
    const bx = x(hover) + 10 + w > box.x + box.w ? x(hover) - 10 - w : x(hover) + 10, by = box.y + 4;
    ctx.fillStyle = paper; ctx.globalAlpha = .94; ctx.fillRect(bx, by, w, h); ctx.globalAlpha = 1;
    ctx.strokeStyle = line; ctx.strokeRect(bx, by, w, h);
    ctx.textAlign = 'left'; lines.forEach(([t, c], i) => { ctx.fillStyle = c; ctx.fillText(t, bx + 8, by + 18 + i * 16); });
  }
  return {box, left, right, tickAt};
}
