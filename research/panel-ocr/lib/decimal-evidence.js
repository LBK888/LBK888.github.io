/* Independent geometry evidence for a decimal point. It never edits OCR text;
   assessReading() decides. Works on the processed line image (dark text on
   white). Digits are grouped into columns so split seven-segment strokes count
   as one digit; xRange limits the search to the number (excludes %, °C …). */
export function decimalComponents(canvas, {x0 = 0, x1 = Infinity} = {}) {
  const {width: w, height: h} = canvas, p = canvas.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, w, h).data;
  return decimalFromGray(Uint8Array.from({length: w * h}, (_, i) => Math.round(.299 * p[i * 4] + .587 * p[i * 4 + 1] + .114 * p[i * 4 + 2])), w, h, {x0, x1});
}

export function decimalFromGray(gray, w, h, {x0 = 0, x1 = Infinity} = {}) {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let sum = 0; for (let x = 0; x < w; x++) { sum += gray[y * w + x]; integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + sum; } }
  const foreground = new Uint8Array(w * h), radius = Math.max(7, Math.round(h * .3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = Math.max(0, x - radius), b = Math.min(w, x + radius + 1), c = Math.max(0, y - radius), d = Math.min(h, y + radius + 1);
    const mean = (integral[d * (w + 1) + b] - integral[c * (w + 1) + b] - integral[d * (w + 1) + a] + integral[c * (w + 1) + a]) / ((b - a) * (d - c));
    foreground[y * w + x] = gray[y * w + x] < mean - 10 ? 1 : 0;
  }
  const components = [], stack = [];
  for (let i = 0; i < foreground.length; i++) if (foreground[i]) {
    stack.push(i); foreground[i] = 0; let left = w, top = h, right = 0, bottom = 0, area = 0;
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j - x) / w; area++;
      if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const u = x + dx, v = y + dy;
        if (u >= 0 && v >= 0 && u < w && v < h && foreground[v * w + u]) { foreground[v * w + u] = 0; stack.push(v * w + u); }
      }
    }
    const cx = (left + right) / 2;
    if (area >= 3 && cx >= x0 && cx <= x1) components.push({left, top, right, bottom, area, width: right - left + 1, height: bottom - top + 1, cx, cy: (top + bottom) / 2});
  }
  const none = {reliable: false, hasPoint: false, points: [], columns: 0};
  const tallest = Math.max(0, ...components.map(c => c.height));
  if (tallest < 10) return none;
  // Strokes (vertical or horizontal segments) build digit columns; dots do not.
  const strokes = components.filter(c => c.height >= .3 * tallest || c.width >= .25 * tallest).sort((a, b) => a.left - b.left);
  const columns = [];
  for (const s of strokes) {
    const col = columns.find(k => Math.min(k.right, s.right) - Math.max(k.left, s.left) >= .3 * Math.min(k.right - k.left + 1, s.width));
    if (col) { col.left = Math.min(col.left, s.left); col.right = Math.max(col.right, s.right); col.top = Math.min(col.top, s.top); col.bottom = Math.max(col.bottom, s.bottom); col.parts.add(s); }
    else columns.push({left: s.left, right: s.right, top: s.top, bottom: s.bottom, parts: new Set([s])});
  }
  const highest = Math.max(...columns.map(k => k.bottom - k.top + 1));
  const digits = columns.filter(k => k.bottom - k.top + 1 >= .5 * highest).sort((a, b) => a.left - b.left);
  if (!digits.length) return none;
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const digitHeight = median(digits.map(k => k.bottom - k.top + 1)), baseline = median(digits.map(k => k.bottom));
  const used = new Set(digits.flatMap(k => [...k.parts]));
  const points = components.filter(c => !used.has(c) && c.height <= .25 * digitHeight && c.width <= .3 * digitHeight &&
    c.width / c.height >= .4 && c.width / c.height <= 2.5 && c.area >= .35 * c.width * c.height &&
    Math.abs(c.bottom - baseline) <= .2 * digitHeight &&
    digits.some((k, i) => digits[i + 1] && c.cx >= k.right - .15 * digitHeight && c.cx <= digits[i + 1].left + .15 * digitHeight));
  const point = points.length === 1 ? points[0] : null;
  return {reliable: digits.length >= 2 && digitHeight >= 10, hasPoint: Boolean(point),
    points: points.map(c => ({x: c.cx / w, y: c.cy / h})), columns: digits.length,
    digitsRight: point ? digits.filter(k => (k.left + k.right) / 2 > point.cx).length : null,
    digitHeight, baseline};
}
