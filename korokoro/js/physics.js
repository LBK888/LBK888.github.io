/* 物理引擎：圓形粒子 + 剛性連結（藥丸、冰糖、冰塊）+ 膠囊形狀的靜態牆。
   牆永遠不動，玩家轉手機時轉的是「重力」，所以內容物不可能被牆甩出去。
   每幀切成多個子步，並限制每子步位移小於（牆半徑+粒子半徑），杜絕穿牆。 */
(function () {
  'use strict';
  const PM = window.PM;

  const SUB_HZ = 480;     // 子步頻率
  const REST_V = 45;      // 低於此法向速度不反彈（避免堆疊時抖動）
  const IMPACT_V = 160;   // 超過此速度才算「撞擊」（給音效用）

  class World {
    constructor(maze, capacity) {
      this.maze = maze;
      this.cap = capacity;
      this.n = 0;
      const F = Float32Array;
      this.x = new F(capacity); this.y = new F(capacity);
      this.vx = new F(capacity); this.vy = new F(capacity);
      this.lx = new F(capacity); this.ly = new F(capacity);
      this.r = new F(capacity); this.w = new F(capacity);
      this.e = new F(capacity); this.mu = new F(capacity); this.drag = new F(capacity);
      this.coh = new Uint8Array(capacity);
      this.active = new Uint8Array(capacity);
      this.bodyOf = new Int32Array(capacity);
      this.pc = new Int32Array(capacity);
      this.sorted = new Int32Array(capacity);
      this.la = []; this.lb = []; this.lL = [];
      this.bodies = [];
      this.rMin = 1e9; this.rMax = 0;
      this.G = 1800;
      this.cohesion = 0; this.cohRange = 0.5; this.visc = 0;
      this.impacts = 0; this.impactMax = 0;
      this.speedSum = 0; this.activeCount = 0;
    }

    // geom: single | pill | tri | quad；size 皆為設計單位
    addBody(spec, x, y, ang) {
      const parts = [];
      const r = spec.r;
      let offs;
      if (spec.geom === 'pill') offs = [[-spec.d / 2, 0], [spec.d / 2, 0]];
      else if (spec.geom === 'tri') {
        const rho = spec.d / Math.sqrt(3);
        offs = [0, 1, 2].map((k) => [Math.cos((k * 2 * Math.PI) / 3) * rho, Math.sin((k * 2 * Math.PI) / 3) * rho]);
      } else if (spec.geom === 'quad') {
        const h = spec.d / 2;
        offs = [[-h, -h], [h, -h], [h, h], [-h, h]];
      } else offs = [[0, 0]];
      const c = Math.cos(ang), s = Math.sin(ang);
      const id = this.bodies.length;
      const mass = (spec.density || 1) * r * r;
      for (const [ox, oy] of offs) {
        const i = this.n++;
        this.x[i] = this.lx[i] = x + ox * c - oy * s;
        this.y[i] = this.ly[i] = y + ox * s + oy * c;
        this.vx[i] = this.vy[i] = 0;
        this.r[i] = r;
        this.w[i] = 1 / mass;
        this.e[i] = spec.e; this.mu[i] = spec.mu; this.drag[i] = spec.drag;
        this.coh[i] = spec.cohesive ? 1 : 0;
        this.active[i] = 1;
        this.bodyOf[i] = id;
        this.rMin = Math.min(this.rMin, r);
        this.rMax = Math.max(this.rMax, r);
        parts.push(i);
      }
      for (let a = 0; a < parts.length; a++) {
        for (let b = a + 1; b < parts.length; b++) {
          const pa = parts[a], pb = parts[b];
          this.la.push(pa); this.lb.push(pb);
          this.lL.push(Math.hypot(this.x[pb] - this.x[pa], this.y[pb] - this.y[pa]));
        }
      }
      const body = {
        id, spec, parts, r,
        px: new Float32Array(parts.length), py: new Float32Array(parts.length),
        cx: x, cy: y, ang, k: 1,
        poured: false, color: 0, num: 0, bonus: !!spec.bonus,
      };
      for (let k = 0; k < parts.length; k++) { body.px[k] = this.x[parts[k]]; body.py[k] = this.y[parts[k]]; }
      this.bodies.push(body);
      return body;
    }

    // 所有粒子加入後呼叫：配置空間雜湊
    prepare() {
      const m = this.maze;
      this.hs = Math.max(this.rMax * 2.2, 4);
      this.hx0 = m.x0 - m.S; this.hy0 = m.y0 - m.S;
      this.gw = Math.ceil((m.C + 2) * m.S / this.hs);
      this.gh = Math.ceil((m.R + 2) * m.S / this.hs);
      const nc = this.gw * this.gh;
      this.cellStart = new Int32Array(nc + 1);
      this.cellCount = new Int32Array(nc);
      this.cursor = new Int32Array(nc);
    }

    step(dt, gx, gy, rot) {
      const steps = Math.max(1, Math.min(16, Math.ceil(dt * SUB_HZ)));
      const h = dt / steps;
      this.impacts = 0; this.impactMax = 0;
      for (let s = 0; s < steps; s++) this.substep(h, gx, gy, rot);
    }

    substep(h, gx, gy, rot) {
      const { x, y, vx, vy, active, drag } = this;
      const vmax = (0.8 * (this.maze.rw + this.rMin)) / h;
      const vmax2 = vmax * vmax;
      const lim = this.G * 2.5;
      for (let i = 0; i < this.n; i++) {
        if (!active[i]) continue;
        let ax = gx, ay = gy;
        if (rot) {
          // 旋轉座標系的假想力：離心力 + 歐拉力 + 科氏力（觸控旋轉模式用）
          const w = rot.w, al = rot.alpha;
          let fx = (w * w * x[i] + al * y[i] + 2 * w * vy[i]) * rot.k;
          let fy = (w * w * y[i] - al * x[i] - 2 * w * vx[i]) * rot.k;
          const fm = Math.hypot(fx, fy);
          if (fm > lim) { fx *= lim / fm; fy *= lim / fm; }
          ax += fx; ay += fy;
        }
        const damp = 1 - drag[i] * h;
        let nvx = (vx[i] + ax * h) * damp, nvy = (vy[i] + ay * h) * damp;
        const s2 = nvx * nvx + nvy * nvy;
        if (s2 > vmax2) { const f = vmax / Math.sqrt(s2); nvx *= f; nvy *= f; }
        vx[i] = nvx; vy[i] = nvy;
        x[i] += nvx * h; y[i] += nvy * h;
      }
      this.buildHash();
      this.solvePairs(h);
      this.solveLinks();
      this.solveWalls();
      this.solveLinks();
      this.solveWalls();
    }

    buildHash() {
      const { x, y, active, n, pc } = this;
      const inv = 1 / this.hs, gw = this.gw, gh = this.gh, bx = this.hx0, by = this.hy0;
      const count = this.cellCount, start = this.cellStart, cursor = this.cursor;
      count.fill(0);
      for (let i = 0; i < n; i++) {
        if (!active[i]) { pc[i] = -1; continue; }
        let cx = Math.floor((x[i] - bx) * inv), cy = Math.floor((y[i] - by) * inv);
        cx = cx < 0 ? 0 : cx >= gw ? gw - 1 : cx;
        cy = cy < 0 ? 0 : cy >= gh ? gh - 1 : cy;
        const c = cy * gw + cx;
        pc[i] = c;
        count[c]++;
      }
      let acc = 0;
      const nc = gw * gh;
      for (let c = 0; c < nc; c++) { start[c] = acc; cursor[c] = acc; acc += count[c]; }
      start[nc] = acc;
      for (let i = 0; i < n; i++) if (pc[i] >= 0) this.sorted[cursor[pc[i]]++] = i;
    }

    solvePairs(h) {
      const { x, y, vx, vy, r, w, e, mu, coh, bodyOf, active, pc, sorted, cellStart } = this;
      const gw = this.gw, gh = this.gh;
      const cohOn = this.cohesion > 0 || this.visc > 0;
      const cohK = this.cohesion * this.G * h, visc = this.visc, cohR = this.cohRange;
      for (let i = 0; i < this.n; i++) {
        if (!active[i]) continue;
        const c = pc[i], cx = c % gw, cy = (c / gw) | 0;
        const gx0 = cx > 0 ? cx - 1 : 0, gx1 = cx < gw - 1 ? cx + 1 : cx;
        const gy0 = cy > 0 ? cy - 1 : 0, gy1 = cy < gh - 1 ? cy + 1 : cy;
        for (let gy = gy0; gy <= gy1; gy++) {
          for (let gx = gx0; gx <= gx1; gx++) {
            const cell = gy * gw + gx;
            for (let k = cellStart[cell], end = cellStart[cell + 1]; k < end; k++) {
              const j = sorted[k];
              if (j <= i || bodyOf[j] === bodyOf[i]) continue;
              let dx = x[j] - x[i], dy = y[j] - y[i];
              const R = r[i] + r[j];
              const d2 = dx * dx + dy * dy;
              if (d2 < R * R) {
                let d = Math.sqrt(d2);
                if (d < 1e-5) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
                const nx = dx / d, ny = dy / d;
                const wi = w[i], wj = w[j], ws = wi + wj;
                const corr = (R - d) / ws;
                x[i] -= nx * corr * wi; y[i] -= ny * corr * wi;
                x[j] += nx * corr * wj; y[j] += ny * corr * wj;
                const rvx = vx[j] - vx[i], rvy = vy[j] - vy[i];
                const vn = rvx * nx + rvy * ny;
                if (vn < 0) {
                  const ee = -vn > REST_V ? Math.min(e[i], e[j]) : 0;
                  const jn = (-(1 + ee) * vn) / ws;
                  const tx = -ny, ty = nx;
                  const vt = rvx * tx + rvy * ty;
                  const mf = (mu[i] + mu[j]) * 0.5 * jn;
                  let jt = -vt / ws;
                  if (jt > mf) jt = mf; else if (jt < -mf) jt = -mf;
                  const ix = jn * nx + jt * tx, iy = jn * ny + jt * ty;
                  vx[i] -= ix * wi; vy[i] -= iy * wi;
                  vx[j] += ix * wj; vy[j] += iy * wj;
                  if (-vn > IMPACT_V) { this.impacts++; if (-vn > this.impactMax) this.impactMax = -vn; }
                }
                if (cohOn && coh[i] && coh[j] && visc > 0) {
                  const kx = rvx * visc * 0.5, ky = rvy * visc * 0.5;
                  vx[i] += kx; vy[i] += ky; vx[j] -= kx; vy[j] -= ky;
                }
              } else if (cohOn && coh[i] && coh[j]) {
                const Rc = R * (1 + cohR);
                if (d2 < Rc * Rc) {
                  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
                  const s = 1 - (d - R) / (Rc - R);
                  const f = cohK * s;
                  vx[i] += nx * f; vy[i] += ny * f;
                  vx[j] -= nx * f; vy[j] -= ny * f;
                  if (visc > 0) {
                    const kx = (vx[j] - vx[i]) * visc * 0.5 * s, ky = (vy[j] - vy[i]) * visc * 0.5 * s;
                    vx[i] += kx; vy[i] += ky; vx[j] -= kx; vy[j] -= ky;
                  }
                }
              }
            }
          }
        }
      }
    }

    solveLinks() {
      const { x, y, vx, vy, w, active, la, lb, lL } = this;
      for (let k = 0; k < la.length; k++) {
        const a = la[k], b = lb[k];
        if (!active[a]) continue;
        const dx = x[b] - x[a], dy = y[b] - y[a];
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-6) continue;
        const nx = dx / d, ny = dy / d;
        const wa = w[a], wb = w[b], ws = wa + wb;
        const diff = d - lL[k];
        x[a] += nx * diff * wa / ws; y[a] += ny * diff * wa / ws;
        x[b] -= nx * diff * wb / ws; y[b] -= ny * diff * wb / ws;
        const rv = (vx[b] - vx[a]) * nx + (vy[b] - vy[a]) * ny;
        vx[a] += nx * rv * wa / ws; vy[a] += ny * rv * wa / ws;
        vx[b] -= nx * rv * wb / ws; vy[b] -= ny * rv * wb / ws;
      }
    }

    solveWalls() {
      const { x, y, vx, vy, r, e, mu, active } = this;
      const m = this.maze, segs = m.segs, idx = m.wallIdx, S = m.S, gx0 = m.x0, gy0 = m.y0, C = m.C, R = m.R, rw = m.rw;
      for (let i = 0; i < this.n; i++) {
        if (!active[i]) continue;
        const ci = Math.floor((x[i] - gx0) / S), cj = Math.floor((y[i] - gy0) / S);
        if (ci < 0 || cj < 0 || ci >= C || cj >= R) continue;
        const list = idx[cj * C + ci];
        if (!list) continue;
        const Rr = r[i] + rw;
        for (let q = 0; q < list.length; q++) {
          const o = list[q] * 4;
          const ax = segs[o], ay = segs[o + 1], abx = segs[o + 2] - ax, aby = segs[o + 3] - ay;
          let t = ((x[i] - ax) * abx + (y[i] - ay) * aby) / (abx * abx + aby * aby);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = x[i] - (ax + abx * t), dy = y[i] - (ay + aby * t);
          const d2 = dx * dx + dy * dy;
          if (d2 >= Rr * Rr) continue;
          let d = Math.sqrt(d2), nx, ny;
          if (d < 1e-6) { const L = Math.hypot(abx, aby); nx = -aby / L; ny = abx / L; d = 0; }
          else { nx = dx / d; ny = dy / d; }
          x[i] += nx * (Rr - d); y[i] += ny * (Rr - d);
          const vn = vx[i] * nx + vy[i] * ny;
          if (vn < 0) {
            const ee = -vn > REST_V ? e[i] : 0;
            vx[i] -= (1 + ee) * vn * nx; vy[i] -= (1 + ee) * vn * ny;
            const tx = -ny, ty = nx;
            const vt = vx[i] * tx + vy[i] * ty;
            const mf = mu[i] * (1 + ee) * -vn;
            const dv = vt > mf ? mf : vt < -mf ? -mf : vt;
            vx[i] -= dv * tx; vy[i] -= dv * ty;
            if (-vn > IMPACT_V) { this.impacts++; if (-vn > this.impactMax) this.impactMax = -vn; }
          }
        }
      }
    }

    // 每幀結束：同步位置到 body、判定倒出、救援穿牆、更新滾動角度
    postStep(dt, gdx, gdy) {
      const { x, y, vx, vy, r, lx, ly } = this;
      const m = this.maze, S = m.S;
      const exited = [];
      let speed = 0, cnt = 0;
      for (const b of this.bodies) {
        if (b.poured) continue;
        const P = b.parts, np = P.length;
        let cx = 0, cy = 0;
        for (let k = 0; k < np; k++) { cx += x[P[k]]; cy += y[P[k]]; }
        cx /= np; cy /= np;
        b.cx = cx; b.cy = cy;
        if (cy < m.exitY && Math.abs(cx - m.exitX) < S * 1.5) { exited.push(b); continue; }
        let valid = true;
        for (let k = 0; k < np; k++) {
          const i = P[k];
          if (m.typeAt(x[i], y[i]) !== 0) continue;
          if (y[i] < m.exitY + S * 0.5 && Math.abs(x[i] - m.exitX) < S * 1.5) continue;
          valid = false;
        }
        if (valid) {
          for (let k = 0; k < np; k++) { const i = P[k]; lx[i] = x[i]; ly[i] = y[i]; }
        } else {
          for (let k = 0; k < np; k++) { const i = P[k]; x[i] = lx[i]; y[i] = ly[i]; vx[i] = vy[i] = 0; }
          cx = 0; cy = 0;
          for (let k = 0; k < np; k++) { cx += x[P[k]]; cy += y[P[k]]; }
          b.cx = cx / np; b.cy = cy / np;
        }
        for (let k = 0; k < np; k++) {
          const i = P[k];
          b.px[k] = x[i]; b.py[k] = y[i];
          speed += Math.abs(vx[i]) + Math.abs(vy[i]);
          cnt++;
        }
        if (np === 1) {
          const i = P[0];
          b.ang += ((vx[i] * gdy - vy[i] * gdx) / r[i]) * dt;
        } else {
          b.ang = Math.atan2(y[P[1]] - y[P[0]], x[P[1]] - x[P[0]]);
        }
      }
      this.speedSum = speed; this.activeCount = cnt;
      for (const b of exited) this.removeBody(b);
      return exited;
    }

    removeBody(b) {
      b.poured = true;
      let vx = 0, vy = 0;
      for (let k = 0; k < b.parts.length; k++) {
        const i = b.parts[k];
        this.active[i] = 0;
        b.px[k] = this.x[i]; b.py[k] = this.y[i];
        vx += this.vx[i]; vy += this.vy[i];
      }
      b.vx = vx / b.parts.length; b.vy = vy / b.parts.length;
    }

    // 輕拍：所有內容物往重力反方向跳一下並稍微散開（鬆動卡住的堆積）
    jolt(gdx, gdy, strength, rng) {
      const { vx, vy, active } = this;
      const base = 260 * strength;
      for (let i = 0; i < this.n; i++) {
        if (!active[i]) continue;
        const up = base * (0.45 + 0.55 * rng());
        const side = base * (rng() - 0.5) * 0.7;
        vx[i] += -gdx * up - gdy * side;
        vy[i] += -gdy * up + gdx * side;
      }
    }
  }

  // 在指定格子中以六角格點擺放物件（由下往上填，開場就像已經沉澱好）
  World.spawnPoints = function (maze, cells, radius, rng) {
    const S = maze.S, rw = maze.rw;
    const sp = radius * 2 * 1.06;
    const rowH = sp * 0.866;
    const set = new Set(cells);
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const c of cells) {
      const [cx, cy] = maze.cellCenter(c);
      minX = Math.min(minX, cx - S / 2); maxX = Math.max(maxX, cx + S / 2);
      minY = Math.min(minY, cy - S / 2); maxY = Math.max(maxY, cy + S / 2);
    }
    const pts = [];
    const clear = rw + radius + 0.6;
    for (let row = 0, py = minY + radius + rw; py < maxY; row++, py += rowH) {
      for (let px = minX + radius + rw + (row % 2 ? sp / 2 : 0); px < maxX; px += sp) {
        const c = maze.cellAt(px, py);
        if (c < 0 || !set.has(c)) continue;
        const list = maze.wallIdx[c];
        let ok = true;
        if (list) {
          for (const s of list) {
            const o = s * 4, ax = maze.segs[o], ay = maze.segs[o + 1];
            const abx = maze.segs[o + 2] - ax, aby = maze.segs[o + 3] - ay;
            let t = ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby);
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            if (Math.hypot(px - ax - abx * t, py - ay - aby * t) < clear) { ok = false; break; }
          }
        }
        if (ok) pts.push([px, py, rng() * 0.6]);
      }
    }
    pts.sort((a, b) => b[1] + b[2] * sp - (a[1] + a[2] * sp));
    return pts;
  };

  PM.World = World;
})();
