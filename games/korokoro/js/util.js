/* ころころ迷宮罐 — 共用工具 */
(function () {
  'use strict';
  const PM = (window.PM = window.PM || {});
  const TAU = Math.PI * 2;

  const U = {
    TAU,
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    smoothstep(a, b, v) {
      const t = U.clamp((v - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    },
    // 可重現的亂數（mulberry32）
    makeRng(seed) {
      let s = seed >>> 0 || 1;
      return function () {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    randSeed: () => (Math.random() * 4294967296) >>> 0,
    shuffle(a, rng) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    },
    pick: (a, rng) => a[Math.floor(rng() * a.length)],
    angleDiff(a, b) {
      let d = a - b;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      return d;
    },
    easeOutBack(t) {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    // localStorage 可能被封鎖（無痕模式等），一律包 try/catch
    store: {
      get(k, d) {
        try {
          const v = localStorage.getItem('korokoro.' + k);
          return v === null ? d : JSON.parse(v);
        } catch (e) { return d; }
      },
      set(k, v) {
        try { localStorage.setItem('korokoro.' + k, JSON.stringify(v)); } catch (e) { /* 忽略 */ }
      },
    },
    roundRect(ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.moveTo(x + r, y);
      ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
      ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
      ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
      ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
      ctx.closePath();
    },
    star(ctx, x, y, r, points, inner) {
      const n = points || 5, ir = r * (inner || 0.45);
      for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / n;
        const rr = i % 2 ? ir : r;
        if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
    },
    // 以白色(正值)或黑色(負值)混合顏色（#rrggbb）
    tint(hex, amt) {
      const n = parseInt(hex.slice(1), 16);
      let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
      else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
      return '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
    },
  };

  PM.U = U;
})();
