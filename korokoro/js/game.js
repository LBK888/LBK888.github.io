/* 遊戲流程：標題 → 關卡介紹/倒數 → 遊玩 → 結算 → 下一關。
   計分、連擊、加分物、重新整理卷、暫停、畫面方向鎖定。 */
(function () {
  'use strict';
  const PM = window.PM, U = PM.U;
  const G = 1800;               // 滿重力（設計單位/秒²）
  const $ = (id) => document.getElementById(id);

  function screenAngle() {
    let a = 0;
    if (screen.orientation && typeof screen.orientation.angle === 'number') a = screen.orientation.angle;
    else if (typeof window.orientation === 'number') a = window.orientation;
    return ((a % 360) + 360) % 360;
  }

  function vibrate(p) {
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* 忽略 */ }
  }

  class Game {
    constructor() {
      this.app = $('app');
      this.canvas = $('game');
      this.renderer = new PM.Renderer(this.canvas);
      this.sound = new PM.Sound();
      this.input = new PM.Input();
      this.input.onKnock = (s) => this.knock(s);
      this.input.attach(this.canvas, () => {
        const r = this.canvas.getBoundingClientRect();
        return { x: r.left + this.renderer.cx, y: r.top + this.renderer.cy };
      });
      this.touchDevice = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
      this.state = 'title';
      this.paused = false;
      this.best = U.store.get('best', 0);
      this.score = 0; this.tickets = 1; this.levelIndex = 0;
      this.world = null; this.total = 0; this.poured = 0; this.need = 1; this.target = 1;
      this.cleared = false; this.combo = 0; this.lastPourT = -9; this.clock = 0; this.lastKnockT = 0;
      this.showPlate = false;
      this.hudCache = {};
      this.bindUI();
      this.onResize();
      window.addEventListener('resize', () => this.onResize());
      window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 150));
      if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', () => setTimeout(() => this.onResize(), 150));
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.isPlaying()) this.pause(true); });
      this.startDemo();
      this.lastT = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }

    // 傾斜模式下若瀏覽器自動轉成橫向，就把整個畫面反向轉回，讓罐子固定在手機上
    onResize() {
      const a = this.input.mode === 'tilt' && this.state !== 'title' ? screenAngle() : 0;
      const vw = window.innerWidth, vh = window.innerHeight, app = this.app;
      if (a) {
        const w = a === 90 || a === 270 ? vh : vw, h = a === 90 || a === 270 ? vw : vh;
        Object.assign(app.style, { width: w + 'px', height: h + 'px', left: (vw - w) / 2 + 'px', top: (vh - h) / 2 + 'px', transform: 'rotate(' + -a + 'deg)' });
        app.classList.add('locked');
      } else if (app.classList.contains('locked')) {
        app.removeAttribute('style');
        app.classList.remove('locked');
      }
      const probe = $('safeProbe'), cs = getComputedStyle(probe);
      this.renderer.safe.top = a ? 0 : parseFloat(cs.paddingTop) || 0;
      this.renderer.safe.bottom = a ? 0 : parseFloat(cs.paddingBottom) || 0;
      this.renderer.resize(app.clientWidth, app.clientHeight);
    }

    bindUI() {
      const click = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); fn(e); });
      click('btnStart', () => this.onStart());
      click('btnHow', () => { this.sound.init(); this.sound.click(); this.showModal('howModal'); });
      click('btnHowClose', () => { this.sound.click(); this.hideModal('howModal'); });
      click('btnPause', () => { this.sound.click(); this.pause(!this.paused); });
      click('btnResume', () => { this.sound.click(); this.pause(false); });
      click('btnRestart', () => { this.sound.click(); this.hideModal('pauseModal'); this.paused = false; this.retryLevel(); });
      click('btnQuit', () => { this.sound.click(); this.hideModal('pauseModal'); this.paused = false; this.toTitle(); });
      click('btnTicket', () => this.useTicket());
      click('btnFinish', () => { this.sound.click(); this.finishLevel(); });
      click('btnShake', () => this.input.shake());
      click('btnNext', () => { this.sound.click(); this.hideModal('resultModal'); this.levelIndex++; this.startLevel(); });
      click('btnRetry', () => { this.sound.click(); this.hideModal('overModal'); this.retryLevel(); });
      click('btnTitle', () => { this.sound.click(); this.hideModal('overModal'); this.toTitle(); });
      click('pMode', () => this.toggleMode());
      for (const id of ['tBgm', 'pBgm']) click(id, () => { this.sound.init(); this.sound.setBgm(!this.sound.bgmOn); this.syncToggles(); });
      for (const id of ['tSfx', 'pSfx']) click(id, () => { this.sound.init(); this.sound.setSfx(!this.sound.sfxOn); this.sound.click(); this.syncToggles(); });
      $('levelCard').addEventListener('click', () => { if (this.state === 'intro' && this.introT < 2.1) this.introT = 2.1; });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { if (this.isPlaying()) this.pause(!this.paused); }
        else if ((e.key === 't' || e.key === 'T') && this.state === 'play') this.useTicket();
        else if (e.key === 'Enter' && this.state === 'play' && this.cleared) this.finishLevel();
      });
      this.syncToggles();
      $('bestScore').textContent = this.best;
    }

    syncToggles() {
      for (const id of ['tBgm', 'pBgm']) $(id).classList.toggle('on', this.sound.bgmOn);
      for (const id of ['tSfx', 'pSfx']) $(id).classList.toggle('on', this.sound.sfxOn);
      $('pMode').textContent = '操作方式：' + (this.input.mode === 'tilt' ? '傾斜手機' : '拖曳旋轉');
    }

    showModal(id) { $(id).classList.remove('hidden'); }
    hideModal(id) { $(id).classList.add('hidden'); }

    toast(text, ms) {
      const t = $('toast');
      t.textContent = text;
      t.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
    }

    // ---------- 開始與操作模式 ----------
    onStart() {
      this.sound.init();
      this.sound.click();
      const pref = U.store.get('control', 'auto');
      if (this.touchDevice && pref !== 'touch') {
        const btn = $('btnStart');
        btn.disabled = true;
        btn.textContent = '感應器啟動中…';
        const ask = this.input.requestSensors();   // iOS 權限必須在點擊當下呼叫
        this.tryFullscreen();
        ask.then((ok) => {
          btn.disabled = false;
          btn.textContent = '開始遊戲';
          this.setMode(ok ? 'tilt' : 'touch');
          if (!ok) this.toast('偵測不到傾斜感測器，改用拖曳旋轉（需要 HTTPS 網址）', 4200);
          this.startRun();
        });
      } else {
        this.setMode('touch');
        this.startRun();
      }
    }

    tryFullscreen() {
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req || document.fullscreenElement) return;
      try {
        const p = req.call(el);
        if (p && p.then) {
          p.then(() => {
            if (screen.orientation && screen.orientation.lock) screen.orientation.lock('portrait').catch(() => {});
          }).catch(() => {});
        }
      } catch (e) { /* 不支援全螢幕 */ }
    }

    setMode(mode) {
      this.input.mode = mode;
      this.renderer.setMode(this.state === 'title' ? 'touch' : mode);
      $('btnShake').classList.toggle('hidden', !(mode === 'touch' && this.touchDevice && this.isPlaying()));
      this.syncToggles();
      this.onResize();
    }

    toggleMode() {
      this.sound.click();
      if (this.input.mode === 'tilt') {
        U.store.set('control', 'touch');
        this.setMode('touch');
        return;
      }
      if (!this.touchDevice) { this.toast('電腦上請用拖曳或方向鍵旋轉'); return; }
      U.store.set('control', 'auto');
      if (this.input.sensorsAlive) { this.setMode('tilt'); return; }
      this.input.requestSensors().then((ok) => {
        if (ok) this.setMode('tilt');
        else this.toast('偵測不到傾斜感測器（需要 HTTPS 網址）');
      });
    }

    // ---------- 關卡 ----------
    startDemo() {
      this.state = 'title';
      this.showPlate = false;
      this.demoT = 0;
      this.input.enabled = false;
      this.renderer.setMode('touch');
      this.setupLevel(PM.DEMO_LEVEL, U.makeRng(U.randSeed()));
      $('hud').classList.add('hidden');
      $('title').classList.remove('hidden');
      $('bestScore').textContent = this.best;
      if (this.sound.ctx) this.sound.playBgm('title');
    }

    toTitle() {
      this.hideAllFloating();
      this.startDemo();
      this.onResize();
    }

    hideAllFloating() {
      for (const id of ['btnFinish', 'btnShake', 'levelCard', 'countdown', 'stamp']) $(id).classList.add('hidden');
    }

    startRun() {
      this.score = 0;
      this.tickets = 1;
      this.levelIndex = 0;
      $('title').classList.add('hidden');
      this.startLevel();
    }

    retryLevel() {
      this.score = this.levelStart.score;
      this.tickets = this.levelStart.tickets;
      this.startLevel();
    }

    startLevel() {
      const cfg = PM.getLevel(this.levelIndex);
      this.levelStart = { score: this.score, tickets: this.tickets };
      this.rng = U.makeRng(U.randSeed());
      this.state = 'intro';
      this.paused = false;
      this.input.reset();
      this.input.enabled = false;
      this.renderer.setMode(this.input.mode);
      this.setupLevel(cfg, this.rng);
      this.total = this.world.bodies.length;
      this.bonusTotal = this.world.bodies.filter((b) => b.bonus).length;
      this.need = Math.max(1, Math.ceil(cfg.target * this.total - 1e-6));
      this.target = this.need / this.total;
      this.poured = 0; this.bonusGot = 0; this.levelPoints = 0;
      this.timeLeft = cfg.time;
      this.cleared = false;
      this.combo = 0; this.lastPourT = -9;
      this.basePts = Math.max(5, Math.round(1200 / this.total / 5) * 5);
      this.showPlate = true;
      this.renderer.plate.pct = this.renderer.plate.shown = 0;
      this.renderer.cat.mood = 'idle';
      this.introT = 0; this.countShown = -1;
      this.hideAllFloating();
      this.showLevelCard(cfg);
      $('hud').classList.remove('hidden');
      $('btnShake').classList.toggle('hidden', !(this.input.mode === 'touch' && this.touchDevice));
      this.onResize();
      this.sound.playBgm(cfg.mat);
      this.updateHUD(true);
    }

    // 生成迷宮與物理世界；keep = 重新整理卷時保留的尚未倒出物件
    setupLevel(cfg, rng, keep) {
      const shape = PM.SHAPES[cfg.shape], mat = PM.MATERIALS[cfg.mat];
      const maze = PM.buildMaze(shape, cfg, rng);
      const S = maze.S;
      const spec = (def, bonus) => ({
        geom: def.geom, r: def.r * S, d: (def.d || 0) * S,
        e: def.phys.e, mu: def.phys.mu, drag: def.phys.drag, density: def.phys.density || 1,
        cohesive: bonus ? !!def.cohesive : !!mat.cohesion, bonus,
      });
      const base = spec(mat, false), bon = spec(mat.bonus, true);
      const brOf = (s) => (s.geom === 'single' ? s.r : s.geom === 'pill' ? s.d / 2 + s.r : s.geom === 'tri' ? s.d / Math.sqrt(3) + s.r : s.d * 0.71 + s.r);
      const brA = brOf(base), brB = brOf(bon);
      const ext = (s) => (s.geom === 'single' ? 2 * s.r * 1.25 : s.geom === 'pill' ? (s.d + 2 * s.r) * 1.1 : s.geom === 'tri' ? (s.d * 1.15 + 2 * s.r) * 1.15 : (s.d * 1.41 + 2 * s.r) * 1.15);
      if (mat.nozzle) PM.addNozzle(maze, U.clamp(Math.max(ext(base), ext(bon)), S * 0.4, S * 0.7));
      let roomPts = PM.World.spawnPoints(maze, maze.roomCells, brA, rng);
      const bonusRoomPts = PM.World.spawnPoints(maze, maze.roomCells, Math.max(brA, brB), rng);
      const mazePts = U.shuffle(
        PM.World.spawnPoints(maze, maze.mazeCells, Math.max(brA, brB), rng).filter((p) => Math.hypot(p[0] - maze.exitX, p[1] - maze.exitY) > S * 2.5),
        rng
      );
      let items = keep;
      if (!items) {
        const n = Math.max(6, Math.min(mat.max, Math.floor(roomPts.length * mat.fill)));
        items = [];
        for (let i = 0; i < n; i++) items.push({ bonus: false, color: Math.floor(rng() * 6), num: i + 1, where: 'room' });
        for (let k = 0; k < (cfg.bonus || 0); k++) {
          const it = { bonus: true, color: 0, num: 0, where: k === 0 ? 'room' : 'maze' };
          if (k === 0) items.splice(Math.floor(rng() * Math.min(items.length, roomPts.length * 0.8)), 0, it);
          else items.push(it);
        }
      }
      const world = new PM.World(maze, items.length * 4);
      world.G = G;
      world.cohesion = mat.cohesion || 0;
      world.cohRange = mat.cohRange || 0.5;
      world.visc = mat.visc || 0;
      // 房間裡的加分物先挑位置，再把與它重疊的一般格點移除
      const placed = new Map();
      let bi = 0;
      for (const it of items) {
        if (!it.bonus || it.where === 'maze' || !bonusRoomPts.length) continue;
        const p = bonusRoomPts[Math.min(bonusRoomPts.length - 1, Math.floor(bonusRoomPts.length * (0.15 + 0.5 * rng())) + bi++)];
        placed.set(it, p);
        roomPts = roomPts.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > (brA + brB) * 1.04);
      }
      let ri = 0, mi = 0;
      for (const it of items) {
        let p = placed.get(it) || null;
        if (p) { /* 已決定 */ }
        else if (it.bonus && it.where === 'maze' && mi < mazePts.length) p = mazePts[mi++];
        else if (ri < roomPts.length) p = roomPts[ri++];
        else if (mi < mazePts.length) p = mazePts[mi++];
        if (!p) continue;
        const b = world.addBody(it.bonus ? bon : base, p[0], p[1], rng() * U.TAU);
        b.color = it.color; b.num = it.num; b.item = it;
      }
      world.prepare();
      this.cfg = cfg; this.shape = shape; this.mat = mat; this.maze = maze; this.world = world;
      this.renderer.setLevel(shape, maze, mat);
    }

    showLevelCard(cfg) {
      const mat = PM.MATERIALS[cfg.mat], shape = PM.SHAPES[cfg.shape];
      $('lcStage').textContent = cfg.n;
      $('lcTitle').textContent = shape.name + ' × ' + mat.name;
      $('lcTarget').textContent = Math.round(this.target * 100) + '%';
      $('lcTime').textContent = cfg.time;
      $('lcBonus').textContent = mat.bonus.name;
      $('lcBonusN').textContent = this.bonusTotal;
      $('lcHint').textContent = this.input.mode === 'tilt'
        ? '轉動手機，從瓶口倒出來！卡住時搖一搖、輕拍手機'
        : (this.touchDevice ? '拖曳旋轉罐子・雙擊或按「搖一搖」鬆動卡住的東西' : '拖曳 / ← → 旋轉・空白鍵搖晃・↑ 輕拍');
      this.drawPreview($('lcPreview'), mat, false);
      this.drawPreview($('lcBonusPreview'), mat, true);
      $('levelCard').classList.remove('hidden');
    }

    drawPreview(cv, mat, bonus) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), size = 52;
      cv.width = size * dpr; cv.height = size * dpr;
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const def = bonus ? mat.bonus : mat, S = bonus ? 72 : (def.geom === 'single' ? 52 / (def.r * 5) : 80);
      const r = def.r * S, d = (def.d || 0) * S;
      let offs = [[0, 0]];
      if (def.geom === 'pill') offs = [[-d / 2, 0], [d / 2, 0]];
      else if (def.geom === 'tri') { const rho = d / Math.sqrt(3); offs = [0, 1, 2].map((k) => [Math.cos(k * 2.094 - 0.5) * rho, Math.sin(k * 2.094 - 0.5) * rho]); }
      else if (def.geom === 'quad') offs = [[-d / 2, -d / 2], [d / 2, -d / 2], [d / 2, d / 2], [-d / 2, d / 2]];
      const b = {
        id: 0, r, k: 1, ang: -0.5, color: 1, num: 7, bonus,
        px: new Float32Array(offs.map((o) => size / 2 + o[0] * Math.cos(-0.4) - o[1] * Math.sin(-0.4))),
        py: new Float32Array(offs.map((o) => size / 2 + o[0] * Math.sin(-0.4) + o[1] * Math.cos(-0.4))),
        cx: size / 2, cy: size / 2,
      };
      const v = { hx: -0.62, hy: -0.78, t: 0 };
      if (bonus) mat.bonus.draw(ctx, b, v);
      else if (mat.geom === 'single' && (mat.id === 'water' || mat.id === 'honey' || mat.id === 'salt')) {
        const list = [];
        for (const [ox, oy] of [[-8, 4], [7, 6], [0, -6], [-2, 13], [12, -4]]) {
          list.push({ id: list.length * 3, r: mat.r * 60, k: 1, ang: ox, color: list.length, px: [size / 2 + ox], py: [size / 2 + oy] });
        }
        mat.batch(ctx, list, v);
      } else mat.batch(ctx, [b], v);
    }

    // ---------- 每幀 ----------
    frame(t) {
      const dt = Math.min(0.05, Math.max(0.001, (t - this.lastT) / 1000));
      this.lastT = t;
      try {
        this.update(dt);
        this.renderer.update(dt, this);
        this.renderer.draw(this);
      } catch (err) {
        console.error(err);
      }
      requestAnimationFrame((tt) => this.frame(tt));
    }

    update(dt) {
      this.clock += dt;
      const inp = this.input;
      inp.update(dt);
      if (this.state === 'title') {
        this.demoT += dt;
        const a = Math.sin(this.demoT * 0.55) * 0.8;
        this.renderer.view = a;
        this.stepWorld(dt, Math.sin(a), Math.cos(a), 0, 0, null, false);
        return;
      }
      if (this.paused || !this.world) return;
      if (this.state === 'intro') {
        this.updateIntro(dt);
        this.renderer.view = 0;
        this.stepWorld(dt, 0, 1, 0, 0, null, false);
      } else if (this.state === 'play') {
        this.renderer.view = inp.mode === 'touch' ? inp.view : 0;
        const rot = inp.mode === 'touch' ? { w: inp.omega, alpha: inp.alpha, k: 0.45 } : null;
        this.stepWorld(dt, inp.gx, inp.gy, inp.sx, inp.sy, rot, true);
        if (this.state !== 'play') return;
        const prev = Math.ceil(this.timeLeft);
        this.timeLeft = Math.max(0, this.timeLeft - dt);
        const now = Math.ceil(this.timeLeft);
        if (now !== prev && now <= 10 && now > 0) this.sound.tick(now <= 5);
        this.sound.setHurry(this.timeLeft <= 10);
        if (this.timeLeft <= 10 && !this.cleared && this.renderer.cat.mood === 'idle') this.renderer.setCat('worry', 0.4);
        if (this.timeLeft <= 0) this.timeUp();
        this.updateHUD();
      }
    }

    updateIntro(dt) {
      this.introT += dt;
      const t = this.introT;
      if (t >= 2.1 && !$('levelCard').classList.contains('hidden')) $('levelCard').classList.add('hidden');
      const n = t < 2.1 ? -1 : t < 2.75 ? 3 : t < 3.4 ? 2 : t < 4.05 ? 1 : 0;
      if (n !== this.countShown && n >= 0) {
        this.countShown = n;
        const el = $('countdown');
        el.textContent = n > 0 ? String(n) : 'GO!';
        el.classList.remove('hidden', 'pop');
        void el.offsetWidth;
        el.classList.add('pop');
        this.sound.count(n);
      }
      if (t >= 4.5) {
        $('countdown').classList.add('hidden');
        this.state = 'play';
        this.input.enabled = true;
      }
    }

    stepWorld(dt, gx, gy, sx, sy, rot, scoring) {
      const w = this.world;
      w.step(dt, (gx + sx) * G, (gy + sy) * G, rot);
      const m = Math.hypot(gx, gy);
      const exits = w.postStep(dt, m > 0.05 ? gx / m : this.input.dx, m > 0.05 ? gy / m : this.input.dy);
      for (const b of exits) this.onPoured(b, scoring);
      if (w.impacts) this.sound.impact(this.mat.id, w.impacts, w.impactMax);
      const avg = w.activeCount ? w.speedSum / w.activeCount : 0;
      this.sound.flow(this.mat.id, this.state === 'title' ? 0 : U.clamp((avg - 25) / 380, 0, 1) * Math.min(1, w.activeCount / 40 + 0.3));
    }

    onPoured(b, scoring) {
      const mat = this.mat;
      this.renderer.addPoured(b, b.bonus ? mat.bonus.color : mat.pile[b.color % mat.pile.length]);
      if (!scoring || this.state !== 'play') return;
      this.poured++;
      this.combo = this.clock - this.lastPourT < 0.6 ? this.combo + 1 : 1;
      this.lastPourT = this.clock;
      let pts = Math.round(this.basePts * (1 + Math.min(this.combo, 40) / 20));
      const [sx, sy] = this.renderer.toScreen(b.cx, b.cy);
      if (b.bonus) {
        pts += 300;
        this.bonusGot++;
        if (this.tickets < 9) this.tickets++;
        this.renderer.popup('+300', sx, sy - 8, '#F2A818', 26, 1.3);
        const tr = $('btnTicket').getBoundingClientRect(), ar = this.canvas.getBoundingClientRect();
        this.renderer.popup('重新整理卷 +1', tr.left - ar.left + tr.width / 2 - 30, tr.bottom - ar.top + 22, '#E76F9A', 15, 1.6);
        this.renderer.burst(b.cx, b.cy, '#FFE36E', 16, 260);
        this.renderer.setCat('star', 1.3);
        this.sound.bonus();
        this.sound.ticket();
        vibrate([15, 40, 15]);
        const tb = $('btnTicket');
        tb.classList.remove('bounce'); void tb.offsetWidth; tb.classList.add('bounce');
      } else {
        this.renderer.setCat('happy', 0.5);
      }
      this.score += pts;
      this.levelPoints += pts;
      this.sound.pour(mat.id, this.combo);
      this.renderer.plate.pct = this.poured / this.total;
      if (!this.cleared && this.poured >= this.need) this.onTargetReached();
      if (this.poured >= this.total) this.finishLevel();
      this.updateHUD();
    }

    onTargetReached() {
      this.cleared = true;
      this.sound.clearTarget();
      this.renderer.setCat('star', 1.6);
      this.renderer.flash = 0.5;
      vibrate(40);
      const st = $('stamp');
      st.classList.remove('hidden', 'pop');
      void st.offsetWidth;
      st.classList.add('pop');
      setTimeout(() => st.classList.add('hidden'), 1700);
      $('btnFinish').classList.remove('hidden');
    }

    timeUp() {
      if (this.cleared) this.finishLevel();
      else this.gameOver();
    }

    finishLevel() {
      if (this.state !== 'play') return;
      this.state = 'result';
      this.input.enabled = false;
      this.hideAllFloating();
      const timeBonus = Math.ceil(this.timeLeft) * 15;
      const perfect = this.poured >= this.total ? 500 : 0;
      const itemPts = this.levelPoints;
      this.score += timeBonus + perfect;
      this.saveBest();
      $('resStage').textContent = this.cfg.n;
      $('resPct').textContent = Math.round((this.poured / this.total) * 100) + '%（' + this.poured + '/' + this.total + '）';
      $('resBonus').textContent = this.bonusGot + ' / ' + this.bonusTotal;
      $('resItems').textContent = '+' + itemPts;
      $('resTime').textContent = '+' + timeBonus;
      $('resPerfectRow').classList.toggle('hidden', !perfect);
      $('resTotal').textContent = this.score;
      this.sound.flow(this.mat.id, 0);
      this.sound.fanfare();
      this.renderer.confetti();
      this.renderer.setCat('star', 3);
      vibrate(60);
      setTimeout(() => this.showModal('resultModal'), 700);
    }

    gameOver() {
      this.state = 'over';
      this.input.enabled = false;
      this.hideAllFloating();
      this.saveBest();
      $('ovTarget').textContent = Math.round(this.target * 100) + '%';
      $('ovPct').textContent = Math.round((this.poured / this.total) * 100) + '%';
      $('ovStage').textContent = this.cfg.n;
      $('ovScore').textContent = this.score;
      $('ovBest').textContent = this.best;
      this.sound.flow(this.mat.id, 0);
      this.sound.stopBgm();
      this.sound.fail();
      this.renderer.setCat('worry', 9);
      setTimeout(() => this.showModal('overModal'), 600);
    }

    saveBest() {
      if (this.score > this.best) {
        this.best = this.score;
        U.store.set('best', this.best);
      }
    }

    // 重新整理卷：重新生成迷宮；計時不重來、已倒出的不會回來，剩下的內容物重新放回罐底
    useTicket() {
      if (this.state !== 'play' || this.paused) return;
      const btn = $('btnTicket');
      if (this.tickets <= 0) {
        this.toast('沒有重新整理卷了…倒出特殊物可以拿到！');
        btn.classList.remove('nope'); void btn.offsetWidth; btn.classList.add('nope');
        return;
      }
      if (!this.ticketArmed) {
        this.sound.click();
        this.ticketArmed = true;
        btn.classList.add('armed');
        clearTimeout(this.armTimer);
        this.armTimer = setTimeout(() => { this.ticketArmed = false; btn.classList.remove('armed'); }, 2500);
        return;
      }
      this.ticketArmed = false;
      btn.classList.remove('armed');
      this.tickets--;
      const remaining = this.world.bodies.filter((b) => !b.poured).map((b) => Object.assign(b.item, { where: 'room' }));
      this.setupLevel(this.cfg, this.rng, remaining);
      this.renderer.plate.pct = this.renderer.plate.shown = this.poured / this.total;
      this.renderer.flash = 1;
      this.renderer.pop = 1;
      this.renderer.burst(0, 0, '#fff', 24, 420);
      this.renderer.popup('迷宮重新生成！', this.renderer.cx, this.renderer.cy, this.mat.theme.accent, 22, 1.4);
      this.sound.refresh();
      vibrate(30);
      this.updateHUD();
    }

    knock(strength) {
      if (this.state !== 'play' || this.paused || !this.world) return;
      if (this.clock - this.lastKnockT < 0.18) return;
      this.lastKnockT = this.clock;
      const inp = this.input;
      this.world.jolt(inp.dx, inp.dy, strength, Math.random);
      this.renderer.jig.a = Math.min(1, 0.35 + strength * 0.6);
      this.sound.knock(strength);
    }

    isPlaying() { return this.state === 'intro' || this.state === 'play'; }

    pause(on) {
      if (on === this.paused || (on && !this.isPlaying())) return;
      this.paused = on;
      this.syncToggles();
      if (on) {
        this.showModal('pauseModal');
        this.sound.stopBgm();
        if (this.mat) this.sound.flow(this.mat.id, 0);
        this.input.enabled = false;
      } else {
        this.hideModal('pauseModal');
        this.sound.playBgm(this.cfg.mat);
        this.input.enabled = this.state === 'play';
        this.lastT = performance.now();
      }
    }

    updateHUD(force) {
      const c = this.hudCache;
      const set = (id, v) => { if (force || c[id] !== v) { c[id] = v; $(id).textContent = v; } };
      set('hStage', String(this.cfg ? this.cfg.n : 1));
      set('hTime', String(Math.ceil(this.timeLeft || 0)));
      set('hScore', String(this.score));
      set('hTickets', String(this.tickets));
      const hurry = this.state === 'play' && this.timeLeft <= 10;
      if (force || c.hurry !== hurry) { c.hurry = hurry; $('hTimeBox').classList.toggle('hurry', hurry); }
      const empty = this.tickets <= 0;
      if (force || c.empty !== empty) { c.empty = empty; $('btnTicket').classList.toggle('empty', empty); }
    }
  }

  window.addEventListener('DOMContentLoaded', () => { PM.game = new Game(); });
})();
