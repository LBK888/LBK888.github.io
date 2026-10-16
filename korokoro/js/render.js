/* 繪製：背景、罐子（靜態圖層快取）、內容物、特效、底部盤子與小貓 */
(function () {
  'use strict';
  const PM = window.PM, U = PM.U, TAU = U.TAU;
  const INK = '#5A4A5E';
  const FONT = '"M PLUS Rounded 1c", "Zen Maru Gothic", "PingFang TC", "Microsoft JhengHei", sans-serif';

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.W = 1; this.H = 1; this.dpr = 1;
      this.mode = 'touch';
      this.view = 0;
      this.safe = { top: 0, bottom: 0 };
      this.fx = []; this.ui = []; this.poured = []; this.petals = [];
      this.plate = { pct: 0, shown: 0, bump: 0 };
      this.cat = { mood: 'idle', t: 0, blink: 2 };
      this.jig = { x: 0, y: 0, a: 0 };
      this.flash = 0; this.pop = 0; this.time = 0;
      this._normal = []; this._bonus = [];
    }

    resize(W, H) {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.W = W; this.H = H;
      this.cv.width = Math.round(W * this.dpr);
      this.cv.height = Math.round(H * this.dpr);
      this.cv.style.width = W + 'px';
      this.cv.style.height = H + 'px';
      this.bg = null;
      if (this.shape) this.layout();
    }

    setLevel(shape, maze, mat) {
      this.shape = shape; this.maze = maze; this.mat = mat;
      // 牆與實心部分用外殼色的淺色調，通道接近白色，迷宮一眼就看得清楚
      const sh = mat.theme.shell;
      const t = mat.theme;
      this.theme = Object.assign({}, t, { wall: U.tint(sh, t.wallTint || 0.55), corridor: U.tint(sh, t.corridorTint || 0.93), shadow: U.tint(sh, 0.3) });
      this.bg = null;
      this.poured.length = 0;
      this.fx.length = 0;
      this.ui = this.ui.filter((u) => u.kind === 'confetti');
      this.flash = 0;
      this.pop = 0;
      this.layout();
      if (!this.petals.length) for (let i = 0; i < 14; i++) this.petals.push(this.newPetal(true));
    }

    setMode(mode) {
      this.mode = mode;
      if (this.shape) this.layout();
    }

    layout() {
      const T = PM.SHELL_T, sh = this.shape, mz = this.maze;
      const top = this.safe.top + 76, bottom = this.safe.bottom + 128;
      const availW = this.W - 18, availH = Math.max(140, this.H - top - bottom);
      const ext = { x0: sh.bbox.x0 - T, x1: sh.bbox.x1 + T, y0: Math.min(sh.bbox.y0, mz.exitY - T) - T, y1: sh.bbox.y1 + T };
      let s, ox = 0, oy = 0;
      if (this.mode === 'touch') {
        const R = Math.max(sh.rBound, Math.hypot(mz.exitX, mz.exitY - T)) + T;
        s = Math.min(availW, availH) / (2 * R);
      } else {
        s = Math.min(availW / (ext.x1 - ext.x0), availH / (ext.y1 - ext.y0));
        ox = (ext.x0 + ext.x1) / 2; oy = (ext.y0 + ext.y1) / 2;
      }
      this.scale = Math.min(s, 1.4);
      this.cx = this.W / 2 - ox * this.scale;
      this.cy = top + availH / 2 - oy * this.scale;
      this.plateX = this.W / 2;
      this.plateY = this.H - this.safe.bottom - 74;
      this.buildStatic();
    }

    toScreen(x, y) {
      const c = Math.cos(this.view), s = Math.sin(this.view);
      return [this.cx + (x * c - y * s) * this.scale, this.cy + (x * s + y * c) * this.scale];
    }

    buildStatic() {
      const sh = this.shape, mz = this.maze, pad = 80;
      const x0 = sh.bbox.x0 - pad, y0 = Math.min(sh.bbox.y0, mz.exitY) - pad;
      const x1 = sh.bbox.x1 + pad, y1 = sh.bbox.y1 + pad;
      const k = this.scale * this.dpr;
      const c = this.staticCv || (this.staticCv = document.createElement('canvas'));
      c.width = Math.max(1, Math.ceil((x1 - x0) * k));
      c.height = Math.max(1, Math.ceil((y1 - y0) * k));
      const g = c.getContext('2d');
      g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
      this.staticBox = { x0, y0, w: x1 - x0, h: y1 - y0 };
      drawContainer(g, sh, mz, this.theme, k);
    }

    // ---------- 每幀 ----------
    update(dt, game) {
      this.time += dt;
      this.flash = Math.max(0, this.flash - dt * 2.5);
      this.pop = Math.max(0, this.pop - dt * 1.6);
      this.plate.bump = Math.max(0, this.plate.bump - dt * 4);
      this.plate.shown += (this.plate.pct - this.plate.shown) * (1 - Math.exp(-dt * 6));
      this.jig.a = Math.max(0, this.jig.a - dt * 3.5);
      this.jig.x = (Math.random() - 0.5) * this.jig.a * 12;
      this.jig.y = (Math.random() - 0.5) * this.jig.a * 12;
      const cat = this.cat;
      cat.t -= dt;
      if (cat.t <= 0 && cat.mood !== 'worry') cat.mood = 'idle';
      cat.blink -= dt;
      if (cat.blink < -0.12) cat.blink = 2 + Math.random() * 3;
      // 倒出的物件沿重力繼續掉落、縮小消失
      const gx = game.input.dx * 1800, gy = game.input.dy * 1800;
      for (let i = this.poured.length - 1; i >= 0; i--) {
        const b = this.poured[i];
        b.vx = (b.vx + gx * dt) * (1 - 0.8 * dt);
        b.vy = (b.vy + gy * dt) * (1 - 0.8 * dt);
        for (let k = 0; k < b.px.length; k++) { b.px[k] += b.vx * dt; b.py[k] += b.vy * dt; }
        b.ang += dt * 6;
        b.life -= dt;
        b.k = Math.min(1, b.life / 0.35);
        if (b.life <= 0) this.poured.splice(i, 1);
      }
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const p = this.fx[i];
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt;
        p.life -= dt;
        if (p.life <= 0) this.fx.splice(i, 1);
      }
      for (let i = this.ui.length - 1; i >= 0; i--) {
        const u = this.ui[i];
        u.t += dt;
        if (u.kind === 'confetti') { u.x += u.vx * dt; u.y += u.vy * dt; u.vy += 240 * dt; u.rot += u.vr * dt; }
        if (u.t >= u.dur) {
          this.ui.splice(i, 1);
          if (u.kind === 'spark') this.plate.bump = 1;
        }
      }
      for (const p of this.petals) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.y < -30 || p.y > this.H + 30 || p.x < -30 || p.x > this.W + 30) Object.assign(p, this.newPetal(false));
      }
    }

    addPoured(b, color) {
      b.life = 0.9;
      this.poured.push(b);
      const [sx, sy] = this.toScreen(b.cx, b.cy);
      this.ui.push({
        kind: 'spark', x0: sx, y0: sy, x1: this.plateX + (Math.random() - 0.5) * 40, y1: this.plateY - 14,
        side: (Math.random() - 0.5) * 120, t: 0, dur: 0.45 + Math.random() * 0.2, color: color || this.theme.accent,
      });
    }

    burst(x, y, color, n, speed, kind) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, v = speed * (0.4 + Math.random() * 0.6);
        this.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, max: 0.9, color, size: 3 + Math.random() * 4, kind: kind || 'star' });
      }
    }

    popup(text, x, y, color, size, dur) {
      this.ui.push({ kind: 'text', text, x, y, color: color || INK, size: size || 20, t: 0, dur: dur || 1 });
    }

    confetti() {
      const cols = PM.RAINBOW;
      for (let i = 0; i < 70; i++) {
        this.ui.push({
          kind: 'confetti', x: Math.random() * this.W, y: -20 - Math.random() * this.H * 0.4,
          vx: (Math.random() - 0.5) * 80, vy: 60 + Math.random() * 120, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10,
          color: cols[i % cols.length], t: 0, dur: 3.2, w: 6 + Math.random() * 6, h: 4 + Math.random() * 4,
        });
      }
    }

    setCat(mood, t) {
      if (this.cat.mood === 'star' && mood === 'happy' && this.cat.t > 0) return;
      this.cat.mood = mood; this.cat.t = t || 0.6;
    }

    newPetal(anywhere) {
      const fx = this.theme ? this.theme.fx : 'petal';
      const up = fx === 'bubble';
      return {
        x: Math.random() * this.W,
        y: anywhere ? Math.random() * this.H : up ? this.H + 20 : -20,
        vx: (Math.random() - 0.5) * 18, vy: (up ? -1 : 1) * (12 + Math.random() * 20),
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 1.5, s: 4 + Math.random() * 6, fx,
      };
    }

    draw(game) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawBackground(ctx);
      if (this.shape && game.world) {
        const rot = this.view + this.jig.a * Math.sin(this.time * 60) * 0.02;
        const s = this.scale * (1 + Math.sin(this.pop * 16) * this.pop * 0.05);
        ctx.save();
        ctx.translate(this.cx + this.jig.x, this.cy + this.jig.y);
        ctx.rotate(rot);
        ctx.scale(s, s);
        const b = this.staticBox;
        ctx.drawImage(this.staticCv, b.x0, b.y0, b.w, b.h);
        // 亮點固定在螢幕左上方
        const c = Math.cos(-rot), sn = Math.sin(-rot);
        const v = { hx: -0.62 * c + 0.78 * sn, hy: -0.62 * sn - 0.78 * c, t: this.time };
        this.drawBodies(ctx, game.world.bodies, v, false);
        if (this.poured.length) this.drawBodies(ctx, this.poured, v, true);
        this.drawFx(ctx, 1 / s);
        ctx.restore();
      }
      if (game.showPlate) this.drawPlate(ctx, game);
      this.drawUI(ctx);
      if (this.flash > 0) {
        ctx.fillStyle = 'rgba(255,255,255,' + (this.flash * 0.7).toFixed(3) + ')';
        ctx.fillRect(0, 0, this.W, this.H);
      }
    }

    drawBodies(ctx, bodies, v, poured) {
      const normal = this._normal, bonus = this._bonus;
      normal.length = 0; bonus.length = 0;
      for (const b of bodies) {
        if (b.poured !== poured) continue;
        (b.bonus ? bonus : normal).push(b);
      }
      for (const b of bonus) {
        if (poured) continue;
        const [x, y] = [b.cx, b.cy];
        const pr = b.r * (2.3 + Math.sin(this.time * 5 + b.id) * 0.35);
        ctx.fillStyle = 'rgba(255,236,140,0.38)';
        ctx.beginPath();
        ctx.arc(x, y, pr, 0, TAU);
        ctx.fill();
        if (Math.random() < 0.08) {
          const a = Math.random() * TAU;
          this.fx.push({ x: x + Math.cos(a) * pr, y: y + Math.sin(a) * pr, vx: 0, vy: -10, life: 0.6, max: 0.6, color: '#FFE36E', size: 3 + Math.random() * 2.5, kind: 'star' });
        }
      }
      if (normal.length) this.mat.batch(ctx, normal, v);
      for (const b of bonus) this.mat.bonus.draw(ctx, b, v);
    }

    drawFx(ctx, inv) {
      for (const p of this.fx) {
        const a = U.clamp(p.life / (p.max || 0.8), 0, 1);
        const sz = p.size * inv * (0.5 + a * 0.5);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        if (p.kind === 'dot') ctx.arc(p.x, p.y, sz * 0.6, 0, TAU);
        else U.star(ctx, p.x, p.y, sz, 4, 0.38);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    drawBackground(ctx) {
      const W = this.W, H = this.H, th = this.theme || PM.MATERIALS.candy.theme;
      if (!this.bg || this.bgTheme !== th.bg) {
        if (W < 2 || H < 2) return;
        const c = this.bg || (this.bg = document.createElement('canvas'));
        c.width = Math.ceil(W * this.dpr); c.height = Math.ceil(H * this.dpr);
        const g = c.getContext('2d');
        g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        const grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, th.bg[0]);
        grad.addColorStop(1, th.bg[1]);
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(255,255,255,0.55)';
        const sp = 34;
        for (let y = 0, row = 0; y < H + sp; y += sp * 0.87, row++) {
          for (let x = (row % 2) * sp / 2; x < W + sp; x += sp) {
            g.beginPath();
            g.arc(x, y, 3.2, 0, TAU);
            g.fill();
          }
        }
        this.bgTheme = th.bg;
      }
      ctx.drawImage(this.bg, 0, 0, W, H);
      for (const p of this.petals) drawPetal(ctx, p, th);
    }

    drawPlate(ctx, game) {
      const th = this.theme, mat = this.mat, W = this.W;
      const x = this.plateX, y = this.plateY - Math.sin(this.plate.bump * Math.PI) * 3;
      const rx = Math.min(80, W * 0.2), ry = rx * 0.25;
      const pct = this.plate.shown;
      ctx.fillStyle = 'rgba(120,90,130,0.13)';
      ctx.beginPath(); ctx.ellipse(x, y + ry * 0.95, rx * 1.02, ry * 0.65, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = th.shell; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y - 1, rx * 0.72, ry * 0.6, 0, 0, TAU);
      ctx.fillStyle = th.corridor; ctx.fill();
      ctx.fillStyle = th.shell;
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU;
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * rx * 0.86, y + Math.sin(a) * ry * 0.82, 1.6, 0, TAU); ctx.fill();
      }
      if (pct > 0.004) {
        const mh = 5 + 42 * Math.min(1, pct), mw = rx * (0.5 + 0.38 * Math.min(1, pct * 1.6));
        ctx.save();
        ctx.beginPath(); ctx.ellipse(x, y - 1, mw, mh, 0, Math.PI, TAU); ctx.closePath();
        ctx.fillStyle = mat.pile[0]; ctx.fill();
        ctx.clip();
        for (let i = 0; i < 46; i++) {
          const hx = ((i * 0.6180339) % 1) - 0.5, hy = (i * 0.7548776) % 1;
          ctx.fillStyle = mat.pile[i % mat.pile.length];
          ctx.beginPath(); ctx.arc(x + hx * 2 * mw, y - hy * mh, 3.4, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath(); ctx.ellipse(x - mw * 0.35, y - mh * 0.62, mw * 0.18, mh * 0.12, -0.4, 0, TAU); ctx.fill();
        ctx.restore();
      }
      this.drawCat(ctx, x - rx - 34, y - 6, 27);

      const bx = 22, bw = W - 44, bh = 14, by = this.H - this.safe.bottom - 24;
      ctx.beginPath(); U.roundRect(ctx, bx, by, bw, bh, bh / 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = th.shell; ctx.stroke();
      const fw = Math.max(0, Math.min(1, pct)) * (bw - 4);
      if (fw > 1) {
        const gr = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        gr.addColorStop(0, U.tint(th.accent, 0.35)); gr.addColorStop(1, th.accent);
        ctx.beginPath(); U.roundRect(ctx, bx + 2, by + 2, Math.max(fw, bh - 4), bh - 4, (bh - 4) / 2);
        ctx.fillStyle = gr; ctx.fill();
      }
      const tx = bx + 2 + game.target * (bw - 4);
      ctx.fillStyle = game.cleared ? '#5CC98F' : '#FF7B9C';
      ctx.beginPath(); ctx.moveTo(tx, by - 2); ctx.lineTo(tx - 6, by - 11); ctx.lineTo(tx + 6, by - 11); ctx.closePath(); ctx.fill();
      ctx.fillRect(tx - 1, by - 2, 2, bh + 4);
      ctx.font = '700 11px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(game.cleared ? 'OK!' : '目標', U.clamp(tx, bx + 14, bx + bw - 14), by - 12);
      ctx.textAlign = 'left';
      ctx.font = '800 22px ' + FONT;
      ctx.fillStyle = INK;
      ctx.fillText(Math.round(pct * 100) + '%', bx, by - 6);
      ctx.textAlign = 'right';
      ctx.font = '700 12px ' + FONT;
      ctx.fillStyle = U.tint(INK, 0.25);
      ctx.fillText(game.poured + ' / ' + game.total + ' ' + mat.unit, bx + bw, by - 6);
      if (game.combo >= 5 && game.clock - game.lastPourT < 0.9) {
        const k = 1 + Math.max(0, 0.25 - (game.clock - game.lastPourT)) * 1.6;
        ctx.save();
        ctx.translate(x, y - 64);
        ctx.scale(k, k);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '800 18px ' + FONT;
        ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round';
        const t = game.combo + ' COMBO';
        ctx.strokeText(t, 0, 0);
        ctx.fillStyle = th.accent; ctx.fillText(t, 0, 0);
        ctx.restore();
      }
    }

    drawCat(ctx, x, y, s) {
      const m = this.cat.mood;
      ctx.save();
      ctx.translate(x, y + (m === 'happy' || m === 'star' ? Math.abs(Math.sin(this.time * 14)) * -3 : Math.sin(this.time * 2) * 0.8));
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#7A6A80';
      for (const sd of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(sd * s * 0.68, -s * 0.3); ctx.lineTo(sd * s * 0.74, -s * 1.02); ctx.lineTo(sd * s * 0.12, -s * 0.66); ctx.closePath();
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sd * s * 0.6, -s * 0.42); ctx.lineTo(sd * s * 0.66, -s * 0.86); ctx.lineTo(sd * s * 0.28, -s * 0.64); ctx.closePath();
        ctx.fillStyle = '#FFC2D1'; ctx.fill();
      }
      ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.8, 0, 0, TAU);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,150,175,0.45)';
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sd * s * 0.52, s * 0.2, s * 0.17, s * 0.1, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = ctx.strokeStyle = '#4A3E50';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (const sd of [-1, 1]) {
        const ex = sd * s * 0.36, ey = -s * 0.06;
        if (m === 'star') { ctx.fillStyle = '#FFC93C'; ctx.beginPath(); U.star(ctx, ex, ey, s * 0.2, 5, 0.45); ctx.fill(); }
        else if (m === 'happy' || this.cat.blink < 0) { ctx.beginPath(); ctx.arc(ex, ey + s * 0.06, s * 0.12, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
        else {
          ctx.fillStyle = '#4A3E50'; ctx.beginPath(); ctx.arc(ex, ey, s * 0.1, 0, TAU); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + s * 0.03, ey - s * 0.04, s * 0.035, 0, TAU); ctx.fill();
        }
      }
      ctx.strokeStyle = '#4A3E50';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(-s * 0.08, s * 0.18, s * 0.08, 0.1, Math.PI - 0.1);
      ctx.arc(s * 0.08, s * 0.18, s * 0.08, 0.1, Math.PI - 0.1);
      ctx.stroke();
      ctx.fillStyle = '#FF9FB5';
      ctx.beginPath(); ctx.ellipse(0, s * 0.1, s * 0.07, s * 0.05, 0, 0, TAU); ctx.fill();
      if (m === 'worry') {
        ctx.fillStyle = '#9ED8F5';
        ctx.beginPath(); ctx.moveTo(s * 0.8, -s * 0.5); ctx.quadraticCurveTo(s * 0.95, -s * 0.25, s * 0.8, -s * 0.2); ctx.quadraticCurveTo(s * 0.65, -s * 0.25, s * 0.8, -s * 0.5); ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#7A6A80';
      ctx.beginPath(); ctx.ellipse(s * 0.95, s * 0.62, s * 0.24, s * 0.17, 0.3, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    drawUI(ctx) {
      for (const u of this.ui) {
        const k = U.clamp(u.t / u.dur, 0, 1);
        if (u.kind === 'spark') {
          const e = k * k * (3 - 2 * k), it = 1 - e;
          const cx = (u.x0 + u.x1) / 2 + u.side, cy = Math.min(u.y0, u.y1) - 50;
          const x = it * it * u.x0 + 2 * it * e * cx + e * e * u.x1;
          const y = it * it * u.y0 + 2 * it * e * cy + e * e * u.y1;
          ctx.fillStyle = u.color;
          ctx.beginPath(); U.star(ctx, x, y, 6 - k * 2, 4, 0.4); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill();
        } else if (u.kind === 'text') {
          const a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
          const sc = k < 0.12 ? 0.6 + (k / 0.12) * 0.55 : k < 0.2 ? 1.15 - ((k - 0.12) / 0.08) * 0.15 : 1;
          ctx.save();
          ctx.globalAlpha = a;
          ctx.translate(u.x, u.y - 36 * U.easeOutCubic(k));
          ctx.scale(sc, sc);
          ctx.font = '800 ' + u.size + 'px ' + FONT;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(4, u.size * 0.28); ctx.strokeStyle = '#fff';
          ctx.strokeText(u.text, 0, 0);
          ctx.fillStyle = u.color; ctx.fillText(u.text, 0, 0);
          ctx.restore();
        } else if (u.kind === 'confetti') {
          ctx.save();
          ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
          ctx.translate(u.x, u.y); ctx.rotate(u.rot);
          ctx.fillStyle = u.color;
          ctx.fillRect(-u.w / 2, -u.h / 2, u.w, u.h * Math.abs(Math.cos(u.rot * 1.7)));
          ctx.restore();
        }
      }
    }
  }

  function drawPetal(ctx, p, th) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = 0.55;
    const s = p.s;
    if (p.fx === 'bubble') {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-s * 0.35, -s * 0.35, s * 0.25, 0, TAU); ctx.fill();
    } else if (p.fx === 'heart') {
      ctx.fillStyle = U.tint(th.shell, 0.35);
      ctx.beginPath(); ctx.moveTo(0, s * 0.6);
      ctx.bezierCurveTo(-s * 1.2, -s * 0.2, -s * 0.5, -s, 0, -s * 0.35);
      ctx.bezierCurveTo(s * 0.5, -s, s * 1.2, -s * 0.2, 0, s * 0.6); ctx.fill();
    } else if (p.fx === 'sparkle' || p.fx === 'confetti') {
      ctx.fillStyle = p.fx === 'sparkle' ? '#fff' : PM.RAINBOW[Math.floor(p.s * 7) % 6];
      ctx.beginPath(); U.star(ctx, 0, 0, s, 4, 0.4); ctx.fill();
    } else if (p.fx === 'dot') {
      ctx.fillStyle = U.tint(th.shell, 0.3); ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = '#FFC4D6';
      ctx.beginPath(); ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(s * 0.9, -s * 0.2, 0, s);
      ctx.quadraticCurveTo(-s * 0.9, -s * 0.2, 0, -s); ctx.fill();
    }
    ctx.restore();
  }

  function segPath(g, mz, ox, oy) {
    g.beginPath();
    for (let s = 0; s < mz.nSeg; s++) {
      const o = s * 4;
      g.moveTo(mz.segs[o] + ox, mz.segs[o + 1] + oy);
      g.lineTo(mz.segs[o + 2] + ox, mz.segs[o + 3] + oy);
    }
  }

  // 外殼描邊（在瓶頸處留開口）；extraClip 可再限制範圍（扭蛋上半部換色用）
  function strokeShell(g, sh, mz, color, width, extraClip) {
    const T = PM.SHELL_T, S = mz.S, rw = mz.rw;
    g.save();
    if (extraClip) { g.beginPath(); extraClip(g); g.clip(); }
    g.beginPath();
    g.rect(-9999, -9999, 19998, 19998);
    g.rect(mz.neckX0 + rw, mz.exitY - 60, mz.neckX1 - mz.neckX0 - 2 * rw, mz.neckBaseY - mz.exitY + 60 + S * 0.3);
    g.clip('evenodd');
    g.beginPath();
    sh.outlinePath(g);
    g.lineJoin = 'round';
    g.lineWidth = width || T;
    g.strokeStyle = color;
    g.stroke();
    g.restore();
  }

  function drawContainer(g, sh, mz, th, k) {
    const T = PM.SHELL_T, S = mz.S, rw = mz.rw;
    const tube = { x: mz.neckX0 - rw - 0.5, y: mz.exitY, w: mz.neckX1 - mz.neckX0 + 2 * rw + 1, h: mz.neckBaseY - mz.exitY + S * 0.6 };
    const corridorPath = () => {
      g.beginPath();
      for (const list of [mz.roomCells, mz.mazeCells, mz.neckCells]) {
        for (const c of list) {
          const p = mz.cellCenter(c);
          g.rect(p[0] - S / 2 - 0.6, p[1] - S / 2 - 0.6, S + 1.2, S + 1.2);
        }
      }
    };
    g.save();
    g.shadowColor = 'rgba(110,80,120,0.25)';
    g.shadowBlur = 20 * k;
    g.shadowOffsetY = 8 * k;
    g.fillStyle = th.shell;
    g.beginPath(); sh.outlinePath(g); g.fill();
    g.beginPath(); U.roundRect(g, tube.x - T, tube.y - T * 0.6, tube.w + 2 * T, tube.h, T); g.fill();
    g.restore();

    g.lineJoin = 'round';
    g.beginPath(); U.roundRect(g, tube.x, tube.y, tube.w, tube.h, 3);
    g.lineWidth = T * 2; g.strokeStyle = th.shell; g.stroke();
    g.fillStyle = th.wall; g.fill();
    g.beginPath(); sh.outlinePath(g); g.fillStyle = th.wall; g.fill();
    decoUnder(g, sh, mz, th);

    corridorPath(); g.fillStyle = th.corridor; g.fill();
    g.save();
    corridorPath(); g.clip();
    g.globalAlpha = 0.45;
    g.fillStyle = th.shadow;
    g.beginPath();
    for (const c of mz.roomCells) {
      const p = mz.cellCenter(c);
      for (const [ox, oy] of [[-0.25, -0.25], [0.25, 0.25]]) { g.moveTo(p[0] + ox * S + S * 0.05, p[1] + oy * S); g.arc(p[0] + ox * S, p[1] + oy * S, S * 0.05, 0, TAU); }
    }
    g.fill();
    g.globalAlpha = 1;
    g.lineCap = 'round';
    g.lineWidth = rw * 2;
    segPath(g, mz, S * 0.035, S * 0.06);
    g.strokeStyle = th.shadow;
    g.stroke();
    g.restore();

    g.lineCap = 'round';
    g.lineWidth = rw * 2;
    segPath(g, mz, 0, 0);
    g.strokeStyle = th.wall;
    g.stroke();

    strokeShell(g, sh, mz, th.shell);

    g.save();
    g.beginPath(); sh.outlinePath(g); g.clip();
    const R = Math.min(sh.w, sh.h) / 2;
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineCap = 'round';
    g.lineWidth = T * 0.8;
    g.beginPath(); g.arc(0, 0, R * 0.84, Math.PI * 1.08, Math.PI * 1.36); g.stroke();
    g.lineWidth = T * 0.45;
    g.beginPath(); g.arc(0, 0, R * 0.84, Math.PI * 1.43, Math.PI * 1.51); g.stroke();
    g.restore();

    const lh = T * 1.15;
    g.fillStyle = th.shell;
    g.beginPath();
    U.roundRect(g, mz.neckX0 - rw - T, mz.exitY - lh * 0.55, T + 2 * rw, lh, lh / 2);
    U.roundRect(g, mz.neckX1 - rw, mz.exitY - lh * 0.55, T + 2 * rw, lh, lh / 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    U.roundRect(g, mz.neckX0 - rw - T * 0.7, mz.exitY - lh * 0.35, T * 0.8, lh * 0.25, lh * 0.12);
    U.roundRect(g, mz.neckX1 + rw * 0.2, mz.exitY - lh * 0.35, T * 0.8, lh * 0.25, lh * 0.12);
    g.fill();
    decoOver(g, sh, mz, th);
  }

  function decoUnder(g, sh, mz, th) {
    const b = sh.bbox;
    if (sh.deco === 'pudding') {
      g.save();
      g.beginPath(); sh.outlinePath(g); g.clip();
      g.fillStyle = '#E9A863';
      g.beginPath();
      g.moveTo(b.x0 - 10, b.y0 - 10);
      g.lineTo(b.x1 + 10, b.y0 - 10);
      const yb = b.y0 + sh.h * 0.2;
      for (let x = b.x1 + 10; x >= b.x0 - 10; x -= 8) g.lineTo(x, yb + Math.sin(x * 0.06) * 6 + (Math.sin(x * 0.23) > 0.85 ? 14 : 0));
      g.closePath();
      g.fill();
      g.restore();
    } else if (sh.deco === 'cat') {
      g.fillStyle = '#FFC9D6';
      for (const p of sh.prims.slice(1)) {
        let cx = 0, cy = 0;
        for (const q of p.pts) { cx += q[0]; cy += q[1]; }
        cx /= p.pts.length; cy /= p.pts.length;
        g.beginPath();
        p.pts.forEach((q, i) => { const x = cx + (q[0] - cx) * 0.55, y = cy + (q[1] - cy) * 0.55 - 6; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.closePath();
        g.fill();
      }
    }
  }

  function bow(g, x, y, s, color, edge) {
    g.save();
    g.translate(x, y);
    g.fillStyle = color; g.strokeStyle = edge; g.lineWidth = 2.5; g.lineJoin = 'round';
    for (const sd of [-1, 1]) {
      g.beginPath(); g.moveTo(0, 0);
      g.bezierCurveTo(sd * s * 1.3, -s * 0.9, sd * s * 1.3, s * 0.9, 0, 0);
      g.fill(); g.stroke();
      g.beginPath(); g.moveTo(sd * s * 0.1, s * 0.15); g.lineTo(sd * s * 0.55, s * 1.05); g.lineTo(sd * s * 0.2, s * 0.9); g.closePath();
      g.fill(); g.stroke();
    }
    g.beginPath(); g.arc(0, 0, s * 0.24, 0, TAU); g.fill(); g.stroke();
    g.restore();
  }

  function sparkle(g, x, y, s, color) {
    g.fillStyle = color;
    g.beginPath(); U.star(g, x, y, s, 4, 0.35); g.fill();
  }

  function decoOver(g, sh, mz, th) {
    const b = sh.bbox, T = PM.SHELL_T, edge = U.tint(th.shell, -0.18);
    switch (sh.deco) {
      case 'jar': {
        g.save();
        g.translate(b.x1 - 58, b.y0 - 6);
        g.rotate(0.32);
        g.beginPath(); U.roundRect(g, -50, -14, 100, 28, 11);
        g.fillStyle = '#FF9FB7'; g.fill();
        g.save(); g.clip();
        g.fillStyle = 'rgba(255,255,255,0.45)';
        for (let x = -50; x < 50; x += 14) g.fillRect(x, -14, 7, 28);
        for (let y = -14; y < 14; y += 14) g.fillRect(-50, y, 100, 7);
        g.restore();
        g.lineWidth = 3; g.strokeStyle = '#E07592'; g.stroke();
        g.restore();
        bow(g, mz.neckX0 - mz.rw - T * 1.2, (mz.exitY + mz.neckBaseY) / 2 + 6, 13, '#FFD36E', '#D9A43A');
        break;
      }
      case 'heart': {
        for (const sd of [-1, 1]) {
          g.save();
          g.translate(sd * (b.x1 - 6), b.y0 + sh.h * 0.3);
          g.scale(sd, 1);
          g.fillStyle = '#fff'; g.strokeStyle = th.shell; g.lineWidth = 3;
          for (let i = 2; i >= 0; i--) {
            g.beginPath(); g.ellipse(14 + i * 6, -10 + i * 13, 24 - i * 4, 10, -0.5 + i * 0.25, 0, TAU);
            g.fill(); g.stroke();
          }
          g.restore();
        }
        sparkle(g, b.x1 - 20, b.y0 + 4, 9, '#FFD36E');
        sparkle(g, b.x0 + 30, b.y1 - 70, 7, '#fff');
        break;
      }
      case 'gift':
        bow(g, b.x0 + 46, b.y0 + 8, 26, th.accent, edge);
        break;
      case 'capsule':
        strokeShell(g, sh, mz, '#FFB3CB', T, (c) => c.rect(-9999, -9999, 19998, 9999));
        g.fillStyle = '#fff';
        for (const sd of [-1, 1]) { g.beginPath(); U.roundRect(g, sd * b.x1 - 9, -4, 18, 8, 4); g.fill(); }
        sparkle(g, b.x1 - 30, b.y0 + 10, 9, '#FFD36E');
        break;
      case 'flask': {
        g.save();
        g.translate(mz.neckX1 + 56, mz.exitY - 6);
        g.rotate(0.5);
        g.beginPath(); g.moveTo(-15, -18); g.lineTo(15, -18); g.lineTo(11, 18); g.lineTo(-11, 18); g.closePath();
        g.fillStyle = '#E2B07A'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#B97F45'; g.stroke();
        g.strokeStyle = 'rgba(185,127,69,0.5)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(-8, -6); g.lineTo(8, -6); g.moveTo(-6, 6); g.lineTo(6, 6); g.stroke();
        g.restore();
        const tx = mz.neckX0 - mz.rw - T, ty = mz.neckBaseY + 4;
        g.strokeStyle = edge; g.lineWidth = 2;
        g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(tx - 30, ty + 6, tx - 46, ty + 26); g.stroke();
        g.save(); g.translate(tx - 52, ty + 40); g.rotate(-0.3);
        g.beginPath(); U.roundRect(g, -16, -14, 32, 30, 6);
        g.fillStyle = '#FFF7E0'; g.fill(); g.strokeStyle = edge; g.stroke();
        sparkle(g, 0, 1, 8, th.accent);
        g.restore();
        break;
      }
      case 'pudding': {
        const x = b.x1 * 0.45, y = b.y0 + 2;
        g.fillStyle = '#fff'; g.strokeStyle = '#EAD8C8'; g.lineWidth = 2;
        for (const [dx, dy, r] of [[-16, 4, 13], [16, 4, 13], [0, -6, 15]]) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, TAU); g.fill(); g.stroke(); }
        g.strokeStyle = '#6E9E4F'; g.lineWidth = 3; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x + 2, y - 26); g.quadraticCurveTo(x + 8, y - 44, x + 20, y - 50); g.stroke();
        g.beginPath(); g.arc(x, y - 22, 11, 0, TAU); g.fillStyle = '#F2546E'; g.fill();
        g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(x - 4, y - 26, 3.2, 0, TAU); g.fill();
        break;
      }
      case 'cloud':
        sparkle(g, b.x0 + 18, b.y0 + 40, 10, '#FFD36E');
        sparkle(g, b.x1 - 10, b.y0 + 60, 7, '#fff');
        g.fillStyle = '#9ED3F5';
        for (const [x, y] of [[-70, b.y1 + 22], [-20, b.y1 + 34], [40, b.y1 + 20]]) {
          g.beginPath(); g.moveTo(x, y - 9); g.quadraticCurveTo(x + 6, y, x, y + 4); g.quadraticCurveTo(x - 6, y, x, y - 9); g.fill();
        }
        break;
      case 'cat': {
        g.strokeStyle = edge; g.lineWidth = 3; g.lineCap = 'round';
        for (const sd of [-1, 1]) {
          const x = sd * (b.x1 - 4);
          g.beginPath();
          for (const k of [-1, 0, 1]) { g.moveTo(x, 40 + k * 14); g.lineTo(x + sd * 42, 34 + k * 22); }
          g.stroke();
          g.beginPath(); g.ellipse(sd * 62, b.y1 - 4, 30, 18, 0, 0, TAU);
          g.fillStyle = '#fff'; g.fill(); g.strokeStyle = th.shell; g.lineWidth = 3; g.stroke();
          g.fillStyle = '#FFB7C9';
          for (const t of [-1, 0, 1]) { g.beginPath(); g.arc(sd * 62 + t * 10, b.y1 - 9 + Math.abs(t) * 2, 4, 0, TAU); g.fill(); }
          g.strokeStyle = edge;
        }
        break;
      }
    }
  }

  PM.Renderer = Renderer;
  PM.FONT = FONT;
})();
