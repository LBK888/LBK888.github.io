/* The tissue behind the page.
 *
 * A Voronoi field of drifting cells, kept from the lab's original homepage:
 * every seed moves by Brownian motion with a short memory of its last five steps,
 * a resting cursor draws nearby cells towards it, a click adds a cell and a
 * double-click starts a new tissue. It is drawn the way a whole-mount in situ
 * looks under bright field: pale unstained tissue on white, NBT/BCIP purple in
 * stripes that sweep across it like the segmentation clock's waves, a few
 * Fast Red cells picked by lateral inhibition (each one out-signals all of its
 * neighbours), and DAB-brown nuclei in a fifth of the cells.
 *
 * It also measures itself. Every few frames it computes the Clark–Evans ratio R
 * (mean nearest-neighbour distance over the distance expected for a random
 * pattern) and the share of six-sided cells, and reports them through
 * window.labField.onStats. Three actions reshape it: clump, scatter, even.
 *
 * Needs assets/vendor/rhill-voronoi-core.min.js (global Voronoi).
 */
(function () {
  'use strict';
  var canvas = document.getElementById('tissue');
  if (!canvas || typeof Voronoi === 'undefined') return;
  var ctx = canvas.getContext('2d');
  var voronoi = new Voronoi();
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)');

  // Movement, as on the original page.
  var BROWNIAN = 0.2;          // step length per frame, px
  var MEMORY = 5;              // past steps that bias the next one
  var IDLE_MS = 200;           // cursor rest before it starts gathering cells
  var CHECK_MS = 100;          // how often the gathering pull is applied
  var PULL_RADIUS = 250;

  // Stain colours: a whole-mount in situ under bright field.
  var GROUND = '#f7f7f6';              // bright field
  var TISSUE_LIGHT = [238, 237, 233];  // unstained tissue, barely toned
  var TISSUE_DARK = [224, 222, 215];
  var NBT = '70,56,148';               // NBT/BCIP
  var FAST_RED = '168,31,46';          // Fast Red
  var DAB = '94,59,28';                // DAB
  var PALE_NUCLEUS = '150,140,128';
  var WAVE_PERIOD = 9;                 // seconds for one clock cycle
  var red = {};                        // cells picked by lateral inhibition
  var lastPick = 0;

  var W = 0, H = 0, dpr = 1;
  var pts = [];
  var diagram = null;
  var pointer = { x: -1e4, y: -1e4, moved: 0, inside: false };
  var lastPull = 0;
  var tween = null;            // { t0, dur, from:[{x,y}], to:[{x,y}] } or { lloyd: frames }
  var added = 0;
  var lastStats = 0;
  var listeners = [];

  function point(x, y) {
    var hist = [];
    for (var i = 0; i < MEMORY; i++) hist.push({ x: 0, y: 0 });
    return { x: x, y: y, hist: hist, tone: Math.random(), stain: Math.random() };
  }

  function wanted() {
    return Math.round(Math.min(170, Math.max(60, (W * H) / 8500)));
  }

  function seed() {
    pts = [];
    var n = wanted();
    for (var i = 0; i < n; i++) pts.push(point(Math.random() * W, Math.random() * H));
    added = 0;
  }

  function resize() {
    var w = canvas.clientWidth || window.innerWidth;
    var h = canvas.clientHeight || window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var sx = W ? w / W : 1, sy = H ? h / H : 1;
    W = w; H = h;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!pts.length) seed();
    else pts.forEach(function (p) { p.x = Math.min(W, p.x * sx); p.y = Math.min(H, p.y * sy); });
    draw();
  }

  // ---- motion ------------------------------------------------------------

  function brownian() {
    for (var k = 0; k < pts.length; k++) {
      var p = pts[k];
      var dx = (Math.random() * 2 - 1) * BROWNIAN;
      var dy = (Math.random() * 2 - 1) * BROWNIAN;
      for (var i = 0; i < MEMORY; i++) {
        var w = (MEMORY - i) / (MEMORY * MEMORY);
        dx += p.hist[i].x * w;
        dy += p.hist[i].y * w;
      }
      var m = Math.sqrt(dx * dx + dy * dy);
      if (m > 0) { dx = (dx / m) * BROWNIAN; dy = (dy / m) * BROWNIAN; }
      p.x = Math.max(0, Math.min(W, p.x + dx));
      p.y = Math.max(0, Math.min(H, p.y + dy));
      p.hist.pop();
      p.hist.unshift({ x: dx, y: dy });
    }
  }

  function pull(now) {
    if (!canHover.matches || !pointer.inside) return;
    if (now - pointer.moved < IDLE_MS || now - lastPull < CHECK_MS) return;
    lastPull = now;
    for (var k = 0; k < pts.length; k++) {
      var p = pts[k];
      var dx = p.x - pointer.x, dy = p.y - pointer.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < PULL_RADIUS && d > 20) {
        p.x += (pointer.x - p.x) * 0.00015 * (PULL_RADIUS - d);
        p.y += (pointer.y - p.y) * 0.00015 * (PULL_RADIUS - d);
      }
    }
  }

  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function stepTween(now) {
    if (!tween) return;
    if (tween.lloyd) {
      lloyd(0.35);
      if (--tween.lloyd <= 0) tween = null;
      return;
    }
    var t = Math.min(1, (now - tween.t0) / tween.dur), e = ease(t);
    for (var i = 0; i < pts.length && i < tween.to.length; i++) {
      pts[i].x = tween.from[i].x + (tween.to[i].x - tween.from[i].x) * e;
      pts[i].y = tween.from[i].y + (tween.to[i].y - tween.from[i].y) * e;
    }
    if (t >= 1) tween = null;
  }

  // One Lloyd relaxation step: move each seed part of the way to its cell's centroid.
  function lloyd(amount) {
    var d = compute();
    if (!d) return;
    for (var c = 0; c < d.cells.length; c++) {
      var cell = d.cells[c];
      var p = pts[cell.site.i];
      var hs = cell.halfedges;
      if (!p || hs.length < 3) continue;
      var a = 0, cx = 0, cy = 0;
      for (var i = 0; i < hs.length; i++) {
        var s = hs[i].getStartpoint(), e = hs[i].getEndpoint();
        var f = s.x * e.y - e.x * s.y;
        a += f; cx += (s.x + e.x) * f; cy += (s.y + e.y) * f;
      }
      if (!a) continue;
      cx /= 3 * a; cy /= 3 * a;
      p.x += (cx - p.x) * amount;
      p.y += (cy - p.y) * amount;
    }
  }

  // ---- drawing -----------------------------------------------------------

  function compute() {
    if (diagram) voronoi.recycle(diagram);
    var sites = pts.map(function (p, i) { return { x: p.x, y: p.y, i: i }; });
    try {
      diagram = voronoi.compute(sites, { xl: 0, xr: W, yt: 0, yb: H });
    } catch (e) {
      diagram = null;
    }
    return diagram;
  }

  function calm() {
    // Full strength on the first screen, quieter once the reader scrolls on.
    var y = window.scrollY || 0;
    return Math.max(0, Math.min(1, y / (window.innerHeight * 0.8)));
  }

  // How strongly a cell holds the NBT/BCIP stain: arced stripes that travel
  // across the tissue, one clock cycle every WAVE_PERIOD seconds.
  function wave(p, t) {
    var lambda = Math.max(230, Math.min(480, W / 3.2));
    var dy = p.y - H / 2;
    var bend = (0.55 * dy * dy) / H;
    var s = 0.5 + 0.5 * Math.cos(2 * Math.PI * ((p.x + bend) / lambda + t / WAVE_PERIOD));
    var k = (s - 0.74) / 0.22;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    return k * k * (3 - 2 * k) * (0.7 + 0.3 * p.stain);
  }

  // Lateral inhibition: a cell turns Fast Red only if it out-signals every neighbour,
  // so red cells are never side by side.
  function pickRed(d) {
    var best = {};
    for (var e = 0; e < d.edges.length; e++) {
      var ed = d.edges[e];
      if (!ed.lSite || !ed.rSite) continue;
      var a = ed.lSite.i, b = ed.rSite.i;
      if (!pts[a] || !pts[b]) continue;
      if (!(best[a] >= pts[b].tone)) best[a] = pts[b].tone;
      if (!(best[b] >= pts[a].tone)) best[b] = pts[a].tone;
    }
    red = {};
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].tone > 0.92 && pts[i].tone > (best[i] || 0)) red[i] = true;
    }
  }

  function cellPath(hs) {
    ctx.beginPath();
    var s0 = hs[0].getStartpoint();
    ctx.moveTo(s0.x, s0.y);
    for (var i = 1; i < hs.length; i++) { var s = hs[i].getStartpoint(); ctx.lineTo(s.x, s.y); }
    ctx.closePath();
  }

  function draw() {
    var d = compute();
    ctx.clearRect(0, 0, W, H);
    if (!d) return;
    var now = performance.now();
    var q = calm();
    var t = reduce.matches ? 0 : now / 1000;
    if (!lastPick || now - lastPick > 400) { pickRed(d); lastPick = now; }
    var tissueAlpha = 1 - 0.5 * q;
    var stainAlpha = 0.92 - 0.7 * q;

    for (var c = 0; c < d.cells.length; c++) {
      var cell = d.cells[c], hs = cell.halfedges;
      if (hs.length < 3) continue;
      var idx = cell.site.i, p = pts[idx];
      if (!p) continue;
      cellPath(hs);
      // unstained tissue
      ctx.globalAlpha = tissueAlpha;
      ctx.fillStyle = 'rgb(' +
        Math.round(TISSUE_LIGHT[0] + (TISSUE_DARK[0] - TISSUE_LIGHT[0]) * p.tone) + ',' +
        Math.round(TISSUE_LIGHT[1] + (TISSUE_DARK[1] - TISSUE_LIGHT[1]) * p.tone) + ',' +
        Math.round(TISSUE_LIGHT[2] + (TISSUE_DARK[2] - TISSUE_LIGHT[2]) * p.tone) + ')';
      ctx.fill();
      // the stains on top
      var w = red[idx] ? 0.78 : wave(p, t);
      if (w > 0.02) {
        ctx.globalAlpha = stainAlpha * w;
        ctx.fillStyle = 'rgb(' + (red[idx] ? FAST_RED : NBT) + ')';
        ctx.fill();
      }
    }

    // membranes: the gaps between cells, in the ground colour
    ctx.globalAlpha = 1;
    ctx.strokeStyle = GROUND;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (var e = 0; e < d.edges.length; e++) {
      var ed = d.edges[e];
      ctx.moveTo(ed.va.x, ed.va.y);
      ctx.lineTo(ed.vb.x, ed.vb.y);
    }
    ctx.stroke();

    // nuclei, slightly elongated along each cell's last step: pale in most cells,
    // DAB brown in a fifth of them
    var r0 = Math.max(2.4, Math.min(5.5, Math.sqrt((W * H) / pts.length) / 16));
    var pale = 'rgba(' + PALE_NUCLEUS + ',' + (0.42 - 0.26 * q).toFixed(3) + ')';
    var dab = 'rgba(' + DAB + ',' + (0.82 - 0.52 * q).toFixed(3) + ')';
    for (var k = 0; k < pts.length; k++) {
      var pk = pts[k], h = pk.hist[0];
      var ang = Math.atan2(h.y, h.x) || 0;
      ctx.fillStyle = pk.tone < 0.2 ? dab : pale;
      ctx.beginPath();
      ctx.ellipse(pk.x, pk.y, r0 * 1.18, r0 * 0.82, ang, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- measuring ---------------------------------------------------------

  function stats() {
    var n = pts.length;
    if (n < 3) return null;
    var sum = 0;
    for (var i = 0; i < n; i++) {
      var best = Infinity, a = pts[i];
      for (var j = 0; j < n; j++) {
        if (i === j) continue;
        var dx = a.x - pts[j].x, dy = a.y - pts[j].y, dd = dx * dx + dy * dy;
        if (dd < best) best = dd;
      }
      sum += Math.sqrt(best);
    }
    var area = W * H, perim = 2 * (W + H);
    // expected mean distance for a random pattern, with Donnelly's edge correction
    var expected = 0.5 * Math.sqrt(area / n) + (0.0514 + 0.041 / Math.sqrt(n)) * (perim / n);
    var R = sum / n / expected;

    var inner = 0, six = 0;
    if (diagram) {
      for (var c = 0; c < diagram.cells.length; c++) {
        var hs = diagram.cells[c].halfedges, border = false;
        for (var k = 0; k < hs.length; k++) { if (!hs[k].edge.rSite) { border = true; break; } }
        if (border || hs.length < 3) continue;
        inner++;
        if (hs.length === 6) six++;
      }
    }
    var verdict = R < 0.8 ? 'clustered' : R > 1.25 ? 'regular' : 'random';
    return { cells: n, added: added, R: R, hexagons: inner ? six / inner : 0, verdict: verdict };
  }

  function emit(now, force) {
    if (!force && now - lastStats < 320) return;
    lastStats = now;
    var s = stats();
    if (s) listeners.forEach(function (fn) { fn(s); });
  }

  // ---- loop ----------------------------------------------------------------

  var running = false;
  function frame(now) {
    if (!reduce.matches) {
      brownian();
      pull(now);
    }
    stepTween(now);
    draw();
    emit(now);
    if (!reduce.matches || tween) window.requestAnimationFrame(frame);
    else running = false;
  }
  function start() {
    if (running) return;
    running = true;
    window.requestAnimationFrame(frame);
  }

  // ---- actions -----------------------------------------------------------

  function visibleRect() {
    var el = document.querySelector('.hero-field');
    if (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom > 80 && r.top < H) {
        return { x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(W, r.right) - Math.max(0, r.left), h: Math.min(H, r.bottom) - Math.max(0, r.top) };
      }
    }
    return { x: 0, y: 0, w: W, h: H };
  }

  function moveTo(targets, dur) {
    if (reduce.matches) {
      targets.forEach(function (t, i) { pts[i].x = t.x; pts[i].y = t.y; });
      draw(); emit(0, true);
      return;
    }
    tween = { t0: performance.now(), dur: dur, from: pts.map(function (p) { return { x: p.x, y: p.y }; }), to: targets };
    start();
  }

  function gauss() {
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  var api = {
    clump: function () {
      var r = visibleRect(), k = 3 + Math.round(Math.random());
      var centres = [];
      for (var i = 0; i < k; i++) centres.push({ x: r.x + r.w * (0.2 + 0.6 * Math.random()), y: r.y + r.h * (0.2 + 0.6 * Math.random()) });
      var sigma = Math.min(r.w, r.h) * 0.07;
      moveTo(pts.map(function (p, i) {
        var c = centres[i % k];
        return { x: Math.max(0, Math.min(W, c.x + gauss() * sigma)), y: Math.max(0, Math.min(H, c.y + gauss() * sigma)) };
      }), 1300);
    },
    scatter: function () {
      moveTo(pts.map(function () { return { x: Math.random() * W, y: Math.random() * H }; }), 1100);
    },
    even: function () {
      if (reduce.matches) {
        for (var i = 0; i < 40; i++) lloyd(1);
        draw(); emit(0, true);
        return;
      }
      tween = { lloyd: 70 };
      start();
    },
    reset: function () { seed(); draw(); emit(0, true); start(); },
    onStats: function (fn) { listeners.push(fn); emit(0, true); },
  };
  window.labField = api;

  // ---- input -------------------------------------------------------------

  function onField(target) {
    if (!target || !target.closest) return false;
    if (target.closest('a, button, input, select, textarea, label, summary, [data-nofield]')) return false;
    return !!target.closest('[data-field]');
  }

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.moved = performance.now();
    pointer.inside = true;
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', function () { pointer.inside = false; });

  document.addEventListener('click', function (e) {
    if (!onField(e.target) || e.detail > 1) return;
    pts.push(point(e.clientX, e.clientY));
    added++;
    draw(); emit(0, true); start();
  });
  document.addEventListener('dblclick', function (e) {
    if (!onField(e.target)) return;
    e.preventDefault();
    api.reset();
  });

  window.addEventListener('resize', resize);
  window.addEventListener('scroll', function () { if (!running) draw(); }, { passive: true });
  reduce.addEventListener && reduce.addEventListener('change', start);

  resize();
  start();
})();
