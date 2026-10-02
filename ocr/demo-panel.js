// Demo instrument: a water-quality meter drawn on a canvas and streamed like a camera.
// The page cannot tell it from a real camera, so the whole OCR pipeline (tracking, detection,
// recognition, validation) runs unchanged — and the true value of every frame is known.

const W = 1280, H = 720;
const SEGMENTS = {0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g'};

function rand(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; }

export class DemoPanel {
  constructor({style = 'lcd', shake = 1, glare = false, update = 2000} = {}) {
    Object.assign(this, {style, shake, glare, update});
    this.canvas = Object.assign(document.createElement('canvas'), {width: W, height: H});
    this.ctx = this.canvas.getContext('2d');
    this.random = rand(20261004); this.start = performance.now();
    this.desk = Array.from({length: 420}, () => [this.random() * 1600 - 160, this.random() * 1000 - 140, 6 + this.random() * 26, Math.floor(70 + this.random() * 140)]);
    this.pose = {tx: 0, ty: 0, a: 0, k: 1, vx: 0, vy: 0, n: 0};
    this.walk = {ph: 0, do: 0, temp: 0}; this.event = null; this.shown = null; this.shownAt = -1;
    this.timer = setInterval(() => this.draw(), 33); this.draw();
    this.stream = this.canvas.captureStream(30);
  }
  // Slow, realistic changes; the display refreshes every `update` ms like a real meter.
  values(t) {
    const r = this.random, w = this.walk, s = t / 1000;
    w.ph += (r() - .5) * .004; w.do += (r() - .5) * .08; w.temp += (r() - .5) * .006;
    w.ph *= .995; w.do *= .99; w.temp *= .998;
    if (!this.event && r() < .004) this.event = {start: s, size: 6 + r() * 8};       // aeration stop: DO drops
    if (this.event && s - this.event.start > 150) this.event = null;
    const age = this.event ? s - this.event.start : 0;
    const drop = this.event ? this.event.size * (age < 40 ? age / 40 : Math.exp(-(age - 40) / 50)) : 0;
    return {
      ph: (7.62 + .18 * Math.sin(s / 95) + w.ph).toFixed(2),
      do: Math.max(0, 86 + 5 * Math.sin(s / 130 + 1) + w.do - drop).toFixed(1),
      temp: (25.4 + 1.2 * Math.sin(s / 240) + w.temp).toFixed(1),
    };
  }
  // Displayed strings at time t (performance.now()). `edge`: the display changed < 400 ms ago.
  truth(t = performance.now()) { return {...this.shown, edge: t - this.shownAt < 400}; }
  segment(x, y, text, h) {
    const ctx = this.ctx, w = h * .5, t = h * .11;
    for (const ch of text) {
      if (ch === '.') { ctx.fillRect(x - w * .04, y + h - t * 1.2, t * 1.2, t * 1.2); x += t * 2.4; continue; }
      const on = SEGMENTS[ch] || '', g = Math.max(2, h * .025);
      const seg = {a: [x + g, y, w - 2 * g, t], b: [x + w - t, y + g, t, h / 2 - 2 * g], c: [x + w - t, y + h / 2 + g, t, h / 2 - 2 * g],
        d: [x + g, y + h - t, w - 2 * g, t], e: [x, y + h / 2 + g, t, h / 2 - 2 * g], f: [x, y + g, t, h / 2 - 2 * g], g: [x + g, y + h / 2 - t / 2, w - 2 * g, t]};
      for (const k of on) ctx.fillRect(...seg[k]);
      x += w + h * .18;
    }
    return x;
  }
  draw() {
    const now = performance.now(), ctx = this.ctx, s = this.pose, r = this.random, k = this.shake;
    if (!this.shown || now - this.shownAt >= this.update) { this.shown = this.values(now - this.start); this.shownAt = now; }
    const v = this.shown;
    s.n++; s.vx = .82 * s.vx + (r() - .5) * 7 * k; s.vy = .82 * s.vy + (r() - .5) * 7 * k;
    if (k && s.n % 140 === 70) { s.vx += 30 * (r() - .5) * k; s.vy += 30 * (r() - .5) * k; }
    s.tx = Math.max(-60, Math.min(60, s.tx + s.vx)); s.ty = Math.max(-40, Math.min(40, s.ty + s.vy));
    s.a = Math.max(-.06, Math.min(.06, s.a + (r() - .5) * .006 * k)); s.k = Math.max(.95, Math.min(1.05, s.k + (r() - .5) * .004 * k));
    if (!k) { s.tx *= .9; s.ty *= .9; s.a *= .9; s.k = 1 + (s.k - 1) * .9; }
    const speed = Math.hypot(s.vx, s.vy);
    ctx.filter = `brightness(${(1 + .1 * Math.sin(now / 2300)).toFixed(3)})${speed > 7 ? ` blur(${Math.min(2, speed / 8).toFixed(2)}px)` : ''}`;
    ctx.fillStyle = '#7a6a58'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(s.tx * .6, s.ty * .6);                      // desk behind the meter (parallax)
    for (const [x, y, z, g] of this.desk) { ctx.fillStyle = `rgb(${g},${g * .9 | 0},${g * .8 | 0})`; ctx.fillRect(x, y, z, z * .6); }
    ctx.restore();
    ctx.save(); ctx.translate(W / 2 + s.tx, H / 2 + s.ty); ctx.rotate(s.a); ctx.scale(s.k, s.k); ctx.translate(-W / 2, -H / 2);
    ctx.fillStyle = '#2b2f33'; ctx.beginPath(); ctx.roundRect(290, 100, 700, 520, 28); ctx.fill();
    ctx.fillStyle = '#c9d1d9'; ctx.font = '22px Arial, sans-serif'; ctx.fillText('AquaCheck 3000', 320, 140);
    ctx.fillStyle = '#c3cfb9'; ctx.fillRect(330, 170, 620, 300);
    ctx.fillStyle = '#1b2420';
    const mono = 'ui-monospace, Menlo, Consolas, "Courier New", monospace';
    ctx.font = 'bold 34px Arial, sans-serif'; ctx.fillText('pH', 352, 228);
    if (this.style === 'segment') this.segment(430, 190, v.ph, 110); else { ctx.font = `bold 118px ${mono}`; ctx.fillText(v.ph, 430, 300); }
    ctx.font = `bold 40px ${mono}`; ctx.fillText(`${v.temp} °C`, 760, 225);
    ctx.font = 'bold 30px Arial, sans-serif'; ctx.fillText('DO', 352, 392);
    if (this.style === 'segment') { const x = this.segment(430, 350, v.do, 78); ctx.font = 'bold 72px Arial, sans-serif'; ctx.fillText('%', x + 6, 428); }
    else { ctx.font = `bold 78px ${mono}`; ctx.fillText(`${v.do}%`, 430, 430); }
    if (this.glare) {                                                     // a moving reflection on the glass
      const gx = 520 + 260 * Math.sin(now / 5000), g = ctx.createRadialGradient(gx, 300, 10, gx, 300, 170);
      g.addColorStop(0, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(330, 170, 620, 300);
    }
    ctx.fillStyle = '#565d63'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(400 + i * 120, 540, 28, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#e6edf3'; ctx.font = '15px Arial, sans-serif'; ['CAL', 'MODE', 'HOLD', 'MENU', 'ON'].forEach((t, i) => ctx.fillText(t, 384 + i * 120, 590));
    ctx.restore(); ctx.filter = 'none';
  }
  stop() { clearInterval(this.timer); this.stream.getTracks().forEach(t => t.stop()); }
}

// Which demo value a ROI is looking at: the display item whose screen box overlaps it most.
export const DEMO_ITEMS = {ph: {x: .33, y: .25, w: .3, h: .19}, do: {x: .33, y: .47, w: .32, h: .15}, temp: {x: .58, y: .26, w: .2, h: .08}};
export function demoItemFor(roi) {
  let best = null, score = 0;
  for (const [key, b] of Object.entries(DEMO_ITEMS)) {
    const ix = Math.max(0, Math.min(roi.x + roi.w, b.x + b.w) - Math.max(roi.x, b.x)), iy = Math.max(0, Math.min(roi.y + roi.h, b.y + b.h) - Math.max(roi.y, b.y));
    if (ix * iy > score) { score = ix * iy; best = key; }
  }
  return best;
}
