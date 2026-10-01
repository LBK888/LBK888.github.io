/* Text-box geometry for PP-OCR detection maps. Pure functions, no DOM. */

/* PaddleOCR DB post-process: threshold the probability map, score each region
   over its box, then "unclip" the shrunk text kernel by area*ratio/perimeter
   (official PP-OCRv5 det: thresh .3, box_thresh .6, unclip_ratio 1.5).
   Without unclip, boxes cut off the outer part of every glyph. */
export function dbBoxes(prob, width, height, {thresh = .3, boxThresh = .6, unclip = 1.5, minSize = 3} = {}) {
  const seen = new Uint8Array(width * height), stack = new Int32Array(width * height), boxes = [];
  for (let i = 0; i < width * height; i++) {
    if (seen[i] || prob[i] <= thresh) continue;
    let top = 0, x0 = width, y0 = height, x1 = -1, y1 = -1;
    stack[top++] = i; seen[i] = 1;
    while (top) {
      const j = stack[--top], x = j % width, y = (j - x) / width;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const k of [x > 0 ? j - 1 : -1, x + 1 < width ? j + 1 : -1, y > 0 ? j - width : -1, y + 1 < height ? j + width : -1])
        if (k >= 0 && !seen[k] && prob[k] > thresh) { seen[k] = 1; stack[top++] = k; }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (Math.min(w, h) < minSize) continue;
    let sum = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) sum += prob[y * width + x];
    if (sum / (w * h) < boxThresh) continue;
    const d = w * h * unclip / (2 * (w + h)), bx = Math.max(0, x0 - d), by = Math.max(0, y0 - d);
    boxes.push({x: bx, y: by, w: Math.min(width, x1 + 1 + d) - bx, h: Math.min(height, y1 + 1 + d) - by, score: sum / (w * h)});
  }
  return boxes;
}

const vOverlap = (a, b) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
const hGap = (a, b) => Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
const union = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return {x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y, score: Math.max(a.score || 0, b.score || 0)};
};

/* Join pieces of one printed line: split seven-segment digits, a value and
   its same-size % sign. Smaller labels/units stay separate. */
export function mergeLines(boxes, {gap = .6, ratio = 1.6} = {}) {
  let lines = boxes.map(b => ({...b}));
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      if (Math.max(a.h, b.h) / Math.min(a.h, b.h) > ratio) continue;
      if (vOverlap(a, b) < .5 * Math.min(a.h, b.h) || hGap(a, b) > gap * Math.max(a.h, b.h)) continue;
      lines[i] = union(a, b); lines.splice(j, 1); merged = true; break outer;
    }
  }
  return lines;
}

/* Lines that belong to a user ROI (inner rectangle of a padded crop),
   tallest text first. Padding only protects against truncation. */
export function linesInRegion(lines, inner) {
  return lines.filter(l => {
    const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
    const ix = Math.max(0, Math.min(l.x + l.w, inner.x + inner.w) - Math.max(l.x, inner.x));
    const iy = Math.max(0, Math.min(l.y + l.h, inner.y + inner.h) - Math.max(l.y, inner.y));
    const centered = cx >= inner.x - .05 * inner.w && cx <= inner.x + 1.05 * inner.w && cy >= inner.y - .1 * inner.h && cy <= inner.y + 1.1 * inner.h;
    return centered || ix * iy >= .5 * l.w * l.h;
  }).sort((a, b) => b.h - a.h);
}

/* Inside one ROI, same-row text of similar size is one reading even with
   wide gaps (monospace "7 . 8 2", split seven-segment digits). */
export function rowOf(line, lines) {
  return lines.filter(l => l === line || (vOverlap(line, l) >= .5 * Math.min(line.h, l.h) && Math.max(line.h, l.h) / Math.min(line.h, l.h) <= 1.8))
    .reduce((a, b) => union(a, b), line);
}

/* Labels/units around a value: same row (left/right), just above, just below.
   Nearest first; used for pH / DO / °C type recognition. */
export function nearbyLabels(value, labels) {
  const h = value.h, found = [];
  for (const l of labels) {
    if (l === value) continue;
    const gapX = hGap(value, l), cx = l.x + l.w / 2;
    const aligned = cx > value.x - .5 * value.w && cx < value.x + 1.5 * value.w;
    let distance = null;
    if (vOverlap(value, l) >= .3 * Math.min(h, l.h) && gapX <= 3 * h) distance = Math.max(0, gapX);
    else if (aligned && l.y + l.h <= value.y + .25 * h && value.y - (l.y + l.h) <= 1.5 * h) distance = value.y - (l.y + l.h) + .5 * h;
    else if (aligned && l.y >= value.y + .75 * h && l.y - (value.y + h) <= h) distance = l.y - (value.y + h) + h;
    if (distance !== null) found.push({label: l, distance});
  }
  return found.sort((a, b) => a.distance - b.distance).map(x => x.label);
}
