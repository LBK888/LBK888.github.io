/* 迷宮生成：在任意外殼形狀的格子遮罩上生成；底部是放內容物的「肚子」(房間)，
   上方是迷宮，經由瓶頸通到瓶口。保證無死路，並限制從房間到瓶口的最少轉彎數。 */
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

  // 隨機部分：分層迷宮，層與層之間只靠一個「回水彎」陷阱相連。
  // 罐子座標：瓶口在上（j 小）、房間在下（j 大）。遊戲中罐子倒過來畫（瓶口朝下），
  // 手機正拿時重力 = 罐子座標往上。陷阱是一個杯子：東西掉進杯底後，必須「逆重力」
  // 往 j+1 爬一格才能越過杯緣，也就是手機要往杯口那側倒超過水平，再轉回來。
  function attempt(g, cfg, rng) {
    const { C, R, N, start } = g;
    const type = g.baseType.slice();
    const links = new Uint8Array(N);
    const at = (i, j) => (i < 0 || j < 0 || i >= C || j >= R ? -1 : j * C + i);
    const nbr = (a, d) => at((a % C) + DX[d], ((a / C) | 0) + DY[d]);
    const link = (a, d) => { links[a] |= BIT[d]; links[nbr(a, d)] |= BIT[OPP[d]]; };
    const unlink = (a, d) => { links[a] &= ~BIT[d]; links[nbr(a, d)] &= ~BIT[OPP[d]]; };
    const isMaze = (i, j) => { const a = at(i, j); return a >= 0 && type[a] === MAZE; };

    // 1. 把迷宮列分成 K+1 層，層與層之間各留兩列給陷阱
    let jMax = -1, jAll = R;
    for (let a = 0; a < N; a++) if (type[a] === MAZE) { jMax = Math.max(jMax, (a / C) | 0); jAll = Math.min(jAll, (a / C) | 0); }
    const jMin = g.jTop, H = jMax - jMin + 1;
    const K = Math.max(0, Math.min(cfg.traps || 0, Math.floor((H - 1) / 3)));
    const sizes = new Array(K + 1).fill(1);
    for (let r = 2 * K + K + 1; r < H; r++) sizes[Math.floor(rng() * (K + 1))]++;
    const group = new Int16Array(N).fill(-1);
    const bandOfRow = new Int16Array(R).fill(-1);
    const traps = [];
    let row = jMin;
    for (let b = 0; b <= K; b++) {
      for (let k = 0; k < sizes[b]; k++, row++) bandOfRow[row] = b;
      if (b < K) { traps.push({ tB: row, tA: row + 1 }); row += 2; }
    }
    for (let j = jAll; j < jMin; j++) bandOfRow[j] = 0;   // 瓶頸兩側比瓶頸底還高的格子（例如貓耳旁）併入最下層
    for (let a = 0; a < N; a++) if (type[a] === MAZE && bandOfRow[(a / C) | 0] >= 0) group[a] = bandOfRow[(a / C) | 0];

    // 2. 陷阱：入口 c1（從上一層掉下）→ 杯底 tB 列走到 c2 → 爬一格到 tA → 走到 c3 → 往下一層
    for (let t = 0; t < K; t++) {
      const { tA, tB } = traps[t];
      const cands = [];
      for (let c1 = 0; c1 < C; c1++) {
        for (let c3 = 0; c3 < C; c3++) {
          const dir = Math.sign(c3 - c1);
          if (Math.abs(c3 - c1) < 2) continue;
          if (!isMaze(c1, tA + 1) || group[at(c1, tA + 1)] !== t + 1) continue;
          if (!isMaze(c3, tB - 1) || group[at(c3, tB - 1)] !== t) continue;
          if (!isMaze(c1, tA) || !isMaze(c3, tB)) continue;
          for (let c2 = c1 + dir; c2 !== c3; c2 += dir) {
            let ok = true;
            for (let i = c1; ok && i !== c2 + dir; i += dir) ok = isMaze(i, tB);
            for (let i = c2; ok && i !== c3 + dir; i += dir) ok = isMaze(i, tA);
            // 杯底 2~4 格、上緣 1~3 格：每個陷阱是一次俐落的「倒過去再轉回來」
            if (ok) cands.push([c1, c2, c3, -Math.pow(Math.abs(c2 - c1) - 3, 2) - Math.pow(Math.abs(c3 - c2) - 2, 2) + rng() * 2]);
          }
        }
      }
      if (!cands.length) return null;
      cands.sort((p, q) => q[3] - p[3]);
      traps[t].c = cands[Math.floor(rng() * Math.min(cands.length, 5))];
    }
    for (let t = 0; t < traps.length; t++) {
      const tr = traps[t];
      const [c1, c2, c3] = tr.c, dir = Math.sign(c3 - c1), hd = dir > 0 ? 1 : 3;
      const keep = new Set([at(c1, tr.tA), at(c3, tr.tB)]);
      for (let i = c1; i !== c2 + dir; i += dir) keep.add(at(i, tr.tB));
      for (let i = c2; i !== c3 + dir; i += dir) keep.add(at(i, tr.tA));
      for (let i = 0; i < C; i++) {
        for (const jj of [tr.tA, tr.tB]) {
          const a = at(i, jj);
          if (type[a] !== MAZE) continue;
          // 陷阱以外的格子併入上下兩層，保留給隨機迷宮（不再整列填實）
          if (keep.has(a)) group[a] = -2; else group[a] = jj === tr.tA ? t + 1 : t;
        }
      }
      link(at(c1, tr.tA), 2);
      link(at(c1, tr.tA), 0);
      for (let i = c1; i !== c2; i += dir) link(at(i, tr.tB), hd);
      link(at(c2, tr.tB), 2);
      for (let i = c2; i !== c3; i += dir) link(at(i, tr.tA), hd);
      link(at(c3, tr.tA), 0);
      link(at(c3, tr.tB), 0);
      tr.entry = at(c1, tr.tA + 1);
      tr.exit = at(c3, tr.tB - 1);
    }

    // 3. 每一層只保留含出入口的連通區塊，再各自生成偏好直走的生成樹
    for (let b = 0; b <= K; b++) {
      const out = b === 0 ? start : traps[b - 1].entry;
      if (group[out] !== b) return null;
      const comp = flood(group, C, R, out, (v) => v === b);
      if (b < K && !comp[traps[b].exit]) return null;
      for (let a = 0; a < N; a++) if (group[a] === b && !comp[a]) { type[a] = SOLID; group[a] = -1; }
      const visited = new Uint8Array(N), lastDir = new Int8Array(N).fill(-1), stack = [out];
      visited[out] = 1;
      while (stack.length) {
        const cur = stack[stack.length - 1];
        const opts = [];
        for (let d = 0; d < 4; d++) {
          const nb = nbr(cur, d);
          if (nb >= 0 && group[nb] === b && !visited[nb]) opts.push(d);
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
    }

    // 4. 瓶頸
    let prev = start;
    for (const idx of g.neck) { link(prev, 0); prev = idx; }

    // 5. 房間 → 最上層（靠房間那層）的開口，彼此錯開
    const cands = [];
    for (let a = 0; a < N; a++) {
      if (group[a] !== K) continue;
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

    // 6. 消除死路（只在同一層內打通；打不通就填實）
    const cells = [];
    for (let a = 0; a < N; a++) if (group[a] >= 0) cells.push(a);
    let changed = true, guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      U.shuffle(cells, rng);
      for (const a of cells) {
        if (type[a] !== MAZE || group[a] < 0) continue;
        const dg = popcount(links[a]);
        if (dg >= 2) continue;
        if (dg === 0) { if (a !== start) { type[a] = SOLID; group[a] = -1; changed = true; } continue; }
        let d0 = 0;
        while (!(links[a] & BIT[d0])) d0++;
        const opts = [];
        let wsum = 0;
        for (let d = 0; d < 4; d++) {
          if (links[a] & BIT[d]) continue;
          const nb = nbr(a, d);
          if (nb < 0 || group[nb] !== group[a]) continue;
          const w = (d === OPP[d0] ? 3 : 1) * (popcount(links[nb]) === 1 ? 2 : 1);
          opts.push([d, w]);
          wsum += w;
        }
        if (!opts.length) {
          if (a === start) continue;
          unlink(a, d0);
          type[a] = SOLID;
          group[a] = -1;
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
    const field = climbField(g, type, links);
    return { type, links, group, turns, traps: K, climbs: climbsFrom(g, type, links, -1), field, pockets: countPockets(type, group, field) };
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

  // 0-1 BFS：從房間開口（from = -1）或指定格子出發，到出口最少要「逆重力爬升」幾段
  function climbsFrom(g, type, links, from) {
    const { C, R, N } = g;
    const dist = new Int32Array(N * 4 + 4).fill(1e9), buckets = [[]];
    const push = (s, c) => { if (c < dist[s]) { dist[s] = c; (buckets[c] || (buckets[c] = [])).push(s); } };
    if (from >= 0) {
      for (let d = 0; d < 4; d++) {
        if (!(links[from] & BIT[d])) continue;
        const nb = from + DX[d] + DY[d] * C;
        if (type[nb] === MAZE || type[nb] === NECK) push(nb * 4 + d, d === 2 ? 1 : 0);
      }
      if (from === g.neckTop) return 0;
    } else {
      for (let a = 0; a < N; a++) {
        if (type[a] !== MAZE) continue;
        for (let d = 0; d < 4; d++) {
          if (!(links[a] & BIT[d])) continue;
          if (type[a + DX[d] + DY[d] * C] === ROOM) push(a * 4 + OPP[d], 0);
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
          push(nb * 4 + d2, c + (d2 === 2 && d !== 2 ? 1 : 0));
        }
      }
    }
    return 1e9;
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
    // 閘門：房間通往迷宮的開口（開場倒數時關著，內容物先在房間裡站穩）
    const gates = [];
    for (const r of roomCells) {
      const i = r % C, j = (r / C) | 0;
      for (let d = 0; d < 4; d++) {
        const ni = i + DX[d], nj = j + DY[d];
        if (ni < 0 || nj < 0 || ni >= C || nj >= R) continue;
        if (type[nj * C + ni] !== MAZE || !(links[r] & BIT[d])) continue;
        const xa = x0 + i * S, ya = y0 + j * S;
        if (d === 0) gates.push(xa, ya, xa + S, ya);
        else if (d === 2) gates.push(xa, ya + S, xa + S, ya + S);
        else if (d === 1) gates.push(xa + S, ya, xa + S, ya + S);
        else gates.push(xa, ya, xa, ya + S);
      }
    }
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
      gates: new Float32Array(gates), hardCells, traps: a.traps || 0, climbs: a.climbs || 0,
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
    const c = Object.assign({ straight: 0.55, hbias: 0.5, open: 2, room: 0.4, turns: [1, 99], traps: 0 }, cfg);
    const g = layout(shape, c);
    // 陷阱放不下（形狀太窄或太矮）就逐步減少陷阱數
    let best = null, bestScore = 1e9;
    for (let k = c.traps; k >= 0 && !best; k--) {
      const ck = Object.assign({}, c, { traps: k });
      for (let n = 0; n < 40; n++) {
        const a = attempt(g, ck, rng);
        if (!a || a.traps < k) continue;
        const pk = c.pockets || [0, 99];
        const score = (a.pockets < pk[0] ? pk[0] - a.pockets : a.pockets > pk[1] ? a.pockets - pk[1] : 0) +
          (a.turns < c.turns[0] ? c.turns[0] - a.turns : a.turns > c.turns[1] ? (a.turns - c.turns[1]) * 1.5 : 0);
        if (score < bestScore) { best = a; bestScore = score; }
        if (score === 0) break;
      }
    }
    if (!best) throw new Error('maze generation failed: ' + shape.id);
    return finalize(g, best);
  };
})();
