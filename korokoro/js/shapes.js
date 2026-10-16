/* 罐子外殼形狀：以基本圖形的聯集定義，提供「是否在內部」測試與繪製路徑 */
(function () {
  'use strict';
  const PM = window.PM, U = PM.U;

  const TARGET_W = 400, TARGET_H = 430;
  const SHELL_T = 14; // 外殼描邊粗細（設計單位）

  const circle = (cx, cy, r) => ({ t: 'circle', cx, cy, r });
  const ellipse = (cx, cy, rx, ry) => ({ t: 'ellipse', cx, cy, rx, ry });
  const rrect = (x, y, w, h, r) => ({ t: 'rrect', x, y, w, h, r });
  const poly = (pts) => ({ t: 'poly', pts: orient(pts) });

  // 統一成順時針（y 向下），nonzero 填色時聯集才不會互相抵銷
  function orient(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a < 0 ? pts.slice().reverse() : pts;
  }

  function roundedPoly(corners, radius, seg) {
    seg = seg || 8;
    const out = [], n = corners.length;
    for (let i = 0; i < n; i++) {
      const p = corners[i], a = corners[(i + n - 1) % n], b = corners[(i + 1) % n];
      const r = Array.isArray(radius) ? radius[i] : radius;
      const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const ta = Math.min(r, da * 0.45), tb = Math.min(r, db * 0.45);
      const s = [p[0] + ((a[0] - p[0]) / da) * ta, p[1] + ((a[1] - p[1]) / da) * ta];
      const e = [p[0] + ((b[0] - p[0]) / db) * tb, p[1] + ((b[1] - p[1]) / db) * tb];
      for (let k = 0; k <= seg; k++) {
        const t = k / seg, u = 1 - t;
        out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
      }
    }
    return out;
  }


  const DEFS = {
    jar: {
      name: '果醬罐', deco: 'jar', mouthX: 0,
      prims: () => [rrect(-175, -150, 350, 380, 86), rrect(-120, -200, 240, 120, 44)],
    },
    heart: {
      name: '愛心罐', deco: 'heart', mouthX: -92,
      prims: () => [
        circle(-92, -55, 112), circle(92, -55, 112),
        poly(roundedPoly([[-172.3, 23.1], [0, 200], [172.3, 23.1], [0, -55]], [0, 34, 0, 0])),
      ],
    },
    square: {
      name: '禮物盒', deco: 'gift', mouthX: 100,
      prims: () => [rrect(-190, -190, 380, 380, 42)],
    },
    ellipse: {
      name: '扭蛋', deco: 'capsule', mouthX: 0,
      prims: () => [ellipse(0, 0, 205, 165)],
    },
    bottle: {
      name: '魔法瓶', deco: 'flask', mouthX: 0,
      prims: () => [circle(0, 0, 195)],
    },
    pudding: {
      name: '布丁', deco: 'pudding', mouthX: 0,
      prims: () => [poly(roundedPoly([[-125, -175], [125, -175], [195, 185], [-195, 185]], [60, 60, 32, 32]))],
    },
    cloud: {
      name: '雲朵', deco: 'cloud', mouthX: 5,
      prims: () => [circle(-115, 25, 105), circle(5, -40, 130), circle(125, 20, 100), rrect(-220, 30, 440, 120, 60)],
    },
    cat: {
      name: '貓咪罐', deco: 'cat', mouthX: 0,
      prims: () => [
        circle(0, 40, 180),
        poly(roundedPoly([[-178, -10], [-150, -205], [-50, -125]], [20, 26, 20])),
        poly(roundedPoly([[178, -10], [150, -205], [50, -125]], [20, 26, 20])),
      ],
    },
  };

  function primInside(p, x, y) {
    switch (p.t) {
      case 'circle': {
        const dx = x - p.cx, dy = y - p.cy;
        return dx * dx + dy * dy <= p.r * p.r;
      }
      case 'ellipse': {
        const dx = (x - p.cx) / p.rx, dy = (y - p.cy) / p.ry;
        return dx * dx + dy * dy <= 1;
      }
      case 'rrect': {
        const hw = p.w / 2, hh = p.h / 2;
        const qx = Math.abs(x - p.x - hw) - (hw - p.r), qy = Math.abs(y - p.y - hh) - (hh - p.r);
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - p.r <= 0;
      }
      case 'poly': {
        let inside = false;
        const pts = p.pts;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
      }
    }
    return false;
  }

  function primPath(ctx, p) {
    switch (p.t) {
      case 'circle': ctx.moveTo(p.cx + p.r, p.cy); ctx.arc(p.cx, p.cy, p.r, 0, U.TAU); break;
      case 'ellipse': ctx.moveTo(p.cx + p.rx, p.cy); ctx.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, U.TAU); break;
      case 'rrect': U.roundRect(ctx, p.x, p.y, p.w, p.h, p.r); break;
      case 'poly':
        ctx.moveTo(p.pts[0][0], p.pts[0][1]);
        for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
        ctx.closePath();
        break;
    }
  }

  function primBounds(p) {
    switch (p.t) {
      case 'circle': return [p.cx - p.r, p.cy - p.r, p.cx + p.r, p.cy + p.r];
      case 'ellipse': return [p.cx - p.rx, p.cy - p.ry, p.cx + p.rx, p.cy + p.ry];
      case 'rrect': return [p.x, p.y, p.x + p.w, p.y + p.h];
      case 'poly': {
        const b = [1e9, 1e9, -1e9, -1e9];
        for (const q of p.pts) {
          b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]);
          b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]);
        }
        return b;
      }
    }
  }


  function xf(p, s, tx, ty) {
    switch (p.t) {
      case 'circle': return circle(p.cx * s + tx, p.cy * s + ty, p.r * s);
      case 'ellipse': return ellipse(p.cx * s + tx, p.cy * s + ty, p.rx * s, p.ry * s);
      case 'rrect': return rrect(p.x * s + tx, p.y * s + ty, p.w * s, p.h * s, p.r * s);
      case 'poly': return { t: 'poly', pts: p.pts.map((q) => [q[0] * s + tx, q[1] * s + ty]) };
    }
  }

  function build(id) {
    const d = DEFS[id];
    const raw = d.prims();
    const b = [1e9, 1e9, -1e9, -1e9];
    for (const p of raw) {
      const pb = primBounds(p);
      b[0] = Math.min(b[0], pb[0]); b[1] = Math.min(b[1], pb[1]);
      b[2] = Math.max(b[2], pb[2]); b[3] = Math.max(b[3], pb[3]);
    }
    const w = b[2] - b[0], h = b[3] - b[1];
    const s = Math.min(TARGET_W / w, TARGET_H / h);
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const prims = raw.map((p) => xf(p, s, -cx * s, -cy * s));
    const shape = {
      id, name: d.name, deco: d.deco, prims,
      w: w * s, h: h * s,
      bbox: { x0: -w * s / 2, y0: -h * s / 2, x1: w * s / 2, y1: h * s / 2 },
      mouthX: (d.mouthX - cx) * s,
      inside(x, y) {
        for (const p of prims) if (primInside(p, x, y)) return true;
        return false;
      },
      path(ctx) { for (const p of prims) primPath(ctx, p); },
    };
    shape.outline = traceOutline(shape);
    shape.rBound = shape.outline.reduce((m, q) => Math.max(m, Math.hypot(q[0], q[1])), 0);
    shape.outlinePath = (ctx) => {
      const o = shape.outline;
      ctx.moveTo(o[0][0], o[0][1]);
      for (let i = 1; i < o.length; i++) ctx.lineTo(o[i][0], o[i][1]);
      ctx.closePath();
    };
    return shape;
  }

  // 由中心往外打射線，取得聯集外框的單一多邊形（所有形狀對中心都是星形區域）
  function traceOutline(shape) {
    let cx = 0, cy = 0;
    for (let k = 0; !shape.inside(cx, cy) && k < 40; k++) cy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 6;
    const maxR = Math.hypot(shape.w, shape.h);
    const pts = [], n = 480;
    for (let a = 0; a < n; a++) {
      const th = (a / n) * U.TAU, dx = Math.cos(th), dy = Math.sin(th);
      let last = 0;
      for (let r = 0; r < maxR; r += 2) if (shape.inside(cx + dx * r, cy + dy * r)) last = r;
      let lo = last, hi = last + 2;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        if (shape.inside(cx + dx * mid, cy + dy * mid)) lo = mid; else hi = mid;
      }
      pts.push([cx + dx * lo, cy + dy * lo]);
    }
    return pts;
  }

  PM.SHAPES = {};
  for (const id in DEFS) PM.SHAPES[id] = build(id);
  PM.SHAPE_IDS = Object.keys(DEFS);
  PM.SHELL_T = SHELL_T;
  PM.primPath = primPath;
  PM.prim = { circle, ellipse, rrect, poly };
})();
