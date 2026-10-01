/* Official PP-OCRv5 ONNX models. Inference stays in a dedicated device worker. */
importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.js');
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
ort.env.wasm.numThreads = 1; // Works without cross-origin isolation, including iOS.
ort.env.logLevel = 'error';
let recognition, detection, characters, numericIndices, dotIndices;
// Official PP-OCRv5 ONNX packages: fallback when models/*.onnx are not deployed next to the page.
const OFFICIAL_MODELS = {
  det: {model: 'PP-OCRv5_mobile_det', source: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar', sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d', bytes: 4826518},
  rec: {model: 'en_PP-OCRv5_mobile_rec', source: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/en_PP-OCRv5_mobile_rec_onnx_infer.tar', sha256: 'b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f', bytes: 7848423},
};
function progress(status, value = 0) { self.postMessage({type: 'progress', status, progress: value}); }

// IndexedDB is optional (private mode/quota restrictions must not block OCR).
function modelCache(key, value) {
  return new Promise(resolve => {
    let db, settled = false;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); db?.close(); resolve(result); };
    const timer = setTimeout(() => finish(null), 3000);
    try {
      if (!self.indexedDB) { finish(null); return; }
      const open = indexedDB.open('read-predict-ocr-models-v1', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('models');
      open.onerror = open.onblocked = () => finish(null);
      open.onsuccess = () => {
        db = open.result;
        if (settled) { db.close(); return; }
        try {
          const transaction = db.transaction('models', value ? 'readwrite' : 'readonly');
          const store = transaction.objectStore('models'), request = value ? store.put(value, key) : store.get(key);
          transaction.oncomplete = () => finish(value ? true : request.result || null);
          transaction.onerror = transaction.onabort = () => finish(null);
        } catch { finish(null); }
      };
    } catch { finish(null); }
  });
}

async function verifyModel(buffer, spec) {
  if (buffer.byteLength !== spec.bytes) throw Error(`${spec.model} 模型大小不符；請重新下載。`);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== spec.sha256) throw Error(`${spec.model} 模型驗證失敗；請重新下載。`);
  return buffer;
}

function unpackModel(archive) {
  const bytes = new Uint8Array(archive), decoder = new TextDecoder();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    const name = decoder.decode(header.subarray(0, 100)).split('\0')[0];
    if (!name) break;
    const sizeText = decoder.decode(header.subarray(124, 136)).replace(/\0/g, '').trim();
    if (!/^[0-7]+$/.test(sizeText)) throw Error('模型壓縮包格式不符。');
    const size = parseInt(sizeText, 8), start = offset + 512;
    if (!Number.isSafeInteger(size) || start + size > bytes.length) throw Error('模型下載不完整。');
    if (name.split('/').at(-1) === 'inference.onnx' && (header[156] === 0 || header[156] === 48))
      return archive.slice(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw Error('官方模型壓縮包缺少 inference.onnx。');
}

async function downloadModel(spec) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(spec.source, {mode: 'cors', credentials: 'omit', cache: 'force-cache', signal: controller.signal});
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader(), total = Number(response.headers.get('Content-Length'));
    let archive;
    if (reader) {
      const chunks = []; let received = 0;
      while (true) {
        const {done, value} = await reader.read(); if (done) break;
        received += value.byteLength;
        if (received > spec.bytes + 1024 * 1024) { await reader.cancel(); throw Error('模型壓縮包大小異常。'); }
        chunks.push(value);
        const amount = `${(received / 1048576).toFixed(1)} MB`;
        progress(`下載 ${spec.model}：${amount}${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}`, total ? received / total : 0);
      }
      const joined = new Uint8Array(received); let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
      archive = joined.buffer;
    } else archive = await response.arrayBuffer();
    progress(`驗證 ${spec.model}…`);
    return await verifyModel(unpackModel(archive), spec);
  } catch (error) {
    throw Error(`模型下載失敗：${spec.model}（${error.message}）。請確認手機可連線官方模型來源後重試。`);
  } finally { clearTimeout(timer); }
}

