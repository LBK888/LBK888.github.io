/* Handheld panel tracking. Pose = homography from the reference frame to the
   current frame (normalized 0–1 coordinates).
   1. Frame-to-frame Lucas–Kanade keeps up with hand shake (small steps).
   2. Every few frames, reference points are re-tracked into the current frame
      from the predicted pose: no accumulated drift, points replenished.
   3. When lost, ORB descriptors re-find the reference panel (rate limited),
      so recovery never blocks the OCR worker.
   Every step is RANSAC-checked; a bad pose stops collection. */
const OFFICIAL_OPENCV = 'https://docs.opencv.org/4.13.0/opencv.js';
let cvLoading;
function injectOpenCV(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src;
    const timer = setTimeout(() => { script.remove(); reject(Error('OpenCV 載入逾時，請確認網路後重試。')); }, 90000);
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(Error('OpenCV 載入失敗。')); };
    script.onload = async () => {
      try {
        const api = globalThis.cv;
        if (!api.Mat) await new Promise(done => { const previous = api.onRuntimeInitialized; api.onRuntimeInitialized = () => { previous?.(); done(); }; });
        // Emscripten's legacy then() resolves to itself; Promise assimilation loops.
        delete api.then;
        clearTimeout(timer); resolve(api);
      } catch (error) { clearTimeout(timer); reject(error); }
    };
    document.head.append(script);
  });
}
export function loadVision() {
  if (!cvLoading) cvLoading = (async () => {
    if (globalThis.cv?.Mat) return globalThis.cv;
    const local = globalThis.OPENCV_SCRIPT_URL || new URL('./vendor/opencv-4.13.0.js', globalThis.OCR_ASSET_BASE || location.href).href;
    try { return await injectOpenCV(local); }
    catch (error) { if (local === OFFICIAL_OPENCV) throw error; return injectOpenCV(OFFICIAL_OPENCV); }
  })().catch(error => { cvLoading = null; throw error; });
  return cvLoading;
}

