/* 內容物：物理參數、配色主題、向量繪製（清新可愛風） */
(function () {
  'use strict';
  const PM = window.PM, U = PM.U, TAU = U.TAU;

  // ---------- 共用繪圖 ----------
  function circles(ctx, list, k, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const b of list) {
      const R = b.r * k * b.k;
      for (let i = 0; i < b.px.length; i++) {
        ctx.moveTo(b.px[i] + R, b.py[i]);
        ctx.arc(b.px[i], b.py[i], R, 0, TAU);
      }
    }
    ctx.fill();
  }

  function shine(ctx, x, y, r, v, a) {
    ctx.fillStyle = 'rgba(255,255,255,' + (a || 0.85) + ')';
    ctx.beginPath();
    ctx.ellipse(x + v.hx * r * 0.42, y + v.hy * r * 0.42, r * 0.3, r * 0.19, Math.atan2(v.hy, v.hx) + Math.PI / 2, 0, TAU);
    ctx.fill();
  }

  function ball(ctx, x, y, r, fill, edge) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = r * 0.15;
    ctx.strokeStyle = edge;
    ctx.stroke();
  }

  function center(b) {
    let x = 0, y = 0;
    for (let i = 0; i < b.px.length; i++) { x += b.px[i]; y += b.py[i]; }
    return [x / b.px.length, y / b.px.length];
  }

  // 水、蜂蜜：粒子重疊融合成一團
  function blobBatch(p) {
    return (ctx, list, v) => {
      if (!list.length) return;
      circles(ctx, list, 1.62, p.edge);
      circles(ctx, list, 1.34, p.body);
      if (p.glow) {
        ctx.fillStyle = p.glow;
        ctx.beginPath();
        for (const b of list) {
          const R = b.r * 0.85 * b.k, x = b.px[0] + v.hx * b.r * 0.35, y = b.py[0] + v.hy * b.r * 0.35;
          ctx.moveTo(x + R, y);
          ctx.arc(x, y, R, 0, TAU);
        }
        ctx.fill();
      }
      ctx.fillStyle = p.hi;
      ctx.beginPath();
      for (const b of list) {
        if (b.id % 3) continue;
        const R = b.r * 0.34 * b.k, x = b.px[0] + v.hx * b.r * 0.55, y = b.py[0] + v.hy * b.r * 0.55;
        ctx.moveTo(x + R, y);
        ctx.arc(x, y, R, 0, TAU);
      }
      ctx.fill();
    };
  }

  function ballBatch(colors) {
    return (ctx, list, v) => {
      for (const b of list) {
        const x = b.px[0], y = b.py[0], r = b.r * b.k, c = colors[b.color % colors.length];
        ball(ctx, x, y, r, c[0], c[1]);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.93, 0, TAU);
        ctx.clip();
        ctx.translate(x, y);
        ctx.rotate(b.ang);
        ctx.fillStyle = c[2];
        ctx.fillRect(-r, -r * 0.2, r * 2, r * 0.4);
        ctx.restore();
        shine(ctx, x, y, r, v);
      }
    };
  }

  function lotteryBatch(colors) {
    return (ctx, list, v) => {
      if (!list.length) return;
      ctx.font = '800 ' + (list[0].r * 0.74).toFixed(2) + 'px "M PLUS Rounded 1c", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const b of list) {
        const x = b.px[0], y = b.py[0], r = b.r * b.k, c = colors[b.color % colors.length];
        ball(ctx, x, y, r, c[0], c[1]);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(b.ang);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.56, 0, TAU);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.fillStyle = c[1];
        ctx.fillText(String(b.num), 0, r * 0.05);
        ctx.restore();
        shine(ctx, x, y, r, v, 0.7);
      }
    };
  }

  function wrapEnds(ctx, r, fill, edge) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = edge;
    ctx.lineWidth = r * 0.11;
    ctx.lineJoin = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.75, 0);
      ctx.lineTo(s * r * 1.42, -r * 0.48);
      ctx.quadraticCurveTo(s * r * 1.25, 0, s * r * 1.42, r * 0.48);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  function candyBatch(colors) {
    return (ctx, list, v) => {
      for (const b of list) {
        const x = b.px[0], y = b.py[0], r = b.r * b.k, c = colors[b.color % colors.length];
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(b.ang);
        wrapEnds(ctx, r, c[2], c[1]);
        ball(ctx, 0, 0, r, c[0], c[1]);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.88, 0, TAU);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = r * 0.2;
        ctx.beginPath();
        for (const o of [-0.55, 0.55]) { ctx.moveTo(o * r - r, -r); ctx.lineTo(o * r + r, r); }
        ctx.stroke();
        ctx.restore();
        shine(ctx, x, y, r, v);
      }
    };
  }

  function capsuleFrame(ctx, b) {
    const x0 = b.px[0], y0 = b.py[0], x1 = b.px[1], y1 = b.py[1];
    const ang = Math.atan2(y1 - y0, x1 - x0);
    ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
    ctx.rotate(ang);
    return [Math.hypot(x1 - x0, y1 - y0) / 2, ang];
  }

  function capsulePath(ctx, half, r) {
    ctx.beginPath();
    ctx.arc(-half, 0, r, Math.PI / 2, Math.PI * 1.5);
    ctx.arc(half, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
  }

  function capsuleShine(ctx, half, r, ang, v) {
    const ly = -v.hx * Math.sin(ang) + v.hy * Math.cos(ang);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.24;
    ctx.beginPath();
    ctx.moveTo(-half * 0.9, Math.sign(ly || -1) * r * 0.45);
    ctx.lineTo(half * 0.5, Math.sign(ly || -1) * r * 0.45);
    ctx.stroke();
  }

  function pillBatch(colors) {
    return (ctx, list, v) => {
      for (const b of list) {
        const c = colors[b.color % colors.length], r = b.r * b.k;
        ctx.save();
        const [half, ang] = capsuleFrame(ctx, b);
        ctx.beginPath();
        ctx.arc(-half, 0, r, Math.PI / 2, Math.PI * 1.5);
        ctx.lineTo(0, -r);
        ctx.lineTo(0, r);
        ctx.closePath();
        ctx.fillStyle = c[0];
        ctx.fill();
        ctx.beginPath();
        ctx.arc(half, 0, r, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(0, r);
        ctx.lineTo(0, -r);
        ctx.closePath();
        ctx.fillStyle = c[1];
        ctx.fill();
        capsulePath(ctx, half, r);
        ctx.lineWidth = r * 0.16;
        ctx.strokeStyle = c[2];
        ctx.stroke();
        capsuleShine(ctx, half, r, ang, v);
        ctx.restore();
      }
    };
  }

  // 冰糖、鹽塊：多邊形結晶
  function crystalPts(b, k1, k2) {
    const [cx, cy] = center(b), n = b.px.length, r = b.r * b.k, pts = [];
    for (let i = 0; i < n; i++) {
      const dx = b.px[i] - cx, dy = b.py[i] - cy, d = Math.hypot(dx, dy) || 1;
      pts.push([cx + (dx / d) * (d * b.k + r * k1), cy + (dy / d) * (d * b.k + r * k1)]);
      const j = (i + 1) % n;
      const mx = (b.px[i] + b.px[j]) / 2 - cx, my = (b.py[i] + b.py[j]) / 2 - cy, md = Math.hypot(mx, my) || 1;
      pts.push([cx + (mx / md) * (md * b.k + r * k2), cy + (my / md) * (md * b.k + r * k2)]);
    }
    return [cx, cy, pts];
  }

  function crystal(ctx, b, fill, edge, facet, v) {
    const [cx, cy, pts] = crystalPts(b, 0.95, 0.8);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = b.r * 0.2;
    ctx.strokeStyle = edge;
    ctx.stroke();
    ctx.lineWidth = b.r * 0.12;
    ctx.strokeStyle = facet;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) { ctx.moveTo(cx, cy); ctx.lineTo(pts[i][0], pts[i][1]); }
    ctx.stroke();
    shine(ctx, cx, cy, b.r * 1.6, v, 0.8);
  }

  function crystalBatch(fill, edge, facet) {
    return (ctx, list, v) => { for (const b of list) crystal(ctx, b, fill, edge, facet, v); };
  }

  function grainBatch(colors) {
    return (ctx, list, v) => {
      for (let ci = 0; ci < colors.length; ci++) {
        ctx.fillStyle = colors[ci];
        ctx.beginPath();
        for (const b of list) {
          if (b.color % colors.length !== ci) continue;
          const x = b.px[0], y = b.py[0], r = b.r * b.k * 1.08, a = b.ang;
          for (let k = 0; k < 5; k++) {
            const aa = a + (k * TAU) / 5 + (k % 2 ? 0.2 : 0), rr = r * (k % 2 ? 0.92 : 1.12);
            const px = x + Math.cos(aa) * rr, py = y + Math.sin(aa) * rr;
            if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          }
          ctx.closePath();
        }
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      for (const b of list) {
        if (b.id % 4) continue;
        const R = b.r * 0.32, x = b.px[0] + v.hx * b.r * 0.4, y = b.py[0] + v.hy * b.r * 0.4;
        ctx.moveTo(x + R, y);
        ctx.arc(x, y, R, 0, TAU);
      }
      ctx.fill();
    };
  }

  function quadFrame(ctx, b) {
    const [cx, cy] = center(b);
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(b.py[1] - b.py[0], b.px[1] - b.px[0]));
    return Math.hypot(b.px[1] - b.px[0], b.py[1] - b.py[0]) * b.k + b.r * 2 * b.k * 0.92;
  }

  // ---------- 加分物 ----------
  function drawIce(ctx, b, v) {
    ctx.save();
    const s = quadFrame(ctx, b);
    ctx.beginPath();
    U.roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.22);
    ctx.fillStyle = 'rgba(226,247,255,0.95)';
    ctx.fill();
    ctx.lineWidth = s * 0.07;
    ctx.strokeStyle = '#6EC3EC';
    ctx.stroke();
    ctx.beginPath();
    U.roundRect(ctx, -s * 0.3, -s * 0.3, s * 0.6, s * 0.6, s * 0.12);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();
    ctx.restore();
    const [cx, cy] = center(b);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    U.star(ctx, cx + v.hx * s * 0.25, cy + v.hy * s * 0.25, s * 0.16, 4, 0.35);
    ctx.fill();
  }

  function drawRainbowPill(ctx, b, v) {
    const r = b.r * b.k;
    ctx.save();
    const [half, ang] = capsuleFrame(ctx, b);
    const g = ctx.createLinearGradient(-half - r, 0, half + r, 0);
    ['#FF8FA3', '#FFC36E', '#FFF07A', '#8EE6A6', '#7CC8FF', '#C59BFF'].forEach((c, i) => g.addColorStop(i / 5, c));
    capsulePath(ctx, half, r);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = r * 0.16;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    capsuleShine(ctx, half, r, ang, v);
    ctx.restore();
  }

  function drawStarBall(ctx, b, v) {
    const x = b.px[0], y = b.py[0], r = b.r * b.k;
    ball(ctx, x, y, r, '#6C63C9', '#4C43A6');
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.ang);
    ctx.fillStyle = '#FFE36E';
    ctx.beginPath();
    U.star(ctx, 0, 0, r * 0.42, 5, 0.45);
    U.star(ctx, r * 0.55, -r * 0.45, r * 0.16, 5, 0.45);
    U.star(ctx, -r * 0.5, r * 0.5, r * 0.13, 5, 0.45);
    ctx.fill();
    ctx.restore();
    shine(ctx, x, y, r, v, 0.6);
  }

  function drawGoldBall(ctx, b, v) {
    const x = b.px[0], y = b.py[0], r = b.r * b.k;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#FFF6C2');
    g.addColorStop(0.5, '#FFD54A');
    g.addColorStop(1, '#E0A21B');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = r * 0.15;
    ctx.strokeStyle = '#C98A10';
    ctx.stroke();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.ang);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.56, 0, TAU);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.fillStyle = '#F2B230';
    ctx.beginPath();
    U.star(ctx, 0, 0, r * 0.4, 5, 0.45);
    ctx.fill();
    ctx.restore();
    shine(ctx, x, y, r, v, 0.8);
  }

  function drawRainbowCandy(ctx, b, v) {
    const x = b.px[0], y = b.py[0], r = b.r * b.k;
    const cols = ['#FF8FA3', '#FFC36E', '#FFF07A', '#8EE6A6', '#7CC8FF', '#C59BFF'];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.ang);
    wrapEnds(ctx, r, '#FFF4FA', '#E9A6C8');
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, (i * TAU) / 6, ((i + 1) * TAU) / 6);
      ctx.closePath();
      ctx.fillStyle = cols[i];
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = r * 0.13;
    ctx.beginPath();
    for (let a = 0; a < 9; a += 0.25) {
      const rr = (a / 9) * r * 0.85;
      if (a) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.moveTo(0, 0);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.lineWidth = r * 0.14;
    ctx.strokeStyle = '#E58AB4';
    ctx.stroke();
    ctx.restore();
    shine(ctx, x, y, r, v);
  }

  function drawFly(ctx, b, v) {
    const x = b.px[0], y = b.py[0], r = b.r * b.k;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.ang * 0.3);
    ctx.fillStyle = 'rgba(225,238,255,0.92)';
    ctx.strokeStyle = '#9AAFC9';
    ctx.lineWidth = r * 0.08;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * r * 0.55, -r * 0.55, r * 0.55, r * 0.32, s * -0.6, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.strokeStyle = '#4A4350';
    ctx.lineWidth = r * 0.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of [-1, 1]) {
      for (const k of [-0.3, 0.1, 0.45]) { ctx.moveTo(s * r * 0.4, r * k); ctx.lineTo(s * r * 0.95, r * (k + 0.25)); }
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, r * 0.15, r * 0.48, r * 0.62, 0, 0, TAU);
    ctx.fillStyle = '#5B5463';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -r * 0.45, r * 0.38, 0, TAU);
    ctx.fillStyle = '#6E6677';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = r * 0.09;
    ctx.beginPath();
    for (const s of [-1, 1]) {
      const ex = s * r * 0.16, ey = -r * 0.5, q = r * 0.09;
      ctx.moveTo(ex - q, ey - q); ctx.lineTo(ex + q, ey + q);
      ctx.moveTo(ex + q, ey - q); ctx.lineTo(ex - q, ey + q);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawAntSugar(ctx, b, v) {
    crystal(ctx, b, '#FFFFFF', '#7FA8D6', 'rgba(127,168,214,0.55)', v);
    const [cx, cy] = center(b), s = b.r * 0.9;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(b.ang + 0.6);
    ctx.strokeStyle = '#3B3340';
    ctx.lineWidth = s * 0.14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const k of [-0.5, 0, 0.5]) {
      ctx.moveTo(s * k, 0); ctx.lineTo(s * k - s * 0.25, -s * 0.55);
      ctx.moveTo(s * k, 0); ctx.lineTo(s * k - s * 0.25, s * 0.55);
    }
    ctx.moveTo(s * 0.95, 0); ctx.lineTo(s * 1.35, -s * 0.35);
    ctx.moveTo(s * 0.95, 0); ctx.lineTo(s * 1.35, s * 0.35);
    ctx.stroke();
    ctx.fillStyle = '#3B3340';
    ctx.beginPath();
    ctx.arc(-s * 0.7, 0, s * 0.36, 0, TAU);
    ctx.arc(0, 0, s * 0.24, 0, TAU);
    ctx.arc(s * 0.62, 0, s * 0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s * 0.72, -s * 0.1, s * 0.09, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawSaltBlock(ctx, b, v) {
    ctx.save();
    const s = quadFrame(ctx, b);
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.2);
    ctx.lineTo(-s * 0.22, -s * 0.5);
    ctx.lineTo(s * 0.35, -s * 0.46);
    ctx.lineTo(s * 0.5, s * 0.1);
    ctx.lineTo(s * 0.2, s * 0.5);
    ctx.lineTo(-s * 0.4, s * 0.42);
    ctx.closePath();
    ctx.fillStyle = '#F4A0B2';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = s * 0.06;
    ctx.strokeStyle = '#D9708A';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.moveTo(-s * 0.22, -s * 0.5);
    ctx.lineTo(s * 0.35, -s * 0.46);
    ctx.lineTo(0, -s * 0.05);
    ctx.lineTo(-s * 0.5, -s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---------- 定義 ----------
  // r / d 以「格子邊長 S」為單位；fill = 房間格點的填充比例；max = 上限（效能）
  PM.MATERIALS = {
    water: {
      name: '清水', unit: '滴', geom: 'single', r: 0.072, fill: 0.62, max: 320,
      phys: { e: 0.05, mu: 0.02, drag: 0.35 }, cohesion: 0.22, cohRange: 0.5, visc: 0.04,
      theme: { bg: ['#D9F0FF', '#FDF3FF'], shell: '#7DBDE8', wall: '#FFFFFF', corridor: '#EAF6FF', shadow: '#C4E0F4', accent: '#4AA3E0', fx: 'bubble' },
      pile: ['#7CC7F4', '#A9DCFA', '#5DB4EE'],
      batch: blobBatch({ edge: '#3D98D9', body: '#7CC7F4', hi: 'rgba(255,255,255,0.9)' }),
      bonus: { name: '冰塊', geom: 'quad', r: 0.07, d: 0.14, phys: { e: 0.1, mu: 0.05, drag: 0.6, density: 0.5 }, float: true, draw: drawIce, color: '#BDE9FF' },
    },
    pills: {
      name: '藥丸', unit: '顆', geom: 'pill', r: 0.135, d: 0.25, fill: 0.92, max: 60, wallK: 0.065,
      phys: { e: 0.2, mu: 0.3, drag: 0.4 },
      theme: { bg: ['#F2E6FF', '#FFF0F6'], shell: '#B597E6', wall: '#FFFFFF', corridor: '#F6F0FF', shadow: '#E0D1F5', accent: '#9A74DE', fx: 'petal' },
      pile: ['#FF9EB8', '#8FD3F4', '#FFD36E', '#C7B3FF'],
      colors: [['#FF9EB8', '#FFFFFF', '#E07592'], ['#8FD3F4', '#FFFFFF', '#5BAFD8'], ['#FFD36E', '#FFFFFF', '#DDA43A'], ['#A8E6A1', '#FFFFFF', '#6CC062'], ['#C7B3FF', '#FFFFFF', '#9C82E8']],
      bonus: { name: '彩虹藥丸', geom: 'pill', r: 0.15, d: 0.27, phys: { e: 0.2, mu: 0.3, drag: 0.4 }, draw: drawRainbowPill, color: '#FFC36E' },
    },
    balls: {
      name: '彈力球', unit: '顆', geom: 'single', r: 0.2, fill: 0.92, max: 60, wallK: 0.07,
      phys: { e: 0.86, mu: 0.05, drag: 0.08 },
      theme: { bg: ['#E3FFF2', '#FFF4EA'], shell: '#86D6B8', wall: '#FFFFFF', corridor: '#EFFCF6', shadow: '#CDEFE2', accent: '#3DBE90', fx: 'dot' },
      pile: ['#FFB3C7', '#A8E6CF', '#FFD3B6', '#C9BFFF'],
      colors: [['#FFB3C7', '#E58AA5', '#FFE3EB'], ['#A8E6CF', '#66C49E', '#DDF7EC'], ['#FFD3B6', '#EDA47A', '#FFEDE1'], ['#C9BFFF', '#9A89EA', '#ECE8FF'], ['#FFF0A0', '#E2C455', '#FFF9D9'], ['#AEE3F5', '#6CBDDD', '#DDF4FB']],
      bonus: { name: '星星球', geom: 'single', r: 0.23, phys: { e: 0.86, mu: 0.05, drag: 0.08 }, draw: drawStarBall, color: '#FFE36E' },
    },
    lottery: {
      name: '抽獎球', unit: '顆', geom: 'single', r: 0.25, fill: 0.95, max: 45, wallK: 0.07,
      phys: { e: 0.35, mu: 0.15, drag: 0.3 },
      theme: { bg: ['#FFF5D3', '#FFEDE6'], shell: '#F2BF5E', wall: '#FFFDF7', corridor: '#FFF8E6', shadow: '#F3E3BF', accent: '#E9992B', fx: 'confetti' },
      pile: ['#FF8FA3', '#6EC6FF', '#FFD166', '#7BD389'],
      colors: [['#FF8FA3', '#D9627A'], ['#6EC6FF', '#3D9BD6'], ['#FFD166', '#D29E2E'], ['#7BD389', '#4FAE60'], ['#C3A6FF', '#9277DB'], ['#FFA45B', '#D97D35']],
      bonus: { name: '金色彩球', geom: 'single', r: 0.28, phys: { e: 0.35, mu: 0.15, drag: 0.3 }, draw: drawGoldBall, color: '#FFD54A' },
    },
    candy: {
      name: '糖果', unit: '顆', geom: 'single', r: 0.215, fill: 0.92, max: 60, wallK: 0.06,
      phys: { e: 0.25, mu: 0.25, drag: 0.4 },
      theme: { bg: ['#FFE4F0', '#F1ECFF'], shell: '#F297BC', wall: '#FFFFFF', corridor: '#FFF1F7', shadow: '#F5D6E4', accent: '#EA6A9E', fx: 'heart' },
      pile: ['#FF9EC4', '#9FD8FF', '#FFE07A', '#B9F2A8'],
      colors: [['#FF9EC4', '#DE6C9B', '#FFD6E7'], ['#9FD8FF', '#5EAFE6', '#D8EFFF'], ['#FFE07A', '#DDB23C', '#FFF2C4'], ['#B9F2A8', '#78C962', '#E4FADB'], ['#D9B8FF', '#A683E6', '#F0E4FF']],
      bonus: { name: '彩虹糖', geom: 'single', r: 0.24, phys: { e: 0.25, mu: 0.25, drag: 0.4 }, draw: drawRainbowCandy, color: '#FF8FA3' },
    },
    honey: {
      name: '蜂蜜', unit: '滴', geom: 'single', r: 0.085, fill: 0.6, max: 260,
      phys: { e: 0, mu: 0.35, drag: 1.3 }, cohesion: 1.05, cohRange: 0.65, visc: 0.26, adhesion: 0.22,
      theme: { bg: ['#FFF4D2', '#FFF0E0'], shell: '#E7B04F', wall: '#FFFDF5', corridor: '#FFF7E3', shadow: '#F2E2BC', accent: '#DE9214', fx: 'dot' },
      pile: ['#F6B93B', '#FFD56B', '#E89E1C'],
      batch: blobBatch({ edge: '#D3870A', body: '#F6B93B', glow: '#FFD36B', hi: 'rgba(255,255,255,0.85)' }),
      bonus: { name: '蒼蠅', geom: 'single', r: 0.11, phys: { e: 0, mu: 0.35, drag: 1.3 }, cohesive: true, draw: drawFly, color: '#6E6677' },
    },
    sugar: {
      name: '冰糖', unit: '塊', geom: 'tri', r: 0.09, d: 0.17, fill: 0.72, max: 70, sticky: { mode: 1, frac: 0.08 }, bond: 'rgba(127,168,214,0.75)',
      phys: { e: 0.15, mu: 0.3, drag: 0.5 },
      theme: { bg: ['#EAF5FF', '#F6F0FF'], shell: '#A3C3EC', corridorTint: 0.72, wallTint: 0.35, wall: '#FFFFFF', corridor: '#F2F8FF', shadow: '#D8E6F6', accent: '#6799D6', fx: 'sparkle' },
      pile: ['#FFFFFF', '#E3EEFA', '#CFE0F2'],
      batch: crystalBatch('#FFFFFF', '#7FA8D6', 'rgba(127,168,214,0.55)'),
      bonus: { name: '螞蟻糖', geom: 'tri', r: 0.1, d: 0.19, phys: { e: 0.15, mu: 0.3, drag: 0.5 }, draw: drawAntSugar, color: '#3B3340' },
    },
    salt: {
      name: '玫瑰鹽', unit: '粒', geom: 'single', r: 0.068, fill: 0.6, max: 260, sticky: { mode: 2, frac: 0.08 }, bond: 'rgba(214,112,138,0.7)',
      phys: { e: 0.05, mu: 0.35, drag: 0.5 },
      theme: { bg: ['#FFE9EC', '#FFF6EE'], shell: '#EB9DA9', wall: '#FFFDFC', corridor: '#FFF3F3', shadow: '#F5DADD', accent: '#DD7488', fx: 'petal' },
      pile: ['#F7B2BD', '#F29CAD', '#FAD4DA'],
      colors: ['#F7B2BD', '#F29CAD', '#FAD4DA', '#EE8FA1'],
      bonus: { name: '鹽塊', geom: 'quad', r: 0.065, d: 0.13, phys: { e: 0.1, mu: 0.4, drag: 0.5 }, draw: drawSaltBlock, color: '#F4A0B2' },
    },
  };

  const M = PM.MATERIALS;
  M.pills.batch = pillBatch(M.pills.colors);
  M.balls.batch = ballBatch(M.balls.colors);
  M.lottery.batch = lotteryBatch(M.lottery.colors);
  M.candy.batch = candyBatch(M.candy.colors);
  M.salt.batch = grainBatch(M.salt.colors);
  for (const id in M) { M[id].id = id; M[id].bonus.id = id + 'Bonus'; }
  PM.MATERIAL_IDS = Object.keys(M);
  PM.RAINBOW = ['#FF8FA3', '#FFC36E', '#FFF07A', '#8EE6A6', '#7CC8FF', '#C59BFF'];
})();