async function modelBytes(kind, root) {
  let spec = self.PADDLE_MODEL_ASSETS?.[kind];
  if (!spec) {
    try { return await (await asset(root + kind + '.onnx')).arrayBuffer(); }
    catch { spec = OFFICIAL_MODELS[kind]; progress(`本機模型不存在，改由官方來源下載 ${spec.model}…`); }
  }
  const key = spec.sha256, cached = await modelCache(key);
  if (cached) {
    try { const verified = await verifyModel(cached, spec); progress(`使用本機快取：${spec.model}`, 1); return verified; }
    catch { progress(`快取驗證失敗，重新下載 ${spec.model}…`); }
  }
  progress(`下載 ${spec.model}…`);
  const buffer = await downloadModel(spec);
  await modelCache(key, buffer);
  return buffer;
}
async function asset(url) {
  const response = await fetch(url + '?v=ppocrv5-en-20260930', {cache:'force-cache'});
  if (!response.ok) throw Error(`模型下載失敗 ${response.status}: ${url}`);
  return response;
}
function tensor(image, width, height, kind) {
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
  const source = new OffscreenCanvas(image.width, image.height);
  source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  const resizedWidth = kind === 'rec' ? Math.min(width, Math.ceil(height * image.width / image.height)) : width;
  context.drawImage(source, 0, 0, resizedWidth, height);
  const pixels = context.getImageData(0, 0, resizedWidth, height).data;
  const plane = width * height, values = new Float32Array(plane * 3);
  const mean = [.485, .456, .406], std = [.229, .224, .225];
  // Paddle DecodeImage uses BGR; recognition padding is normalized zero.
  for (let y = 0; y < height; y++) for (let x = 0; x < resizedWidth; x++) for (let ch = 0; ch < 3; ch++) {
    const v = pixels[(y * resizedWidth + x) * 4 + 2 - ch] / 255;
    values[ch * plane + y * width + x] = kind === 'rec' ? (v - .5) / .5 : (v - mean[ch]) / std[ch];
  }
  return new ort.Tensor('float32', values, [1, 3, height, width]);
}
async function infer(session, input) {
  const outputs = await session.run({[session.inputNames[0]]: input});
  return outputs[session.outputNames[0]];
}
self.onmessage = async ({data: {id, type, image, root}}) => {
  try {
    let result;
    if (type === 'init') {
      if (!recognition) {
        const [model, dictionary] = await Promise.all([modelBytes('rec', root), self.PADDLE_CHARACTER_LIST || asset(root + 'characters.json').then(response => response.json())]);
        characters = ['', ...dictionary, ' '];
        numericIndices=characters.flatMap((character,index)=>/^[0-9.,+\-−]$/.test(character)?[index]:[]);
        dotIndices=characters.flatMap((character,index)=>character==='.'||character===','?[index]:[]);
        recognition = await ort.InferenceSession.create(model, {executionProviders: ['wasm'], graphOptimizationLevel: 'all'});
      }
      result = {ready: true};
    } else if (type === 'rec') {
      const width = Math.max(320, Math.min(1536, Math.ceil(48 * image.width / image.height / 8) * 8));
      const output = await infer(recognition, tensor(image, width, 48, 'rec'));
      const classes = output.dims.at(-1), steps = output.data.length / classes;
      if (classes !== characters.length) throw Error(`模型字典不一致：${classes} / ${characters.length}`);
      // Per time step: overall best, best numeric alternative, blank and point
      // probabilities. reading-parser.js decodes the number, label and unit.
      const best = [], num = [], bestP = new Float32Array(steps), numP = new Float32Array(steps), blankP = new Float32Array(steps), dotP = new Float32Array(steps);
      for (let t = 0; t < steps; t++) {
        const row = t * classes; let index = 0, score = output.data[row], n = numericIndices[0];
        for (let k = 1; k < classes; k++) if (output.data[row + k] > score) { index = k; score = output.data[row + k]; }
        for (const k of numericIndices) if (output.data[row + k] > output.data[row + n]) n = k;
        best.push(index ? characters[index] : ''); bestP[t] = score; num.push(characters[n]); numP[t] = output.data[row + n];
        blankP[t] = output.data[row]; for (const k of dotIndices) dotP[t] = Math.max(dotP[t], output.data[row + k]);
      }
      result = {best, bestP, num, numP, blankP, dotP, tensorWidth: width, resizedWidth: Math.min(width, Math.ceil(48 * image.width / image.height))};
    } else if (type === 'det') {
      if (!detection) detection = await ort.InferenceSession.create(await modelBytes('det', root), {executionProviders: ['wasm'], graphOptimizationLevel: 'all'});
      // The caller scales the image (full frame: long side 960 as the official config).
      const width = Math.max(32, Math.round(image.width / 32) * 32), height = Math.max(32, Math.round(image.height / 32) * 32);
      const output = await infer(detection, tensor(image, width, height, 'det'));
      result = {width: output.dims.at(-1), height: output.dims.at(-2), probabilities: output.data};
    }
    self.postMessage({id, result});
  } catch (error) { self.postMessage({id, error: error.message}); }
};
