/* Shared browser OCR. Pixels stay on this device; only model assets are downloaded. */
import {decimalComponents} from './decimal-evidence.js';
import {decodeReading, inferType, decimalsOf} from './reading-parser.js';
import {dbBoxes, mergeLines, linesInRegion, nearbyLabels, rowOf} from './text-geometry.js';
export const OCR_VERSION = 'PP-OCRv5 mobile / ONNX WASM 1.22.0 · reader v3';
const SCRIPT = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
let library;
function loadLibrary() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  if (!library) library = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.onload = () => resolve(globalThis.Tesseract);
    script.onerror = () => { script.remove(); library = null; reject(Error('OCR 載入失敗，請確認網路可以連到 cdn.jsdelivr.net。')); };
    document.head.append(script);
  });
  return library;
}

export function prepareCrop(input, {mode = 'auto', height = 144, trim = true} = {}) {
  // Seven-segment digits are separate bars with gaps; the recogniser was trained on joined
  // strokes. Normalise like 'auto', then thicken dark strokes so the bars of a digit touch.
  if (mode === 'segment') return thickenStrokes(prepareCrop(input, {mode: 'auto', height, trim}), Math.max(1, Math.round(height * .022)));
  if (mode === 'auto') {
    const copy = document.createElement('canvas'); copy.width=input.width;copy.height=input.height;
    const c=copy.getContext('2d',{willReadFrequently:true});c.drawImage(input,0,0);
    const pixels=c.getImageData(0,0,copy.width,copy.height),hist=new Uint32Array(256),border=[];
    for(let y=0;y<copy.height;y++)for(let x=0;x<copy.width;x++){
      const i=(y*copy.width+x)*4,g=Math.round(.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2]);
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=g;hist[g]++;
      if(x<2||y<2||x>copy.width-3||y>copy.height-3)border.push(g);
    }
    border.sort((a,b)=>a-b);const dark=border[Math.floor(border.length/2)]<128;
    let low=0,high=255,count=0,total=copy.width*copy.height;
    for(let g=0;g<256;g++){count+=hist[g];if(count<total*.02)low=g;if(count<total*.98)high=g;}
    // Sparse digits may occupy less than 2% of a wide ROI. Do not collapse the
    // background to black when both percentiles land on the same flat color.
    if(high-low<32){let first=0,last=255;while(first<255&&!hist[first])first++;while(last>0&&!hist[last])last--;if(last-first>=32){low=first;high=last;}else{low=0;high=255;}}
    const range=Math.max(1,high-low),counts=new Uint32Array(256);
    for(let i=0;i<pixels.data.length;i+=4){let g=Math.max(0,Math.min(255,(pixels.data[i]-low)*255/range));if(dark)g=255-g;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=g;counts[Math.round(g)]++;}
    // Tighten only blank margins. Never remove isolated decimal components.
    const threshold=otsu(counts,total);let x0=copy.width,y0=copy.height,x1=-1,y1=-1;
    for(let y=2;y<copy.height-2;y++)for(let x=2;x<copy.width-2;x++)if(pixels.data[(y*copy.width+x)*4]<threshold){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    c.putImageData(pixels,0,0);
    if(trim&&x1>x0&&y1>y0){const pad=Math.max(3,Math.round((y1-y0)*.08));x0=Math.max(0,x0-pad);y0=Math.max(0,y0-pad);x1=Math.min(copy.width-1,x1+pad);y1=Math.min(copy.height-1,y1+pad);const tight=document.createElement('canvas');tight.width=x1-x0+1;tight.height=y1-y0+1;tight.getContext('2d').drawImage(copy,x0,y0,tight.width,tight.height,0,0,tight.width,tight.height);return prepareCrop(tight,{mode:'gray',height});}
    return prepareCrop(copy,{mode:'gray',height});
  }
  const scale = Math.min(height / input.height, 768 / input.width);
  const width = Math.max(8, Math.round(input.width * scale));
  const h = Math.max(8, Math.round(input.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width + 24; canvas.height = h + 24;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(input, 12, 12, width, h);
  if (mode === 'original') return canvas;
  const pixels = ctx.getImageData(12, 12, width, h), histogram = new Uint32Array(256);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = Math.round(.299 * pixels.data[i] + .587 * pixels.data[i + 1] + .114 * pixels.data[i + 2]);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
    histogram[gray]++;
  }
  if (mode === 'binary' || mode === 'invert') {
    const total = width * h;
    let sum = 0, left = 0, count = 0, best = -1, threshold = 128;
    for (let i = 0; i < 256; i++) sum += histogram[i] * i;
    for (let i = 0; i < 256; i++) {
      count += histogram[i]; left += histogram[i] * i;
      if (!count || count === total) continue;
      const delta = left / count - (sum - left) / (total - count);
      const variance = count * (total - count) * delta * delta;
      if (variance > best) { best = variance; threshold = i; }
    }
    for (let i = 0; i < pixels.data.length; i += 4) {
      let value = pixels.data[i] > threshold ? 255 : 0;
      if (mode === 'invert') value = 255 - value;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    }
  }
  ctx.putImageData(pixels, 12, 12);
  return canvas;
}

/* Separable minimum filter on a dark-text-on-white canvas: strokes grow by `radius` px. */
export function thickenStrokes(canvas, radius) {
  const ctx = canvas.getContext('2d', {willReadFrequently: true}), w = canvas.width, h = canvas.height;
  const image = ctx.getImageData(0, 0, w, h), gray = new Uint8ClampedArray(w * h), row = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = image.data[i * 4];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 255; for (let d = -radius; d <= radius; d++) { const u = Math.min(w - 1, Math.max(0, x + d)); m = Math.min(m, gray[y * w + u]); }
    row[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 255; for (let d = -radius; d <= radius; d++) { const v = Math.min(h - 1, Math.max(0, y + d)); m = Math.min(m, row[v * w + x]); }
    const i = (y * w + x) * 4; image.data[i] = image.data[i + 1] = image.data[i + 2] = m;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function otsu(histogram,total){let sum=0,left=0,count=0,best=-1,threshold=128;for(let i=0;i<256;i++)sum+=histogram[i]*i;for(let i=0;i<256;i++){count+=histogram[i];left+=histogram[i]*i;if(!count||count===total)continue;const delta=left/count-(sum-left)/(total-count),variance=count*(total-count)*delta*delta;if(variance>best){best=variance;threshold=i;}}return threshold+1;}

export class TesseractOCR {
  constructor(onProgress = () => {}) { this.onProgress = onProgress; this.worker = null; this.loading = null; this.queue = Promise.resolve(); }
  async initialize() {
    if (this.worker) return;
    if (!this.loading) this.loading = (async () => {
      const api = await loadLibrary();
      this.worker = await api.createWorker('eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
        logger: message => this.onProgress(message),
      }, {load_system_dawg: '0', load_freq_dawg: '0'});
      await this.worker.setParameters({
        tessedit_pageseg_mode: '7', user_defined_dpi: '150',
        // Preserve ambiguous characters so clocks and letter substitutions are rejected.
        tessedit_char_whitelist: '0123456789.+-,:/eEOoIl',
      });
    })().catch(async error => {
      await this.worker?.terminate(); this.worker = null; this.loading = null; throw error;
    });
    await this.loading;
  }
  exclusive(task) {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }
  recognize(input, options = {}) {
    return this.exclusive(async () => {
      await this.initialize();
      const start = performance.now(), processed = prepareCrop(input, options);
      const {data} = await this.worker.recognize(processed, {tessedit_pageseg_mode: '7'}, {text: true});
      return {text: (data.text || '').trim(), confidence: Math.max(0, Math.min(1, (data.confidence || 0) / 100)),
        decimal_evidence: false, milliseconds: performance.now() - start, processed};
    });
  }
  detect(input) {
    return this.exclusive(async () => {
      await this.initialize();
      const {data} = await this.worker.recognize(input, {tessedit_pageseg_mode: '11'}, {text: true, blocks: true});
      const boxes = [];
      for (const block of data.blocks || []) for (const paragraph of block.paragraphs || [])
        for (const line of paragraph.lines || []) for (const word of line.words || []) {
          if (!/\d/.test(word.text)) continue;
          const {x0, y0, x1, y1} = word.bbox;
          const x = Math.max(0, x0 - 8), y = Math.max(0, y0 - 8);
          boxes.push({x: x / input.width, y: y / input.height,
            w: (Math.min(input.width, x1 + 8) - x) / input.width,
            h: (Math.min(input.height, y1 + 8) - y) / input.height});
        }
      return boxes.slice(0, 3);
    });
  }
  async terminate() { await this.queue; await this.worker?.terminate(); this.worker = null; this.loading = null; }
}

export class BrowserOCR {
  constructor(onProgress=()=>{}){this.onProgress=onProgress;this.pending=new Map();this.sequence=0;this.queue=Promise.resolve();}
  get root(){return new URL('./models/',globalThis.OCR_ASSET_BASE||location.href).href;}
  async initialize(){
    if(!this.loading)this.loading=(async()=>{
      this.onProgress({status:'下載／載入 PP-OCRv5 辨識模型（約 8 MB）',progress:0});
      const url=globalThis.PADDLE_WORKER_URL || new URL('./paddle-worker.js',import.meta.url);
      this.worker=new Worker(url);
      this.worker.onmessage=({data})=>{if(data.type==='progress'){this.onProgress(data);return;}const task=this.pending.get(data.id);if(!task)return;clearTimeout(task.timer);this.pending.delete(data.id);data.error?task.reject(Error(data.error)):task.resolve(data.result);};
      this.worker.onerror=event=>{for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(Error(event.message||'ONNX worker 啟動失敗'));}this.pending.clear();};
      await this.request('init',{root:this.root});
      this.onProgress({status:'PP-OCRv5 已就緒',progress:1});
    })().catch(error=>{this.worker?.terminate();this.loading=null;throw error;});
    await this.loading;
  }
  request(type,options={}){return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('手機推論／模型下載逾時，請重新載入頁面。'));},120000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,type,...options});});}
  exclusive(fn){const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result;}
  pixels(canvas){return {width:canvas.width,height:canvas.height,data:canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data};}
  /* Text lines (input pixels) from PP-OCRv5 det, input scaled so its long side is `long`. */
  async detectLines(input,long){
    const w=input.videoWidth||input.width,h=input.videoHeight||input.height,scale=long/Math.max(w,h);
    const canvas=document.createElement('canvas');canvas.width=Math.max(32,Math.round(w*scale));canvas.height=Math.max(32,Math.round(h*scale));
    canvas.getContext('2d').drawImage(input,0,0,canvas.width,canvas.height);
    const map=await this.request('det',{image:this.pixels(canvas),root:this.root});
    const fx=canvas.width/map.width/scale,fy=canvas.height/map.height/scale;
    return mergeLines(dbBoxes(map.probabilities,map.width,map.height).map(b=>({x:b.x*fx,y:b.y*fy,w:b.w*fx,h:b.h*fy,score:b.score})));
  }
  /* One line image → number, label, unit, confidence and decimal evidence. */
  async readCanvas(input,{mode='auto',height=144,trim=true}={}){
    const start=performance.now(),processed=prepareCrop(input,{mode,height,trim});
    const steps=await this.request('rec',{image:this.pixels(processed)});
    const decoded=decodeReading(steps),k=processed.height/48,step=steps.tensorWidth/steps.best.length;
    // Point geometry only over the number's columns, not over %, °C or labels.
    const decimal=decimalComponents(processed,decoded.span?{x0:decoded.span.t0*step*k,x1:(decoded.span.t1+1)*step*k}:{});
    return {...decoded,decimal,decimal_evidence:decimal.hasPoint,milliseconds:performance.now()-start,processed,inputWidth:input.width,inputHeight:input.height};
  }
  /* margin: side room in line heights. Small inside a ROI (labels sit close by);
     larger for full-frame candidates so a trailing unit (°C, %) is not clipped. */
  readLine(source,box,{margin=.15,...options}={}){
    const fw=source.videoWidth||source.width,fh=source.videoHeight||source.height;
    const x0=Math.max(0,box.x-box.h*margin),y0=Math.max(0,box.y-box.h*.12),x1=Math.min(fw,box.x+box.w+box.h*margin),y1=Math.min(fh,box.y+box.h*1.12);
    return this.readCanvas(cropRect(source,{x:x0,y:y0,w:x1-x0,h:y1-y0}),{...options,trim:false});
  }
  recognize(input,options={}){return this.exclusive(async()=>{await this.initialize();return this.readCanvas(input,{mode:options.mode||'auto',height:options.height||144});});}
  /* Read one padded, aligned ROI crop: find the text lines first, then read
     the tallest row centred in the user's ROI, so a slightly shifted ROI never
     truncates digits. `line` (from an earlier frame of the same aligned burst)
     skips detection; `labels` also reads nearby text for type checks. */
  readROI(crop,inner,{mode='auto',height=144,labels=false,line:known=null}={}){return this.exclusive(async()=>{
    await this.initialize();const start=performance.now();let lines=[],rows=known?[known]:[];
    if(!known){
      lines=await this.detectLines(crop,Math.min(640,Math.max(320,crop.width,crop.height)));
      const inside=linesInRegion(lines,inner);
      // The row spans at least the ROI width: a glyph the detector missed in a blurred frame is still read.
      const widen=row=>{const x=Math.min(row.x,inner.x),right=Math.max(row.x+row.w,inner.x+inner.w);return {...row,x,w:right-x};};
      for(const l of inside.slice(0,2)){const row=widen(rowOf(l,inside));if(!rows.some(r=>r.x===row.x&&r.y===row.y&&r.w===row.w&&r.h===row.h))rows.push(row);}
    }
    let reading=null,line=null;
    for(const candidate of rows){const r=await this.readLine(crop,candidate,{mode,height});if(r.text){reading=r;line=candidate;break;}reading??=r;}
    if(!reading?.text){const whole=await this.readCanvas(cropRect(crop,inner),{mode,height,trim:true});if(!reading||whole.text){reading=whole;line=null;}}
    const nearby=[];
    if(labels&&line)for(const other of nearbyLabels(line,lines).slice(0,3))nearby.push((await this.readLine(crop,other,{mode,height})).rawText);
    // Text running into the padded crop edge may continue outside it: a digit could be cut off.
    const truncated=Boolean(line&&(line.x<=.5||line.y<=.5||line.x+line.w>=crop.width-.5||line.y+line.h>=crop.height-.5));
    return {...reading,line,truncated,lines:rows.length,nearby,milliseconds:performance.now()-start};
  });}
  /* The tallest text row in the ROI that holds a number (crop pixels), or null. */
  locate(crop,inner){return this.exclusive(async()=>{
    await this.initialize();
    const inside=linesInRegion(await this.detectLines(crop,Math.min(640,Math.max(320,crop.width,crop.height))),inner);
    for(const l of inside.slice(0,3)){const row=rowOf(l,inside);if((await this.readLine(crop,row,{})).text)return row;}
    return null;
  });}
  /* Full-frame search (official det input: long side 960). Values are lines
     with one number; labels/units near them give the item type (pH, DO …). */
  detect(input){return this.exclusive(async()=>{
    await this.initialize();this.onProgress({status:'自動找出數值與項目（首次另載偵測模型約 5 MB）',progress:0});
    const W=input.videoWidth||input.width,H=input.videoHeight||input.height;
    const lines=(await this.detectLines(input,960)).sort((a,b)=>b.w*b.h-a.w*a.h).slice(0,20),read=[];
    for(const line of lines)read.push({line,r:await this.readLine(input,line,{margin:.3})});
    // Not values: clock times, and integers inside words (model names such as "AquaCheck 3000").
    const brand=r=>!r.text.includes('.')&&(r.label.match(/\p{L}/gu)||[]).length>=4&&!inferType(r,[]);
    const numbers=read.filter(x=>x.r.text&&/\d/.test(x.r.text)&&!/\d\s*:\s*\d/.test(x.r.rawText)&&!brand(x.r)),labels=read.filter(x=>!numbers.includes(x)&&x.r.rawText);
    const candidates=numbers.map(({line,r})=>{
      const near=nearbyLabels(line,labels.map(x=>x.line)).map(l=>read.find(x=>x.line===l).r.rawText),type=inferType(r,near);
      return {x:line.x/W,y:line.y/H,w:line.w/W,h:line.h/H,text:r.text,rawText:r.rawText,unit:r.unit,label:[r.label,near[0]].filter(Boolean).join(' '),
        type,decimals:decimalsOf(r.text),ocrConfidence:r.confidence,score:line.score,source:'PP-OCR'};
    }).sort((a,b)=>(b.type?1:0)-(a.type?1:0)||b.h-a.h).slice(0,8);
    this.onProgress({status:`找到 ${candidates.length} 個數值候選框，點選需要監測的區域`,progress:1});
    return candidates;
  });}
  async terminate(){await this.queue;this.worker?.terminate();this.loading=null;}
}

