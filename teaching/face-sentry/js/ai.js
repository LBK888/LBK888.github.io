const MODEL_SIZE = 320;
const TEMPLATE = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

export function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}

export function normalize(values) {
  const norm = Math.hypot(...values);
  return norm ? values.map(value => value / norm) : values.slice();
}

export function meanEmbedding(samples) {
  const mean = Array(samples[0].length).fill(0);
  for (const sample of samples) sample.forEach((value, i) => { mean[i] += value; });
  return normalize(mean.map(value => value / samples.length));
}

export function bestMatch(embedding, persons, threshold) {
  let match = null, similarity = -1;
  for (const person of persons) {
    const score = cosine(embedding, person.embedding);
    if (score > similarity) { match = person; similarity = score; }
  }
  return { person: similarity >= threshold ? match : null, similarity };
}

export function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  return overlap / (areaA + areaB - overlap || 1);
}

export function decodeYuNet(outputs, width, height, threshold) {
  const candidates = [];
  for (const stride of [8, 16, 32]) {
    const cols = MODEL_SIZE / stride;
    const cls = outputs[`cls_${stride}`].data, obj = outputs[`obj_${stride}`].data;
    const bbox = outputs[`bbox_${stride}`].data, kps = outputs[`kps_${stride}`].data;
    for (let index = 0; index < cls.length; index++) {
      const score = Math.sqrt(Math.max(0, Math.min(1, cls[index])) * Math.max(0, Math.min(1, obj[index])));
      if (score < threshold) continue;
      const c = index % cols, r = Math.floor(index / cols);
      const cx = (c + bbox[index * 4]) * stride, cy = (r + bbox[index * 4 + 1]) * stride;
      const w = Math.exp(bbox[index * 4 + 2]) * stride, h = Math.exp(bbox[index * 4 + 3]) * stride;
      const sx = width / MODEL_SIZE, sy = height / MODEL_SIZE;
      const landmarks = Array.from({ length: 5 }, (_, j) => [
        (kps[index * 10 + j * 2] + c) * stride * sx,
        (kps[index * 10 + j * 2 + 1] + r) * stride * sy
      ]);
      candidates.push({ bbox: [(cx - w / 2) * sx, (cy - h / 2) * sy, (cx + w / 2) * sx, (cy + h / 2) * sy], landmarks, detectionScore: score });
    }
  }
  candidates.sort((a, b) => b.detectionScore - a.detectionScore);
  const kept = [];
  for (const face of candidates.slice(0, 150)) {
    if (kept.every(other => iou(face.bbox, other.bbox) < 0.3)) kept.push(face);
    if (kept.length >= 8) break;
  }
  return kept;
}

function similarityTransform(points) {
  const mean = arr => arr.reduce((sum, p) => [sum[0] + p[0] / arr.length, sum[1] + p[1] / arr.length], [0, 0]);
  const srcMean = mean(points), dstMean = mean(TEMPLATE);
  let a = 0, b = 0, denom = 0;
  for (let i = 0; i < 5; i++) {
    const x = points[i][0] - srcMean[0], y = points[i][1] - srcMean[1];
    const u = TEMPLATE[i][0] - dstMean[0], v = TEMPLATE[i][1] - dstMean[1];
    a += x * u + y * v;
    b += x * v - y * u;
    denom += x * x + y * y;
  }
  a /= denom; b /= denom;
  return [a, -b, dstMean[0] - a * srcMean[0] + b * srcMean[1], b, a, dstMean[1] - b * srcMean[0] - a * srcMean[1]];
}

export function alignedCanvas(video, face) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 112;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const [a, b, tx, c, d, ty] = similarityTransform(face.landmarks);
  ctx.setTransform(a, c, b, d, tx, ty);
  ctx.drawImage(video, 0, 0);
  ctx.resetTransform();
  return canvas;
}

