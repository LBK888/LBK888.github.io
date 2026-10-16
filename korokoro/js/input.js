/* 操作：手機傾斜（方向感測器）+ 搖晃 / 輕拍（加速度計）；
   電腦或沒有感測器時：拖曳旋轉、方向鍵、空白鍵搖晃。 */
(function () {
  'use strict';
  const PM = window.PM, U = PM.U;
  const D2R = Math.PI / 180;

  class Input {
    constructor() {
      this.mode = 'touch';          // 'tilt' | 'touch'
      this.gx = 0; this.gy = 1;     // 罐子座標中的重力（長度 0..1）
      this.dx = 0; this.dy = 1;     // 重力單位方向
      this.sx = 0; this.sy = 0;     // 搖晃造成的額外加速度（以 g 為單位）
      this.view = 0; this.target = 0;
      this.omega = 0; this.alpha = 0;
      this.ori = null; this.oriT = 0; this.dev = null;
      this.motionGrav = null; this.motionT = 0; this.shakeStamp = 0;
      this.f = { x: 0, y: 1 };
      this.calib = -1;              // accelerationIncludingGravity 正負號（依平台）
      this.lp = null;
      this.keys = {};
      this.shakeT = 0;
      this.onKnock = null;
      this.lastKnock = 0;
      this.drag = null; this.lastTap = null;
      this.enabled = false;
      this._ori = this._ori.bind(this);
      this._motion = this._motion.bind(this);
    }

    // 必須在使用者點擊的同一個事件處理裡呼叫（iOS 的權限要求）
    requestSensors() {
      const asks = [];
      try {
        if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') asks.push(DeviceOrientationEvent.requestPermission());
        if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') asks.push(DeviceMotionEvent.requestPermission());
      } catch (e) { /* 舊瀏覽器 */ }
      return Promise.all(asks.map((p) => p.catch(() => 'denied'))).then(() => {
        window.addEventListener('deviceorientation', this._ori);
        window.addEventListener('devicemotion', this._motion);
        return new Promise((resolve) => {
          const t0 = performance.now();
          const check = () => {
            if (this.ori || this.motionGrav) return resolve(true);
            if (performance.now() - t0 > 1300) return resolve(false);
            setTimeout(check, 60);
          };
          check();
        });
      });
    }

    get sensorsAlive() { return !!(this.ori || this.motionGrav); }

    _ori(e) {
      if (e.beta == null || e.gamma == null) return;
      const b = e.beta * D2R, g = e.gamma * D2R, cb = Math.cos(b);
      // 重力在裝置座標（x 右、y 往螢幕上方、z 出螢幕）
      this.dev = [Math.sin(g) * cb, -Math.sin(b), -Math.cos(g) * cb];
      this.ori = { x: this.dev[0], y: -this.dev[1] };
      this.oriT = performance.now();
    }

    _motion(e) {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      const now = performance.now();
      const ax = a.x / 9.81, ay = a.y / 9.81, az = (a.z || 0) / 9.81;
      // 用方向感測器校正正負號：規格上靜止時 a = -重力
      if (this.dev) {
        const dot = ax * this.dev[0] + ay * this.dev[1] + az * this.dev[2];
        this.calib = U.clamp(this.calib + Math.sign(dot) * 0.05, -1, 1);
      }
      const s = this.calib <= 0 ? -1 : 1;
      const cx = s * ax, cy = s * ay, cz = s * az;
      const dt = this.motionT ? Math.min(0.1, (now - this.motionT) / 1000) : 0.016;
      this.motionT = now;
      if (!this.lp) this.lp = [cx, cy, cz];
      const k = 1 - Math.exp(-dt / 0.22);
      this.lp[0] += (cx - this.lp[0]) * k;
      this.lp[1] += (cy - this.lp[1]) * k;
      this.lp[2] += (cz - this.lp[2]) * k;
      this.motionGrav = { x: this.lp[0], y: -this.lp[1] };

      // 手機本身的線性加速度 → 內容物受到反向的慣性力
      let lx, ly, lz;
      const L = e.acceleration;
      if (L && L.x != null) { lx = (s * L.x) / 9.81; ly = (s * L.y) / 9.81; lz = (s * (L.z || 0)) / 9.81; }
      else { lx = cx - this.lp[0]; ly = cy - this.lp[1]; lz = cz - this.lp[2]; }
      let sx = lx, sy = -ly;
      const m = Math.hypot(sx, sy);
      const scale = m > 0.1 ? (Math.min(m, 3) - 0.1) / m : 0;
      this.sx += (sx * scale - this.sx) * 0.6;
      this.sy += (sy * scale - this.sy) * 0.6;
      this.shakeStamp = now;
      // 輕拍：z 軸（敲背面/螢幕）或很強的平面方向短促尖峰
      const spike = Math.max(Math.abs(lz), m * 0.55);
      if (spike > 0.42 && now - this.lastKnock > 260) {
        this.lastKnock = now;
        if (this.enabled && this.onKnock) this.onKnock(U.clamp((spike - 0.3) / 1.2, 0.25, 1));
      }
    }

    reset() {
      this.view = this.target = 0;
      this.omega = this.alpha = 0;
      this.sx = this.sy = 0;
      this.shakeT = 0;
    }

    knock(strength) {
      if (this.enabled && this.onKnock) this.onKnock(strength);
    }

    shake() {
      this.shakeT = 0.55;
      this.knock(0.5);
    }

    update(dt) {
      if (this.mode === 'tilt') {
        const fresh = this.ori && performance.now() - this.oriT < 700;
        const src = fresh ? this.ori : this.motionGrav;
        if (src) {
          const k = 1 - Math.exp(-dt / 0.035);
          this.f.x += (src.x - this.f.x) * k;
          this.f.y += (src.y - this.f.y) * k;
        }
        const m = Math.hypot(this.f.x, this.f.y);
        // 手機平放時幾乎沒有平面重力：內容物會停下來
        const s = U.smoothstep(0.05, 0.4, m);
        if (m > 1e-4) { this.dx = this.f.x / m; this.dy = this.f.y / m; }
        this.gx = this.dx * s; this.gy = this.dy * s;
        if (performance.now() - this.shakeStamp > 150) { this.sx *= 0.8; this.sy *= 0.8; }
        this.view = this.target = 0;
        this.omega = this.alpha = 0;
      } else {
        const dir = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
        this.target += dir * 2.6 * dt;
        const prev = this.view;
        this.view += (this.target - this.view) * (1 - Math.exp(-dt / 0.045));
        const w = (this.view - prev) / Math.max(dt, 1e-3);
        const pw = this.omega;
        this.omega += (w - this.omega) * 0.5;
        this.alpha += ((this.omega - pw) / Math.max(dt, 1e-3) - this.alpha) * 0.3;
        this.dx = this.gx = Math.sin(this.view);
        this.dy = this.gy = Math.cos(this.view);
        if (this.shakeT > 0) {
          this.shakeT = Math.max(0, this.shakeT - dt);
          const amp = Math.sin((0.55 - this.shakeT) * Math.PI * 2 * 7.5) * 1.7 * (this.shakeT / 0.55);
          this.sx = -this.dy * amp + this.dx * amp * 0.25;
          this.sy = this.dx * amp + this.dy * amp * 0.25;
        } else { this.sx = this.sy = 0; }
      }
    }

    // 觸控/滑鼠：繞罐子中心拖曳旋轉；雙擊 = 輕拍
    attach(el, getCenter) {
      el.addEventListener('pointerdown', (e) => {
        if (!this.enabled || this.mode !== 'touch') return;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        const c = getCenter();
        this.drag = { id: e.pointerId, a: Math.atan2(e.clientY - c.y, e.clientX - c.x) };
        const now = performance.now();
        if (this.lastTap && now - this.lastTap.t < 320 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 40) {
          this.knock(0.8);
          this.lastTap = null;
        } else this.lastTap = { t: now, x: e.clientX, y: e.clientY };
      });
      el.addEventListener('pointermove', (e) => {
        if (!this.drag || e.pointerId !== this.drag.id) return;
        const c = getCenter();
        const dx = e.clientX - c.x, dy = e.clientY - c.y;
        if (Math.hypot(dx, dy) < 18) return;
        const a = Math.atan2(dy, dx);
        this.target += U.angleDiff(a, this.drag.a);
        this.drag.a = a;
      });
      const end = (e) => { if (this.drag && e.pointerId === this.drag.id) this.drag = null; };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('wheel', (e) => {
        if (!this.enabled || this.mode !== 'touch') return;
        e.preventDefault();
        this.target += Math.sign(e.deltaY) * 0.2;
      }, { passive: false });
      const key = (down) => (e) => {
        const k = e.key;
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') this.keys.left = down;
        else if (k === 'ArrowRight' || k === 'd' || k === 'D') this.keys.right = down;
        else if (down && (k === ' ' || k === 'Spacebar')) { if (this.enabled) { this.shake(); e.preventDefault(); } }
        else if (down && (k === 'ArrowUp' || k === 'w' || k === 'W')) this.knock(0.8);
        else return;
        if (this.enabled) e.preventDefault();
      };
      window.addEventListener('keydown', key(true));
      window.addEventListener('keyup', key(false));
      window.addEventListener('blur', () => { this.keys = {}; });
    }
  }

  PM.Input = Input;
})();