function cropRect(source,r){
  const canvas=document.createElement('canvas');canvas.width=Math.max(8,Math.round(r.w));canvas.height=Math.max(8,Math.round(r.h));
  canvas.getContext('2d').drawImage(source,r.x,r.y,r.w,r.h,0,0,canvas.width,canvas.height);return canvas;
}

export function cropROI(frame, roi) {
  const canvas = document.createElement('canvas');
  const x = Math.max(0, Math.round(roi.x * frame.width)), y = Math.max(0, Math.round(roi.y * frame.height));
  canvas.width = Math.max(8, Math.min(frame.width - x, Math.round(roi.w * frame.width)));
  canvas.height = Math.max(8, Math.min(frame.height - y, Math.round(roi.h * frame.height)));
  canvas.getContext('2d').drawImage(frame, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function validateBrowserReadings(readings, {confidence = .9, decimals = null, minimum = -1e9, maximum = 1e9} = {}) {
  const votes = new Map(), failures = [];
  for (const reading of readings) {
    const text = reading.text.trim().replaceAll('−', '-');
    let status;
    if (reading.confidence < confidence) status = 'LOW_CONFIDENCE';
    else if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) status = 'INVALID_FORMAT';
    else if (reading.decimal_checked && Boolean(reading.decimal_evidence) !== text.includes('.')) status = 'DECIMAL_UNCERTAIN';
    else if (decimals > 0 && !text.includes('.')) status = 'DECIMAL_UNCERTAIN';
    const value = Number(text);
    if (!status && (!Number.isFinite(value) || value < minimum || value > maximum)) status = 'OUT_OF_RANGE';
    if (status) failures.push(status); else votes.set(value, (votes.get(value) || 0) + 1);
  }
  const winner = [...votes].sort((a, b) => b[1] - a[1])[0];
  const required = readings.length > 1 ? 2 : 1;
  if (!winner) return {value: null, status: failures[0] || 'MISSING'};
  return winner[1] >= required ? {value: winner[0], status: 'VALID'} : {value: null, status: 'OCR_CONFLICT'};
}

/* One job in flight. Missed time slots are counted, never queued or backfilled. */
export class FixedRateRunner {
  constructor({intervalMs, durationMs, sample, onResult, onSkip, onDone,
    clock = () => performance.now(), schedule = (fn, delay) => setTimeout(fn, delay), cancel = id => clearTimeout(id)}) {
    Object.assign(this, {intervalMs, durationMs, sample, onResult, onSkip, onDone, clock, schedule, cancel});
    this.running = false; this.busy = false; this.done = false; this.tick = 0;
  }
  start() { this.started = this.clock(); this.running = true; this.step(); }
  step() {
    if (!this.running) return;
    const now = this.clock(), total = Math.ceil(this.durationMs / this.intervalMs);
    const due = Math.min(Math.floor((now - this.started) / this.intervalMs), total);
    while (this.tick < due) this.onSkip(this.tick++, 'late');
    if (this.tick >= total) { this.stop('duration'); return; }
    const tick = this.tick++, target = this.started + tick * this.intervalMs;
    this.timer = this.schedule(() => this.step(), Math.max(0, this.started + this.tick * this.intervalMs - this.clock()));
    if (this.busy) { this.onSkip(tick, 'busy'); return; }
    this.busy = true;
    Promise.resolve().then(() => this.sample(tick, target)).then(
      result => this.onResult({tick, target, finished: this.clock(), result}),
      error => this.onResult({tick, target, finished: this.clock(), error}),
    ).finally(() => { this.busy = false; this.finish(); });
  }
  stop(reason = 'manual') { this.running = false; this.reason = reason; this.cancel(this.timer); this.finish(); }
  finish() {
    if (!this.running && !this.busy && !this.done) {
      this.done = true; this.onDone({reason: this.reason, elapsedMs: this.clock() - this.started});
    }
  }
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * p;
  return sorted[Math.floor(position)] + (sorted[Math.ceil(position)] - sorted[Math.floor(position)]) * (position % 1);
}