export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function projectPoint(h, x, y) {
  const z = h[6] * x + h[7] * y + h[8];
  return {x: (h[0] * x + h[1] * y + h[2]) / z, y: (h[3] * x + h[4] * y + h[5]) / z};
}
export function roiPolygon(roi, h = IDENTITY) {
  return [[roi.x, roi.y], [roi.x + roi.w, roi.y], [roi.x + roi.w, roi.y + roi.h], [roi.x, roi.y + roi.h]].map(([x, y]) => projectPoint(h, x, y));
}
export function multiply(a, b) {
  const r = Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
function solve(matrix, values) {
  const n = values.length, a = matrix.map((row, i) => [...row, values[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const v = a[col][col]; for (let k = col; k <= n; k++) a[col][k] /= v;
    for (let row = 0; row < n; row++) if (row !== col) { const f = a[row][col]; for (let k = col; k <= n; k++) a[row][k] -= f * a[col][k]; }
  }
  return a.map(row => row[n]);
}
export function fitHomography(pairs) {
  const matrix = Array.from({length: 8}, () => Array(8).fill(0)), values = Array(8).fill(0);
  for (const {x, y, u, v} of pairs)
    for (const [row, target] of [[[x, y, 1, 0, 0, 0, -u * x, -u * y], u], [[0, 0, 0, x, y, 1, -v * x, -v * y], v]])
      for (let i = 0; i < 8; i++) { values[i] += row[i] * target; for (let j = 0; j < 8; j++) matrix[i][j] += row[i] * row[j]; }
  const h = solve(matrix, values); return h && [...h, 1];
}
export function fitAffine(pairs) {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bu = [0, 0, 0], bv = [0, 0, 0];
  for (const {x, y, u, v} of pairs) { const r = [x, y, 1]; for (let i = 0; i < 3; i++) { bu[i] += r[i] * u; bv[i] += r[i] * v; for (let j = 0; j < 3; j++) m[i][j] += r[i] * r[j]; } }
  const a = solve(m, bu), b = solve(m, bv);
  return a && b ? [a[0], a[1], a[2], b[0], b[1], b[2], 0, 0, 1] : null;
}
function random(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
/* RANSAC in normalized coordinates, residuals in pixels (sx, sy). Clustered or
   few points use an affine model, which is stabler than a full homography. */
export function ransac(pairs, {sx = 1, sy = 1, threshold = 3, rounds = 160, seed = 7} = {}) {
  if (pairs.length < 6) return null;
  // 10th–90th percentile extent, so a few outliers do not look like good spread.
  const range = values => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length * .9)] - s[Math.floor(s.length * .1)]; };
  const spread = range(pairs.map(p => p.x)) * range(pairs.map(p => p.y));
  const affine = pairs.length < 15 || spread < .01, fit = affine ? fitAffine : fitHomography, k = affine ? 3 : 4;
  const residual = (h, p) => { const q = projectPoint(h, p.x, p.y); return Math.hypot((q.x - p.u) * sx, (q.y - p.v) * sy); };
  const next = random(seed); let best = null;
  for (let round = 0; round < rounds; round++) {
    const chosen = new Set(); while (chosen.size < k) chosen.add(Math.floor(next() * pairs.length));
    const h = fit([...chosen].map(i => pairs[i])); if (!h || !h.every(Number.isFinite)) continue;
    const inliers = pairs.filter(p => residual(h, p) < threshold);
    if (!best || inliers.length > best.length) best = inliers;
    if (best.length === pairs.length) break;
  }
  if (!best || best.length < k + 2) return null;
  let h = fit(best); if (!h) return null;
  const inliers = pairs.filter(p => residual(h, p) < threshold);
  if (inliers.length >= best.length) h = fit(inliers) || h;
  const final = pairs.filter(p => residual(h, p) < threshold);
  const rms = Math.sqrt(final.reduce((s, p) => s + residual(h, p) ** 2, 0) / Math.max(1, final.length));
  return {h, inliers: final.length, ratio: final.length / pairs.length, rms, points: final, model: affine ? 'affine' : 'homography'};
}

export class PanelTracker {
  constructor({cv = null, width = 640, clock = () => performance.now()} = {}) { this.cv = cv; this.width = width; this.clock = clock; this.refPts = []; this.active = []; }
  async initialize() { this.cv = this.cv || await loadVision(); }
  reset() {
    for (const mat of [...(this.refPyr || []), ...(this.prevPyr || []), this.orb?.desc]) mat?.delete();
    this.refPyr = this.prevPyr = this.orb = this.H = this.last = null; this.refPts = []; this.active = []; this.rois = []; this.lastOrb = -Infinity;
  }
  toGray(frame) {
    const cv = this.cv, fw = frame.videoWidth || frame.width, fh = frame.videoHeight || frame.height;
    const w = Math.min(this.width, fw), h = Math.round(fh / fw * w);
    const canvas = this.canvas ||= document.createElement('canvas');
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    canvas.getContext('2d', {willReadFrequently: true}).drawImage(frame, 0, 0, w, h);
    const src = cv.imread(canvas), gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY); src.delete();
    return gray;
  }
  setReference(frame, rois) { const gray = this.toGray(frame); try { return this.setReferenceGray(gray, rois); } finally { gray.delete(); } }
  setReferenceGray(gray, rois) {
    this.reset(); const cv = this.cv, W = gray.cols, H = gray.rows;
    this.refPyr = this.pyramid(gray); this.rois = rois.map(r => ({...r})); this.W = W; this.H0 = H;
    // Anchor to the instrument face around the ROIs; far background moves with parallax.
    const mask = cv.Mat.zeros(H, W, cv.CV_8UC1);
    for (const r of rois) {
      const m = Math.max(r.w * W, r.h * H) * .6 + 30;
      cv.rectangle(mask, new cv.Point(Math.max(0, r.x * W - m), Math.max(0, r.y * H - m)), new cv.Point(Math.min(W, (r.x + r.w) * W + m), Math.min(H, (r.y + r.h) * H + m)), new cv.Scalar(255), -1);
    }
    let points = this.features(gray, mask); mask.delete();
    if (points.length < 20) points = this.features(gray, null);
    if (points.length < 12) { this.reset(); throw Error('Tracking：面板特徵不足。請讓面板邊緣、標籤或按鍵入鏡，或在固定手機後選擇固定模式。'); }
    this.refPts = points; this.active = points.map(p => ({ref: p, cur: p}));
    this.prevPyr = this.pyramid(gray); this.H = IDENTITY; this.sinceRefresh = 0;
    try {
      const orb = new cv.ORB(600), keypoints = new cv.KeyPointVector(), desc = new cv.Mat(), none = new cv.Mat();
      orb.detectAndCompute(gray, none, keypoints, desc);
      this.orb = {points: Array.from({length: keypoints.size()}, (_, i) => keypoints.get(i).pt).map(p => ({x: p.x, y: p.y})), desc};
      orb.delete(); keypoints.delete(); none.delete();
      if (this.orb.points.length < 15) { this.orb.desc.delete(); this.orb = null; }
    } catch { this.orb = null; }
    return points.length;
  }
  features(gray, mask) {
    const cv = this.cv, corners = new cv.Mat(), none = new cv.Mat();
    cv.goodFeaturesToTrack(gray, corners, 200, .01, 7, mask || none, 5, false, .04);
    const points = Array.from({length: corners.rows}, (_, i) => ({x: corners.data32F[i * 2], y: corners.data32F[i * 2 + 1]}));
    corners.delete(); none.delete(); return points;
  }
  pyramid(gray) {
    const levels = [gray.clone()];
    for (let i = 0; i < 3 && levels.at(-1).cols >= 80; i++) { const down = new this.cv.Mat(); this.cv.pyrDown(levels.at(-1), down); levels.push(down); }
    return levels;
  }
  /* Coarse-to-fine LK built from single-level calls. The opencv.js 4.13
     calcOpticalFlowPyrLK with maxLevel > 0 returns wrong points (even for two
     identical frames), so the pyramid is walked here. */
  lucasKanade(from, to, points, initial) {
    const cv = this.cv, n = points.length, top = Math.min(from.length, to.length) - 1;
    const size = new cv.Size(21, 21), criteria = new cv.TermCriteria(cv.TermCriteria_COUNT | cv.TermCriteria_EPS, 30, .01);
    let guess = (initial || points).map(p => ({x: p.x / 2 ** top, y: p.y / 2 ** top})), status = [];
    for (let level = top; level >= 0; level--) {
      const s = 2 ** level, p0 = cv.matFromArray(n, 1, cv.CV_32FC2, points.flatMap(p => [p.x / s, p.y / s]));
      const p1 = cv.matFromArray(n, 1, cv.CV_32FC2, guess.flatMap(p => [p.x, p.y])), st = new cv.Mat(), err = new cv.Mat();
      try {
        cv.calcOpticalFlowPyrLK(from[level], to[level], p0, p1, st, err, size, 0, criteria, cv.OPTFLOW_USE_INITIAL_FLOW);
        const next = guess.map((g, i) => st.data[i] ? {x: p1.data32F[i * 2], y: p1.data32F[i * 2 + 1]} : g);
        status = [...st.data];
        guess = level ? next.map(p => ({x: p.x * 2, y: p.y * 2})) : next;
      } finally { [p0, p1, st, err].forEach(m => m.delete()); }
    }
    return {points: guess, status};
  }
  /* Forward-backward checked flow between two pyramids; null for lost points. */
  flow(from, to, points, initial, limit) {
    const forward = this.lucasKanade(from, to, points, initial), backward = this.lucasKanade(to, from, forward.points, points);
    const W = to[0].cols, H = to[0].rows;
    return forward.points.map((q, i) => forward.status[i] && backward.status[i] && Math.hypot(points[i].x - backward.points[i].x, points[i].y - backward.points[i].y) < limit &&
      q.x >= 0 && q.y >= 0 && q.x < W && q.y < H ? q : null);
  }
  estimate(refs, moved, threshold = 3) {
    const W = this.W, H = this.H0, pairs = [];
    refs.forEach((r, i) => { if (moved[i]) pairs.push({x: r.x / W, y: r.y / H, u: moved[i].x / W, v: moved[i].y / H}); });
    const result = ransac(pairs, {sx: W, sy: H, threshold});
    if (result) result.active = result.points.map(p => ({ref: {x: p.x * W, y: p.y * H}, cur: {x: p.u * W, y: p.v * H}}));
    return result;
  }
  fromReference(cur, guess) {
    const initial = this.refPts.map(p => { const q = projectPoint(guess, p.x / this.W, p.y / this.H0); return {x: q.x * this.W, y: q.y * this.H0}; });
    return this.estimate(this.refPts, this.flow(this.refPyr, cur, this.refPts, initial, 1.5));
  }
  orbMatch(cur) {
    const cv = this.cv, orb = new cv.ORB(600), keypoints = new cv.KeyPointVector(), desc = new cv.Mat(), none = new cv.Mat();
    const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false), matches = new cv.DMatchVectorVector();
    try {
      orb.detectAndCompute(cur, none, keypoints, desc);
      if (keypoints.size() < 15) return null;
      matcher.knnMatch(this.orb.desc, desc, matches, 2);
      const refs = [], moved = [];
      for (let i = 0; i < matches.size(); i++) {
        const m = matches.get(i);
        if (m.size() >= 2 && m.get(0).distance < .8 * m.get(1).distance) { refs.push(this.orb.points[m.get(0).queryIdx]); const p = keypoints.get(m.get(0).trainIdx).pt; moved.push({x: p.x, y: p.y}); }
      }
      return this.estimate(refs, moved, 4);
    } finally { [orb, keypoints, desc, none, matcher, matches].forEach(m => m.delete()); }
  }
  confidence(est) { return est ? .5 * est.ratio + .5 * Math.min(1, est.inliers / 30) : 0; }
  acceptable(est, minimum = 12) { return Boolean(est && est.inliers >= minimum && est.ratio >= .5 && this.confidence(est) >= .6); }
  geometryProblem(h) {
    const c = roiPolygon({x: 0, y: 0, w: 1, h: 1}, h).map(p => ({x: p.x * this.W, y: p.y * this.H0}));
    const area = Math.abs(c.reduce((s, p, i) => { const q = c[(i + 1) % 4]; return s + p.x * q.y - p.y * q.x; }, 0) / 2) / (this.W * this.H0);
    if (!(area >= .3 && area <= 3.5)) return '距離變化過大，已停收';
    const turns = c.map((p, i) => { const q = c[(i + 1) % 4], r = c[(i + 2) % 4]; return Math.sign((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x)); });
    if (new Set(turns).size !== 1) return '畫面扭曲，已停收';
    if (Math.abs(Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x)) > .7) return '旋轉過大，已停收';
    for (const r of this.rois) {
      const p = roiPolygon(r, h);
      if (p.some(q => !Number.isFinite(q.x) || q.x < -.002 || q.y < -.002 || q.x > 1.002 || q.y > 1.002)) return 'ROI 離開畫面，已停收';
      const top = Math.hypot((p[1].x - p[0].x) * this.W, (p[1].y - p[0].y) * this.H0) / (r.w * this.W);
      const side = Math.hypot((p[3].x - p[0].x) * this.W, (p[3].y - p[0].y) * this.H0) / (r.h * this.H0);
      if (top / side < .6 || top / side > 1.6) return '傾斜過大，已停收';
    }
    return null;
  }
  track(frame) { const gray = this.toGray(frame); try { return this.trackGray(gray); } finally { gray.delete(); } }
  trackGray(gray) {
    if (!this.refPyr) return {ok: false, confidence: 0, reason: '尚未建立參考畫面'};
    const now = this.clock(), cur = this.pyramid(gray); let est = null, mode = null;
    if (this.prevPyr && this.active.length >= 8) {
      est = this.estimate(this.active.map(a => a.ref), this.flow(this.prevPyr, cur, this.active.map(a => a.cur), null, 1));
      mode = 'flow'; if (!this.acceptable(est)) est = null;
    }
    this.sinceRefresh++;
    if (!est || this.sinceRefresh >= 8 || est.inliers < .5 * this.refPts.length) {
      const refined = this.fromReference(cur, est?.h || this.H);
      if (this.acceptable(refined) && (!est || refined.inliers >= .8 * est.inliers)) { est = refined; mode = 'reference'; this.sinceRefresh = 0; }
    }
    if (!est && this.orb && now - this.lastOrb >= 400) {
      this.lastOrb = now;
      const found = this.orbMatch(gray);
      if (this.acceptable(found, 15)) {
        const refined = this.fromReference(cur, found.h);
        est = this.acceptable(refined) ? refined : found; mode = 'relocated'; this.sinceRefresh = 0;
      }
    }
    const problem = est ? this.geometryProblem(est.h) : null;
    this.prevPyr?.forEach(m => m.delete()); this.prevPyr = cur;
    if (!est || problem) {
      this.active = [];
      return this.last = {ok: false, confidence: this.confidence(est), reason: problem || '追蹤特徵遺失／模糊，已停收', mode};
    }
    this.H = est.h; this.active = est.active;
    return this.last = {ok: true, h: est.h, confidence: this.confidence(est), inliers: est.inliers, rms: est.rms, mode, model: est.model};
  }
  relocate(frame) { return this.track(frame); }
  /* Full-frame inverse warp (kept for the OCR lab page). */
  align(frame, result) {
    if (!result.ok) throw Error('Tracking：' + result.reason);
    const cv = this.cv, src = cv.imread(frame), dst = new cv.Mat(), h = result.h, w = frame.width, ht = frame.height;
    const matrix = cv.matFromArray(3, 3, cv.CV_64F, [h[0], h[1] * w / ht, h[2] * w, h[3] * ht / w, h[4], h[5] * ht, h[6] / w, h[7] / ht, h[8]]);
    try {
      cv.warpPerspective(src, dst, matrix, new cv.Size(w, ht), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
      const output = document.createElement('canvas'); cv.imshow(output, dst); return output;
    } finally { src.delete(); dst.delete(); matrix.delete(); }
  }
  crop(frame, roi, result, options) { return alignedCrop(frame, roi, result?.ok ? result.h : IDENTITY, {...options, cv: this.cv}); }
}

