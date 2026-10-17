/* 迷宮生成：在任意外殼形狀的格子遮罩上生成；底部是放內容物的「肚子」(房間)，
   上方是迷宮，經由瓶頸通到瓶口（遊戲中罐子倒立，瓶口朝下）。每次隨機、保證無死路。 */
(function () {
  'use strict';
  const PM = window.PM, U = PM.U;

  // 方向：0 上 1 右 2 下 3 左
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0], BIT = [1, 2, 4, 8], OPP = [2, 3, 0, 1];
  const SOLID = 0, MAZE = 1, ROOM = 2, NECK = 3;
  const popcount = (v) => (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1);

  function cellInside(shape, x, y, w) {
    for (let a = 0; a <= 3; a++) {
      for (let b = 0; b <= 3; b++) {
        if (!shape.inside(x + (w * a) / 3, y + (w * b) / 3)) return false;
      }
    }
    return true;
  }

  // 固定（不隨機）的部分：格線、遮罩、瓶頸、房間
  function layout(shape, cfg) {
    const S = shape.w / cfg.cols;
    const rw = S * (cfg.wallK || 0.085);   // 大顆內容物用較細的牆，走廊才放得下兩顆並排
    const b = shape.bbox;
    const k = Math.ceil((shape.mouthX - (b.x0 - S)) / S - 0.5);
    const x0 = shape.mouthX - (k + 0.5) * S;
    const C = Math.ceil((b.x1 + S - x0) / S);
    const y0 = b.y0 - S * 2;
    const R = Math.ceil((b.y1 + S - y0) / S);
    const N = C * R;
    // 格子允許貼近外框：外殼描邊（SHELL_T）的內半部會蓋住，內容物不會看起來跑出殼外
    const margin = Math.max(1.5, PM.SHELL_T / 2 - rw + 1);

    const inc = new Uint8Array(N);
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < C; i++) {
        inc[j * C + i] = cellInside(shape, x0 + i * S - margin, y0 + j * S - margin, S + 2 * margin) ? 1 : 0;
      }
    }
    keepLargest(inc, C, R);

    // 瓶口欄位最上方的格子 = 瓶頸底
    let mc = k, jTop = -1;
    const topOf = (col) => { for (let j = 0; j < R; j++) if (inc[j * C + col]) return j; return -1; };
    jTop = topOf(mc);
    for (let off = 1; jTop < 0 && off < C; off++) {
      for (const c of [k - off, k + off]) {
        if (c >= 0 && c < C && topOf(c) >= 0) { mc = c; jTop = topOf(c); break; }
      }
    }

    // 罐子倒立時，比瓶口還「高」的格子（愛心兩瓣、貓耳旁、肩部角落）會變成最低點，
    // 內容物會積在那裡出不來；這些格子直接填實
    for (let i = 0; i < N; i++) if (inc[i] && ((i / C) | 0) < jTop) inc[i] = 0;
    keepLargest(inc, C, R);

    const type = new Uint8Array(N);
    const rowCount = new Array(R).fill(0);
    let total = 0;
    for (let i = 0; i < N; i++) if (inc[i]) { rowCount[(i / C) | 0]++; total++; }
    let acc = 0, jr = R;
    for (let j = R - 1; j > jTop + 1; j--) {
      acc += rowCount[j];
      jr = j;
      if (acc >= total * cfg.room) break;
    }
    for (let i = 0; i < N; i++) if (inc[i]) type[i] = ((i / C) | 0) >= jr ? ROOM : MAZE;

    // 瓶頸：往上延伸到格子中心超出外殼為止
    const neck = [];
    for (let j = jTop - 1; j >= 0; j--) {
      const idx = j * C + mc;
      type[idx] = NECK;
      neck.push(idx);
      if (!shape.inside(x0 + (mc + 0.5) * S, y0 + (j + 0.5) * S)) break;
    }
    const start = jTop * C + mc;

    // 只保留與瓶頸相連的迷宮區塊
    const mainMaze = flood(type, C, R, start, (t) => t === MAZE);
    for (let i = 0; i < N; i++) if (type[i] === MAZE && !mainMaze[i]) type[i] = SOLID;

    // 只保留與迷宮相鄰的最大房間區塊
    keepRoomTouchingMaze(type, C, R);

    return { shape, S, rw, x0, y0, C, R, N, mc, jTop, start, neck, neckTop: neck[neck.length - 1], baseType: type };
  }

  function flood(type, C, R, start, ok) {
    const seen = new Uint8Array(C * R);
    if (!ok(type[start])) return seen;
    const q = [start];
    seen[start] = 1;
    while (q.length) {
      const a = q.pop();
      const ai = a % C, aj = (a / C) | 0;
      for (let d = 0; d < 4; d++) {
        const ni = ai + DX[d], nj = aj + DY[d];
        if (ni < 0 || nj < 0 || ni >= C || nj >= R) continue;
        const nb = nj * C + ni;
        if (!seen[nb] && ok(type[nb])) { seen[nb] = 1; q.push(nb); }
      }
    }
    return seen;
  }

  function keepLargest(inc, C, R) {
    const N = C * R, comp = new Int32Array(N).fill(-1);
    let best = -1, bestSize = 0, id = 0;
    for (let s = 0; s < N; s++) {
      if (!inc[s] || comp[s] >= 0) continue;
      const seen = flood(inc, C, R, s, (t) => t === 1);
      let size = 0;
      for (let i = 0; i < N; i++) if (seen[i]) { comp[i] = id; size++; }
      if (size > bestSize) { bestSize = size; best = id; }
      id++;
    }
    for (let i = 0; i < N; i++) if (comp[i] !== best) inc[i] = 0;
  }

  function keepRoomTouchingMaze(type, C, R) {
    const N = C * R, done = new Uint8Array(N);
    let bestSeen = null, bestSize = 0;
    for (let s = 0; s < N; s++) {
      if (type[s] !== ROOM || done[s]) continue;
      const seen = flood(type, C, R, s, (t) => t === ROOM);
      let size = 0, touches = false;
      for (let i = 0; i < N; i++) {
        if (!seen[i]) continue;
        done[i] = 1; size++;
        const ii = i % C, jj = (i / C) | 0;
        for (let d = 0; d < 4; d++) {
          const ni = ii + DX[d], nj = jj + DY[d];
          if (ni >= 0 && nj >= 0 && ni < C && nj < R && type[nj * C + ni] === MAZE) touches = true;
        }
      }
      if (touches && size > bestSize) { bestSize = size; bestSeen = seen; }
    }
    for (let i = 0; i < N; i++) if (type[i] === ROOM && !(bestSeen && bestSeen[i])) type[i] = SOLID;
  }

  // 隨機部分：生成樹（偏好直走、偏好水平）→ 瓶頸 → 房間開口 → 消除死路
  function attempt(g, cfg, rng) {
    const { C, R, N, start } = g;
    const type = g.baseType.slice();
    const links = new Uint8Array(N);
    const nbr = (a, d) => {
      const ni = (a % C) + DX[d], nj = ((a / C) | 0) + DY[d];
      return ni < 0 || nj < 0 || ni >= C || nj >= R ? -1 : nj * C + ni;
    };
    const link = (a, d) => { links[a] |= BIT[d]; links[nbr(a, d)] |= BIT[OPP[d]]; };
    const unlink = (a, d) => { links[a] &= ~BIT[d]; links[nbr(a, d)] &= ~BIT[OPP[d]]; };

    // 1. 深度優先生成樹
    const visited = new Uint8Array(N), lastDir = new Int8Array(N).fill(-1), stack = [start];
    visited[start] = 1;
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const opts = [];
      for (let d = 0; d < 4; d++) {
        const nb = nbr(cur, d);
        if (nb >= 0 && type[nb] === MAZE && !visited[nb]) opts.push(d);
      }
      if (!opts.length) { stack.pop(); continue; }
      let d;
      const hz = opts.filter((o) => o === 1 || o === 3);
      if (lastDir[cur] >= 0 && opts.indexOf(lastDir[cur]) >= 0 && rng() < cfg.straight) d = lastDir[cur];
      else if (hz.length && rng() < cfg.hbias) d = hz[Math.floor(rng() * hz.length)];
      else d = opts[Math.floor(rng() * opts.length)];
      const nb = nbr(cur, d);
      link(cur, d);
      visited[nb] = 1;
      lastDir[nb] = d;
      stack.push(nb);
    }

    // 2. 瓶頸：垂直連通
    let prev = start;
    for (const idx of g.neck) { link(prev, 0); prev = idx; }

    // 3. 房間與迷宮的開口（彼此錯開）
    const cands = [];
    for (let a = 0; a < N; a++) {
      if (type[a] !== MAZE) continue;
      for (let d = 0; d < 4; d++) {
        const nb = nbr(a, d);
        if (nb >= 0 && type[nb] === ROOM) cands.push([a, d]);
      }
    }
    if (!cands.length) return null;
    U.shuffle(cands, rng);
    const chosen = [];
    for (const c of cands) {
      if (chosen.length >= cfg.open) break;
      if (chosen.every((o) => Math.abs((o[0] % C) - (c[0] % C)) >= 2)) chosen.push(c);
    }
    for (const c of chosen) link(c[0], c[1]);

    // 4. 消除死路：打通到鄰格（偏好直線延伸、偏好另一個死路），不行就填實
    const cells = [];
    for (let a = 0; a < N; a++) if (type[a] === MAZE) cells.push(a);
    let changed = true, guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      U.shuffle(cells, rng);
      for (const a of cells) {
        if (type[a] !== MAZE) continue;
        const dg = popcount(links[a]);
        if (dg >= 2) continue;
        if (dg === 0) { if (a !== start) { type[a] = SOLID; changed = true; } continue; }
        let d0 = 0;
        while (!(links[a] & BIT[d0])) d0++;
        const opts = [];
        let wsum = 0;
        for (let d = 0; d < 4; d++) {
          if (links[a] & BIT[d]) continue;
          const nb = nbr(a, d);
          if (nb < 0 || type[nb] !== MAZE) continue;
          const w = (d === OPP[d0] ? 3 : 1) * (popcount(links[nb]) === 1 ? 2 : 1);
          opts.push([d, w]);
          wsum += w;
        }
        if (!opts.length) {
          if (a === start) continue;
          unlink(a, d0);
          type[a] = SOLID;
          changed = true;
          continue;
        }
        let r = rng() * wsum, pickD = opts[0][0];
        for (const o of opts) { r -= o[1]; if (r <= 0) { pickD = o[0]; break; } }
        link(a, pickD);
        changed = true;
      }
    }

    const turns = minTurns(g, type, links);
    if (turns >= 1e9) return null;
    const group = new Int16Array(N).fill(-1);
    for (let a = 0; a < N; a++) if (type[a] === MAZE) group[a] = 0;
    const field = climbField(g, type, links);
    return { type, links, group, turns, field, pockets: countPockets(type, group, field) };
  }

  // 反向 0-1 BFS：每一格到出口最少要「逆重力爬升」幾段（一次算完全部格子）
  function climbField(g, type, links) {
    const { C, R, N } = g;
    const f = new Int32Array(N * 4).fill(1e9), buckets = [[]];
    const push = (st, c) => { if (c < f[st]) { f[st] = c; (buckets[c] || (buckets[c] = [])).push(st); } };
    for (let dp = 0; dp < 4; dp++) push(g.neckTop * 4 + dp, 0);
    for (let c = 0; c < buckets.length; c++) {
      const b = buckets[c];
      if (!b) continue;
      for (let q = 0; q < b.length; q++) {
        const st = b[q];
        if (f[st] !== c) continue;
        const cell = st >> 2, dIn = st & 3;
        const ai = (cell % C) - DX[dIn], aj = ((cell / C) | 0) - DY[dIn];
        if (ai < 0 || aj < 0 || ai >= C || aj >= R) continue;
        const a = aj * C + ai;
        if ((type[a] !== MAZE && type[a] !== NECK) || !(links[a] & BIT[dIn])) continue;
        for (let dp = 0; dp < 4; dp++) push(a * 4 + dp, c + (dIn === 2 && dp !== 2 ? 1 : 0));
      }
    }
    const out = new Int32Array(N);
    for (let a = 0; a < N; a++) out[a] = f[a * 4];
    return out;
  }

  // 口袋格：比同一層其他地方多需要爬升（東西掉進去會被困住的地方）
  function countPockets(type, group, field) {
    const base = {};
    for (let a = 0; a < type.length; a++) {
      if (type[a] !== MAZE || group[a] < 0 || field[a] >= 1e9) continue;
      base[group[a]] = Math.min(base[group[a]] === undefined ? 1e9 : base[group[a]], field[a]);
    }
    let n = 0;
    for (let a = 0; a < type.length; a++) if (type[a] === MAZE && group[a] >= 0 && field[a] > base[group[a]]) n++;
    return n;
  }

  // 0-1 BFS：從任一房間開口出發，到瓶頸頂端往上離開，最少轉幾次彎
  function minTurns(g, type, links) {
    const { C, R, N } = g;
    const dist = new Int32Array(N * 4).fill(1e9);
    const buckets = [[]];
    for (let a = 0; a < N; a++) {
      if (type[a] !== MAZE) continue;
      for (let d = 0; d < 4; d++) {
        if (!(links[a] & BIT[d])) continue;
        const ni = (a % C) + DX[d], nj = ((a / C) | 0) + DY[d];
        if (type[nj * C + ni] === ROOM) {
          const s = a * 4 + OPP[d];
          dist[s] = 0;
          buckets[0].push(s);
        }
      }
    }
    for (let c = 0; c < buckets.length; c++) {
      const b = buckets[c];
      if (!b) continue;
      for (let q = 0; q < b.length; q++) {
        const s = b[q];
        if (dist[s] !== c) continue;
        const a = s >> 2, d = s & 3;
        if (a === g.neckTop && d === 0) return c;
        for (let d2 = 0; d2 < 4; d2++) {
          if (!(links[a] & BIT[d2]) || d2 === OPP[d]) continue;
          const ni = (a % C) + DX[d2], nj = ((a / C) | 0) + DY[d2];
          if (ni < 0 || nj < 0 || ni >= C || nj >= R) continue;
          const nb = nj * C + ni;
          if (type[nb] !== MAZE && type[nb] !== NECK) continue;
          const nc = c + (d2 === d ? 0 : 1);
          const ns = nb * 4 + d2;
          if (nc < dist[ns]) {
            dist[ns] = nc;
            (buckets[nc] || (buckets[nc] = [])).push(ns);
          }
        }
      }
    }
    return 1e9;
  }

  // 轉成牆段（合併共線的格邊）與每格的牆索引
  function finalize(g, a) {
    const { C, R, S, x0, y0, rw } = g;
    const { type, links } = a;
    const open = (idx, d) => {
      if (idx === g.neckTop && d === 0) return true;
      const ni = (idx % C) + DX[d], nj = ((idx / C) | 0) + DY[d];
      if (ni < 0 || nj < 0 || ni >= C || nj >= R) return false;
      const nb = nj * C + ni, tn = type[nb];
      if (tn === SOLID) return false;
      if (type[idx] === ROOM && tn === ROOM) return true;
      return (links[idx] & BIT[d]) !== 0;
    };
    const hw = new Uint8Array((R + 1) * C), vw = new Uint8Array(R * (C + 1));
    const roomCells = [], mazeCells = [], neckCells = [];
    for (let idx = 0; idx < C * R; idx++) {
      const t = type[idx];
      if (t === SOLID) continue;
      if (t === ROOM) roomCells.push(idx);
      else if (t === MAZE) mazeCells.push(idx);
      else neckCells.push(idx);
      const i = idx % C, j = (idx / C) | 0;
      if (!open(idx, 0)) hw[j * C + i] = 1;
      if (!open(idx, 2)) hw[(j + 1) * C + i] = 1;
      if (!open(idx, 3)) vw[j * (C + 1) + i] = 1;
      if (!open(idx, 1)) vw[j * (C + 1) + i + 1] = 1;
    }
    const segs = [];
    for (let j = 0; j <= R; j++) {
      let run = -1;
      for (let i = 0; i <= C; i++) {
        const on = i < C && hw[j * C + i];
        if (on && run < 0) run = i;
        if (!on && run >= 0) { segs.push(x0 + run * S, y0 + j * S, x0 + i * S, y0 + j * S); run = -1; }
      }
    }
    for (let i = 0; i <= C; i++) {
      let run = -1;
      for (let j = 0; j <= R; j++) {
        const on = j < R && vw[j * (C + 1) + i];
        if (on && run < 0) run = j;
        if (!on && run >= 0) { segs.push(x0 + i * S, y0 + run * S, x0 + i * S, y0 + j * S); run = -1; }
      }
    }
    const nSeg = segs.length / 4;
    const wallIdx = new Array(C * R).fill(null);
    const pad = rw + S * 0.45;
    for (let s = 0; s < nSeg; s++) {
      const ax = Math.min(segs[s * 4], segs[s * 4 + 2]) - pad, bx = Math.max(segs[s * 4], segs[s * 4 + 2]) + pad;
      const ay = Math.min(segs[s * 4 + 1], segs[s * 4 + 3]) - pad, by = Math.max(segs[s * 4 + 1], segs[s * 4 + 3]) + pad;
      const i0 = Math.max(0, Math.floor((ax - x0) / S)), i1 = Math.min(C - 1, Math.floor((bx - x0) / S));
      const j0 = Math.max(0, Math.floor((ay - y0) / S)), j1 = Math.min(R - 1, Math.floor((by - y0) / S));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = j * C + i;
          if (!wallIdx[c]) wallIdx[c] = [];
          wallIdx[c].push(s);
        }
      }
    }
    // 開場倒數用的閘門：橫跨瓶口（倒數結束才打開）
    const gy = y0 + ((g.neckTop / C) | 0) * S + S * 0.35;
    const gates = [x0 + g.mc * S, gy, x0 + (g.mc + 1) * S, gy];
    // 加分物的「難拿」位置：比同一層多需要逆重力爬升的口袋優先，其次離出口遠
    const steps = new Int32Array(C * R).fill(1e9);
    steps[g.neckTop] = 0;
    const q = [g.neckTop];
    for (let k = 0; k < q.length; k++) {
      const c = q[k];
      for (let d = 0; d < 4; d++) {
        if (!open(c, d) || (c === g.neckTop && d === 0)) continue;
        const nb = c + DX[d] + DY[d] * C;
        if (type[nb] === ROOM || steps[nb] <= steps[c] + 1) continue;
        steps[nb] = steps[c] + 1;
        q.push(nb);
      }
    }
    const cl = new Map(), baseCl = {};
    for (const c of mazeCells) {
      const grp = a.group ? a.group[c] : 0;
      if (grp < 0) continue;
      const v = a.field[c];
      cl.set(c, v);
      baseCl[grp] = Math.min(baseCl[grp] === undefined ? 1e9 : baseCl[grp], v);
    }
    const hardCells = [...cl.keys()]
      .map((c) => [c, (cl.get(c) - baseCl[a.group ? a.group[c] : 0]) * 100 + Math.min(steps[c], 99)])
      .sort((p, q2) => q2[1] - p[1])
      .map((h) => h[0]);

    const neckTopRow = (g.neckTop / C) | 0;
    return {
      gates: new Float32Array(gates), hardCells,
      shape: g.shape, S, rw, x0, y0, C, R, type, links,
      segs: new Float32Array(segs), nSeg, wallIdx,
      neckCol: g.mc, neckTop: g.neckTop, start: g.start,
      neckX0: x0 + g.mc * S, neckX1: x0 + (g.mc + 1) * S,
      neckBaseY: y0 + g.jTop * S,
      exitX: x0 + (g.mc + 0.5) * S, exitY: y0 + neckTopRow * S,
      roomCells, mazeCells, neckCells, turns: a.turns, pockets: a.pockets,
      cellAt(x, y) {
        const i = Math.floor((x - x0) / S), j = Math.floor((y - y0) / S);
        return i < 0 || j < 0 || i >= C || j >= R ? -1 : j * C + i;
      },
      typeAt(x, y) {
        const c = this.cellAt(x, y);
        return c < 0 ? SOLID : type[c];
      },
      cellCenter(c) { return [x0 + ((c % C) + 0.5) * S, y0 + (((c / C) | 0) + 0.5) * S]; },
    };
  }

  // 追加牆段並更新索引（用於瓶口縮口）
  function addSegments(m, list) {
    const pad = m.rw + m.S * 0.45;
    const segs = new Float32Array(m.segs.length + list.length * 4);
    segs.set(m.segs);
    list.forEach((s, k) => {
      const id = m.nSeg + k;
      segs.set(s, id * 4);
      const i0 = Math.max(0, Math.floor((Math.min(s[0], s[2]) - pad - m.x0) / m.S)), i1 = Math.min(m.C - 1, Math.floor((Math.max(s[0], s[2]) + pad - m.x0) / m.S));
      const j0 = Math.max(0, Math.floor((Math.min(s[1], s[3]) - pad - m.y0) / m.S)), j1 = Math.min(m.R - 1, Math.floor((Math.max(s[1], s[3]) + pad - m.y0) / m.S));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = j * m.C + i;
          if (!m.wallIdx[c]) m.wallIdx[c] = [];
          m.wallIdx[c].push(id);
        }
      }
    });
    m.segs = segs;
    m.nSeg += list.length;
  }

  // 瓶口縮口：讓倒出的速度受限，更有「倒」的手感；gap 為實際可通過的寬度
  PM.addNozzle = function (m, gap) {
    const half = gap / 2 + m.rw;
    if (m.exitX - half - m.neckX0 < m.rw * 1.2) return;
    const y = m.exitY + m.S * 0.3;
    addSegments(m, [[m.neckX0, y, m.exitX - half, y], [m.exitX + half, y, m.neckX1, y]]);
    m.nozzle = gap;
  };

  PM.CELL = { SOLID, MAZE, ROOM, NECK };

  PM.buildMaze = function (shape, cfg, rng) {
    const c = Object.assign({ straight: 0.55, hbias: 0.45, open: 2, room: 0.4, turns: [1, 99], pockets: [0, 99] }, cfg);
    const g = layout(shape, c);
    let best = null, bestScore = 1e9;
    for (let n = 0; n < 40; n++) {
      const a = attempt(g, c, rng);
      if (!a) continue;
      const pk = c.pockets;
      const score = (a.pockets < pk[0] ? pk[0] - a.pockets : a.pockets > pk[1] ? a.pockets - pk[1] : 0) +
        (a.turns < c.turns[0] ? c.turns[0] - a.turns : a.turns > c.turns[1] ? (a.turns - c.turns[1]) * 1.5 : 0);
      if (score < bestScore) { best = a; bestScore = score; }
      if (score === 0) break;
    }
    if (!best) throw new Error('maze generation failed: ' + shape.id);
    return finalize(g, best);
  };
})();