export function qualityOkay(canvas, face) {
  const width = face.bbox[2] - face.bbox[0];
  const eyeRise = Math.abs(face.landmarks[0][1] - face.landmarks[1][1]);
  const eyeSpan = Math.abs(face.landmarks[0][0] - face.landmarks[1][0]);
  if (width < 72 || face.detectionScore < 0.75 || eyeSpan < 12 || eyeRise / eyeSpan > 0.35) return false;
  const data = canvas.getContext('2d').getImageData(0, 0, 112, 112).data;
  let sum = 0, sum2 = 0, count = 0;
  for (let y = 2; y < 110; y += 3) for (let x = 2; x < 110; x += 3) {
    const lum = (ix, iy) => { const p = (iy * 112 + ix) * 4; return (data[p] + data[p + 1] + data[p + 2]) / 3; };
    const lap = 4 * lum(x, y) - lum(x - 1, y) - lum(x + 1, y) - lum(x, y - 1) - lum(x, y + 1);
    sum += lap; sum2 += lap * lap; count++;
  }
  return sum2 / count - (sum / count) ** 2 > 20;
}

export class FaceAI {
  constructor() { this.backend = '未載入'; this.detectorMs = 0; this.recognizerMs = 0; }

  async init(onStatus = () => {}) {
    onStatus('載入 ONNX Runtime');
    this.ort = globalThis.ort;
    if (!this.ort?.InferenceSession) throw new Error('ONNX Runtime 未載入');
    this.ort.env.wasm.wasmPaths = new URL('../vendor/onnxruntime/', import.meta.url).href;
    this.ort.env.wasm.numThreads = 1;
    const options = { graphOptimizationLevel: 'all' };
    const hasGpu = !!navigator.gpu;
    for (const provider of hasGpu ? ['webgpu', 'wasm'] : ['wasm']) {
      try {
        await this.loadProvider(provider, options, onStatus);
        return;
      } catch (error) {
        this.detector?.release(); this.recognizer?.release();
        this.detector = this.recognizer = null;
        if (provider === 'wasm') throw error;
      }
    }
  }

  async loadProvider(provider, options = { graphOptimizationLevel: 'all' }, onStatus = () => {}) {
    onStatus(`載入 YuNet / SFace (${provider.toUpperCase()})`);
    await this.detector?.release(); await this.recognizer?.release();
    this.detector = this.recognizer = null;
    this.detector = await this.ort.InferenceSession.create(new URL('../models/face_detector.onnx', import.meta.url).href, { ...options, executionProviders: [provider] });
    this.recognizer = await this.ort.InferenceSession.create(new URL('../models/face_recognizer.onnx', import.meta.url).href, { ...options, executionProviders: [provider] });
    this.backend = provider === 'webgpu' ? 'WebGPU' : 'WASM';
  }

  async detect(video, threshold) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = MODEL_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, MODEL_SIZE, MODEL_SIZE);
    const pixels = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
    const plane = MODEL_SIZE * MODEL_SIZE, input = new Float32Array(plane * 3);
    for (let i = 0; i < plane; i++) {
      input[i] = pixels[i * 4 + 2]; input[plane + i] = pixels[i * 4 + 1]; input[plane * 2 + i] = pixels[i * 4];
    }
    const start = performance.now();
    const outputs = await this.detector.run({ input: new this.ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]) });
    this.detectorMs = performance.now() - start;
    return decodeYuNet(outputs, video.videoWidth, video.videoHeight, threshold);
  }

  async recognize(video, face) {
    const canvas = alignedCanvas(video, face);
    const pixels = canvas.getContext('2d').getImageData(0, 0, 112, 112).data;
    const plane = 112 * 112, input = new Float32Array(plane * 3);
    for (let i = 0; i < plane; i++) {
      input[i] = pixels[i * 4]; input[plane + i] = pixels[i * 4 + 1]; input[plane * 2 + i] = pixels[i * 4 + 2];
    }
    const start = performance.now();
    const output = await this.recognizer.run({ data: new this.ort.Tensor('float32', input, [1, 3, 112, 112]) });
    this.recognizerMs = performance.now() - start;
    return { embedding: normalize(Array.from(output.fc1.data)), aligned: canvas };
  }
}