/* Padded ROI in reference coordinates at full camera resolution. Only the
   ROI's neighborhood is warped (not the whole frame). inner = the user's ROI
   inside the padded crop, in crop pixels. */
export function alignedCrop(frame, roi, h = IDENTITY, {pad = .25, maxWidth = 1200, cv = globalThis.cv} = {}) {
  const fw = frame.videoWidth || frame.width, fh = frame.videoHeight || frame.height;
  const px = Math.max(roi.w * pad, 8 / fw), py = Math.max(roi.h * pad, 8 / fh);
  const e = {x: roi.x - px, y: roi.y - py, w: roi.w + 2 * px, h: roi.h + 2 * py};
  const scale = Math.min(1, maxWidth / (e.w * fw)), outW = Math.max(8, Math.round(e.w * fw * scale)), outH = Math.max(8, Math.round(e.h * fh * scale));
  const inner = {x: px / e.w * outW, y: py / e.h * outH, w: roi.w / e.w * outW, h: roi.h / e.h * outH};
  const canvas = document.createElement('canvas'); canvas.width = outW; canvas.height = outH;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (h.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9)) {
    context.fillStyle = 'white'; context.fillRect(0, 0, outW, outH);
    const sx = Math.max(0, e.x * fw), sy = Math.max(0, e.y * fh), ex = Math.min(fw, (e.x + e.w) * fw), ey = Math.min(fh, (e.y + e.h) * fh);
    context.drawImage(frame, sx, sy, ex - sx, ey - sy, (sx / fw - e.x) / e.w * outW, (sy / fh - e.y) / e.h * outH, (ex - sx) / fw / e.w * outW, (ey - sy) / fh / e.h * outH);
    return {canvas, inner, h, region: e};
  }
  const polygon = roiPolygon(e, h).map(p => ({x: p.x * fw, y: p.y * fh}));
  const bx = Math.max(0, Math.floor(Math.min(...polygon.map(p => p.x)) - 2)), by = Math.max(0, Math.floor(Math.min(...polygon.map(p => p.y)) - 2));
  const bw = Math.min(fw, Math.ceil(Math.max(...polygon.map(p => p.x)) + 2)) - bx, bh = Math.min(fh, Math.ceil(Math.max(...polygon.map(p => p.y)) + 2)) - by;
  if (bw < 4 || bh < 4) throw Error('Tracking：ROI 離開畫面');
  const region = document.createElement('canvas'); region.width = bw; region.height = bh;
  region.getContext('2d').drawImage(frame, bx, by, bw, bh, 0, 0, bw, bh);
  // Output pixel → reference normalized → current normalized → region pixel.
  const m = multiply([1, 0, -bx, 0, 1, -by, 0, 0, 1], multiply([fw, 0, 0, 0, fh, 0, 0, 0, 1], multiply(h, [e.w / outW, 0, e.x, 0, e.h / outH, e.y, 0, 0, 1])));
  const src = cv.imread(region), dst = new cv.Mat(), matrix = cv.matFromArray(3, 3, cv.CV_64F, m);
  try {
    cv.warpPerspective(src, dst, matrix, new cv.Size(outW, outH), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_REPLICATE);
    cv.imshow(canvas, dst);
  } finally { src.delete(); dst.delete(); matrix.delete(); }
  return {canvas, inner, h, region: e};
}

/* Gradient energy of a region, for picking the sharpest of several frames. */
export function sharpness(frame, polygon) {
  const fw = frame.videoWidth || frame.width, fh = frame.videoHeight || frame.height;
  const x0 = Math.max(0, Math.min(...polygon.map(p => p.x)) * fw), y0 = Math.max(0, Math.min(...polygon.map(p => p.y)) * fh);
  const x1 = Math.min(fw, Math.max(...polygon.map(p => p.x)) * fw), y1 = Math.min(fh, Math.max(...polygon.map(p => p.y)) * fh);
  if (x1 - x0 < 4 || y1 - y0 < 4) return 0;
  const w = Math.min(160, Math.round(x1 - x0)), h = Math.max(4, Math.round((y1 - y0) * w / (x1 - x0)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', {willReadFrequently: true}); g.drawImage(frame, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, lum = i => d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2];
  let energy = 0;
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) { const i = y * w + x; energy += Math.abs(lum(i + 1) - lum(i)) + Math.abs(lum(i + w) - lum(i)); }
  return energy / (w * h);
}
