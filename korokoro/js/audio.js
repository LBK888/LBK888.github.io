/* 背景音樂與音效：全部以 Web Audio 即時合成，不需要任何音檔。
   BGM 用 J-pop 常見的「王道進行」(IV-V-iii-vi) + 五聲音階旋律，音色是音樂盒/木琴。 */
(function () {
  'use strict';
  const PM = window.PM, U = PM.U;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const PENTA = [0, 2, 4, 7, 9];
  const CH = { I: [0, 4, 7], iii: [4, 7, 11], IV: [5, 9, 12], V: [7, 11, 14], vi: [9, 12, 16] };
  const PROG = ['IV', 'V', 'iii', 'vi', 'IV', 'V', 'I', 'I'];
  const RHY = [
    [1, 0, 1, 0, 1, 1, 1, 0], [1, 2, 1, 0, 1, 2, 2, 0], [1, 1, 1, 0, 1, 0, 1, 1],
    [1, 2, 2, 1, 1, 2, 1, 0], [0, 1, 1, 1, 1, 2, 1, 0], [1, 0, 1, 1, 0, 1, 1, 0],
  ];
  const SONGS = {
    title: { seed: 5, bpm: 96, key: 0 },
    water: { seed: 11, bpm: 104, key: 2 }, pills: { seed: 23, bpm: 108, key: 0 },
    balls: { seed: 37, bpm: 116, key: 5 }, lottery: { seed: 41, bpm: 112, key: 7 },
    candy: { seed: 53, bpm: 110, key: 4 }, honey: { seed: 61, bpm: 92, key: -2 },
    sugar: { seed: 71, bpm: 100, key: 9 }, salt: { seed: 83, bpm: 104, key: -3 },
  };
  // 內容物流動的「沙沙 / 嘩啦」連續聲
  const FLOW = {
    water: ['bandpass', 650, 0.7, 0.22], honey: ['lowpass', 320, 0.7, 0.14],
    salt: ['bandpass', 5200, 0.6, 0.2], sugar: ['bandpass', 3800, 1, 0.12],
    pills: ['bandpass', 2800, 1.2, 0.08], candy: ['bandpass', 2600, 1.2, 0.08],
    balls: ['bandpass', 1400, 1, 0.05], lottery: ['bandpass', 1700, 1, 0.06],
  };

  class Sound {
    constructor() {
      this.ctx = null;
      this.bgmOn = U.store.get('bgm', true);
      this.sfxOn = U.store.get('sfx', true);
      this.timer = null; this.song = null; this.songId = null;
      this.tempoMul = 1;
      this.last = {};
      this.pourIdx = 0;
    }

    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      comp.connect(ctx.destination);
      this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(comp);
      this.bgm = ctx.createGain(); this.bgm.gain.value = this.bgmOn ? 0.34 : 0; this.bgm.connect(this.master);
      this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxOn ? 0.85 : 0; this.sfx.connect(this.master);
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      this.flowF = ctx.createBiquadFilter();
      this.flowG = ctx.createGain(); this.flowG.gain.value = 0;
      src.connect(this.flowF); this.flowF.connect(this.flowG); this.flowG.connect(this.sfx);
      src.start();
      // iOS：播放一段無聲解鎖
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    }

    ok() { return this.ctx && this.sfxOn && this.ctx.state === 'running'; }
    get now() { return this.ctx.currentTime; }

    setBgm(on) {
      this.bgmOn = on; U.store.set('bgm', on);
      if (this.bgm) this.bgm.gain.setTargetAtTime(on ? 0.34 : 0, this.now, 0.05);
    }
    setSfx(on) {
      this.sfxOn = on; U.store.set('sfx', on);
      if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 0.85 : 0, this.now, 0.05);
    }

    // ---------- 合成器 ----------
    tone(type, f, t, dur, vol, dest, f2) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest || this.sfx);
      o.start(t); o.stop(t + dur + 0.03);
    }
    noiseHit(t, dur, vol, type, freq, q, dest, freq2) {
      const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      s.buffer = this.noise;
      f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 1;
      if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(dest || this.sfx);
      s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.03);
    }
    bell(f, t, dur, vol, dest) {
      this.tone('sine', f, t, Math.max(0.35, dur * 1.6), vol, dest);
      this.tone('sine', f * 2, t, 0.22, vol * 0.22, dest);
      this.tone('triangle', f * 4, t, 0.07, vol * 0.05, dest);
    }

    // ---------- 背景音樂 ----------
    makeSong(cfg) {
      const rng = U.makeRng(cfg.seed);
      const notes = [];
      for (let o = 0; o < 2; o++) for (const p of PENTA) notes.push(72 + o * 12 + p);
      let idx = 4;
      const barMel = (bar) => {
        const r = U.pick(RHY, rng), chord = CH[PROG[bar]], out = [];
        for (let s = 0; s < 8; s++) {
          if (r[s] !== 1) { out.push(r[s] === 2 && s > 0 ? -2 : -1); continue; }
          idx = U.clamp(idx + Math.round((rng() - 0.5) * 3.2), 0, notes.length - 1);
          let n = notes[idx];
          if (s === 0 || s === 4) {
            let best = n, bd = 99;
            for (const c of chord) {
              for (const o of [60, 72, 84]) {
                const cand = o + c;
                if (cand >= 69 && cand <= 93 && Math.abs(cand - n) < bd) { bd = Math.abs(cand - n); best = cand; }
              }
            }
            n = best;
          }
          out.push(n);
        }
        return out;
      };
      const A = [0, 1, 2, 3].map(barMel);
      const e1 = barMel(6), e2 = barMel(7);
      e2[0] = 72; e2[1] = e2[2] = e2[3] = -2; e2[4] = e2[5] = e2[6] = e2[7] = -1;
      const mel = [].concat(A[0], A[1], A[2], A[3], A[0], A[1], e1, e2);
      return { bpm: cfg.bpm, key: cfg.key, prog: PROG.map((p) => CH[p]), mel };
    }

    playBgm(id) {
      if (!this.ctx) return;
      if (this.songId === id && this.timer) return;
      this.stopBgm();
      this.songId = id;
      this.song = this.makeSong(SONGS[id] || SONGS.title);
      this.step = 0;
      this.tempoMul = 1;
      this.nextT = this.ctx.currentTime + 0.1;
      this.timer = setInterval(() => this.sched(), 25);
    }

    stopBgm() {
      clearInterval(this.timer);
      this.timer = null;
      this.songId = null;
    }

    sched() {
      const now = this.ctx.currentTime;
      if (this.nextT < now - 0.3) this.nextT = now + 0.05;
      while (this.nextT < now + 0.12) {
        if (this.bgmOn && this.ctx.state === 'running') this.playStep(this.step, this.nextT);
        this.nextT += 60 / (this.song.bpm * this.tempoMul) / 2;
        this.step = (this.step + 1) & 63;
      }
    }

    playStep(s, t) {
      const sg = this.song, pos = s & 7, ch = sg.prog[(s >> 3) & 7], k = sg.key, out = this.bgm;
      const spb = 60 / (sg.bpm * this.tempoMul) / 2;
      if (pos === 0 || pos === 4) {
        const f = mtof(43 + k + ch[pos === 4 && (s & 8) ? 2 : 0] - 12 * (ch[0] > 7 ? 1 : 0));
        this.tone('triangle', f, t, spb * 3.4, 0.2, out);
        this.tone('sine', f, t, spb * 3.4, 0.14, out);
      }
      if (pos % 2 === 0) this.tone('triangle', mtof(64 + k + ch[(pos >> 1) % 3]), t, spb * 1.6, 0.05, out);
      const n = sg.mel[s];
      if (n >= 0) {
        let len = 1;
        while (sg.mel[(s + len) & 63] === -2) len++;
        this.bell(mtof(n + k), t, len * spb, 0.11, out);
      }
      if (pos % 2 === 1) this.noiseHit(t, 0.03, 0.035, 'highpass', 7000, 0.7, out);
      if (pos === 0) this.tone('sine', 150, t, 0.14, 0.24, out, 50);
      if (pos === 4) this.noiseHit(t, 0.09, 0.07, 'bandpass', 1800, 0.8, out);
    }

    setHurry(on) { this.tempoMul = on ? 1.14 : 1; }

    // ---------- 音效 ----------
    impact(mat, count, maxV) {
      if (!this.ok() || !count) return;
      const t = this.now;
      if (t - (this.last.imp || 0) < 0.04) return;
      this.last.imp = t;
      const vol = U.clamp((maxV - 140) / 900, 0.03, 0.35) * Math.min(1, 0.45 + count * 0.08);
      const rnd = Math.random();
      switch (mat) {
        case 'water': this.tone('sine', 700 + rnd * 600, t, 0.07, vol * 0.45, null, 1400 + rnd * 600); break;
        case 'honey': this.tone('sine', 190 + rnd * 70, t, 0.13, vol * 0.6, null, 300); break;
        case 'balls': this.tone('sine', 300 + rnd * 180, t, 0.1, vol, null, 170); break;
        case 'lottery':
          this.tone('square', 1000 + rnd * 300, t, 0.03, vol * 0.2);
          this.noiseHit(t, 0.03, vol * 0.4, 'bandpass', 2600, 2);
          break;
        case 'salt': this.noiseHit(t, 0.03, vol * 0.45, 'highpass', 5200, 0.7); break;
        default: this.tone('triangle', 1900 + rnd * 1300, t, 0.035, vol * 0.45);
      }
    }

    flow(mat, amount) {
      if (!this.ctx) return;
      const c = FLOW[mat] || FLOW.water;
      const a = this.sfxOn ? U.clamp(amount, 0, 1) : 0;
      if (this.flowF.type !== c[0]) this.flowF.type = c[0];
      this.flowF.frequency.setTargetAtTime(c[1] * (0.75 + a * 0.6), this.now, 0.1);
      this.flowF.Q.value = c[2];
      this.flowG.gain.setTargetAtTime(a * a * c[3], this.now, 0.08);
    }

    // 倒出：依連擊數往上走五聲音階，倒成一串就像一段小旋律
    pour(mat, combo) {
      if (!this.ok()) return;
      const t = this.now;
      if (t - (this.last.pour || 0) < 0.045) return;
      this.last.pour = t;
      if (combo <= 1) this.pourIdx = 0;
      const i = this.pourIdx++ % 15;
      const f = mtof(72 + (this.song ? this.song.key : 0) + PENTA[i % 5] + 12 * Math.floor(i / 5));
      if (mat === 'water') this.tone('sine', f * 0.5, t, 0.12, 0.17, null, f);
      else if (mat === 'honey') this.tone('sine', f * 0.35, t, 0.2, 0.2, null, f * 0.55);
      else this.bell(f, t, 0.1, 0.1);
    }

    bonus() {
      if (!this.ok()) return;
      const t = this.now;
      [0, 4, 7, 12, 16].forEach((p, i) => this.bell(mtof(84 + p), t + i * 0.055, 0.2, 0.13));
      this.noiseHit(t, 0.4, 0.04, 'highpass', 8000, 0.5);
    }
    ticket() {
      if (!this.ok()) return;
      const t = this.now + 0.32;
      this.tone('square', mtof(88), t, 0.09, 0.06);
      this.tone('square', mtof(93), t + 0.09, 0.18, 0.06);
    }
    refresh() {
      if (!this.ok()) return;
      const t = this.now;
      this.noiseHit(t, 0.55, 0.16, 'bandpass', 300, 1.4, null, 5000);
      [72, 76, 79, 84].forEach((m, i) => this.bell(mtof(m), t + 0.35 + i * 0.05, 0.25, 0.1));
    }
    knock(strength) {
      if (!this.ok()) return;
      const t = this.now, v = 0.15 + strength * 0.25;
      this.tone('sine', 150, t, 0.13, v, null, 70);
      this.noiseHit(t, 0.025, v * 0.5, 'bandpass', 1300, 1.5);
    }
    tick(urgent) {
      if (!this.ok()) return;
      this.tone('triangle', urgent ? 1500 : 1050, this.now, 0.06, 0.13);
    }
    count(n) {
      if (!this.ok()) return;
      const t = this.now;
      if (n > 0) this.bell(mtof(79), t, 0.15, 0.16);
      else { this.bell(mtof(91), t, 0.3, 0.16); this.bell(mtof(86), t, 0.3, 0.12); this.bell(mtof(84), t, 0.3, 0.1); }
    }
    clearTarget() {
      if (!this.ok()) return;
      const t = this.now;
      [0, 4, 7, 12].forEach((p, i) => this.bell(mtof(79 + p), t + i * 0.07, 0.15, 0.14));
    }
    fanfare() {
      if (!this.ok()) return;
      const t = this.now;
      const seq = [[72, 0], [76, 0.12], [79, 0.24], [84, 0.36], [81, 0.6], [84, 0.72], [88, 0.84]];
      for (const [m, d] of seq) { this.bell(mtof(m), t + d, 0.2, 0.15); this.tone('triangle', mtof(m - 12), t + d, 0.18, 0.06); }
      for (const m of [60, 64, 67, 72]) this.tone('triangle', mtof(m), t + 0.84, 0.9, 0.06);
    }
    fail() {
      if (!this.ok()) return;
      const t = this.now;
      [79, 76, 72, 67].forEach((m, i) => this.tone('triangle', mtof(m), t + i * 0.2, 0.32, 0.13));
    }
    click() {
      if (!this.ok()) return;
      this.tone('sine', 880, this.now, 0.06, 0.08, null, 1320);
    }
  }

  PM.Sound = Sound;
})();
