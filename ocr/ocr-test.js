import {BrowserOCR, OCR_VERSION, cropROI, validateBrowserReadings, FixedRateRunner, percentile} from './browser-ocr.js';
import {PanelTracker, roiPolygon} from './panel-tracker.js';
const $ = id => document.getElementById(id);
const preview = $('preview'), ctx = preview.getContext('2d');
const state = {source: null, stream: null, image: null, facing: 'environment', active: 0,
  rois: [{x: .32, y: .43, w: .36, h: .14}], candidates: [], running: false, loading: false, runner: null, cameraSetup: null,
  rows: [], rounds: [], skipped: 0, errors: 0, started: 0, elapsedMs: 0, config: null, report: null};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tracker = new PanelTracker();
let recovery,lastRecovery=-Infinity;
function tryRelocation(frame){
  if(recovery||performance.now()-lastRecovery<5000)return;
  lastRecovery=performance.now();const runner=state.runner;
  recovery=engine.detect(frame).then(boxes=>{if(!state.running||state.runner!==runner)return;const result=tracker.relocate(frame,boxes);visibleStatus(result.ok?'已重新定位，等待下一次取樣':'尚未找回原面板，持續停收');}).catch(()=>{}).finally(()=>{recovery=null;});
}
function visibleStatus(text) { $('visibleStatus').textContent=text; }
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function guarded(fn) { return async event => { try { notice(''); await fn(event); } catch (error) { notice(error.message); } }; }
const engine = new BrowserOCR(message => {
  if (state.loading) $('loadState').textContent = message.status;
  visibleStatus(message.status);
});
$('engine').textContent = `${OCR_VERSION} · ${navigator.hardwareConcurrency || '?'} logical cores · ${navigator.userAgent}`;

function freezeControls(busy) {
  for (const id of ['camera','cameraDevice','switch','detect','tracking','synthetic','imageFile','addROI','removeROI','activeROI','interval','duration','burst','preprocess','height','threshold','decimals','expected','load','start']) $(id).disabled = busy;
  $('stop').disabled = !state.running;
}
async function loadEngine() {
  state.loading = true; freezeControls(true);
  const start = performance.now();
  try {
    await engine.initialize();
    // Exercise the real engine before starting timed capture.
    const warm = document.createElement('canvas'); warm.width = 240; warm.height = 96;
    const c = warm.getContext('2d'); c.fillStyle = 'white'; c.fillRect(0,0,240,96); c.fillStyle = 'black'; c.font = '54px Arial'; c.fillText('25.70',12,65);
    await engine.recognize(warm);
    $('loadState').textContent = `OCR 已就緒；載入與暖機 ${(performance.now() - start) / 1000 < 1 ? '<1' : ((performance.now() - start) / 1000).toFixed(1)} 秒。這段不列入測試。`;
  } finally { state.loading = false; freezeControls(state.running); }
}
$('load').onclick = guarded(loadEngine);

function cameraSnapshot() {
  const track = state.stream?.getVideoTracks()[0];
  if (!track) return null;
  const settings = track.getSettings();
  return {trackId: track.id, label: track.label, deviceId: settings.deviceId,
    nativeWidth: $('video').videoWidth, nativeHeight: $('video').videoHeight,
    width: settings.width, height: settings.height, facingMode: settings.facingMode, zoom: settings.zoom};
}
function assertCameraStable() {
  if (state.source !== 'camera') return;
  const current = cameraSnapshot(), setup = state.cameraSetup;
  if (!current || !setup || $('video').srcObject !== state.stream || state.stream.getVideoTracks()[0].readyState !== 'live' ||
      ['trackId','deviceId','nativeWidth','nativeHeight','zoom'].some(key => current[key] !== setup[key])) {
    const error = Error('相機取像範圍已改變；請重新開啟相機並設定 ROI。');
    error.name = 'CameraChangedError'; throw error;
  }
}
async function refreshCameraDevices() {
  const selected = state.cameraSetup.deviceId, cameras = navigator.mediaDevices.enumerateDevices ?
    (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput' && device.deviceId) : [];
  // Some browsers expose only the active camera. Keep it selectable without reopening it.
  if (selected && !cameras.some(device => device.deviceId === selected)) cameras.push({deviceId: selected, label: state.cameraSetup.label});
  $('cameraDevice').replaceChildren(new Option('自動選擇鏡頭', ''), ...cameras.map((device, i) => new Option(device.label || `相機 ${i + 1}`, device.deviceId)));
  $('cameraDevice').value = selected || '';
}
function stopCamera() {
  state.stream?.getTracks().forEach(track => track.stop()); state.stream = null; state.cameraSetup = null;
  $('video').srcObject = null; if (state.source === 'camera') state.source = null;
}
async function openCamera() {
  if (state.running || state.loading || state.starting) return;
  if (!navigator.mediaDevices?.getUserMedia) throw Error('手機相機需要 HTTPS 網址。請用靜態 HTTPS 網站開啟測試頁；電腦可用 localhost。');
  state.loading = true; freezeControls(true); visibleStatus('正在開啟相機…');
  try {
    stopCamera();
    const deviceId = $('cameraDevice').value;
    const selection = deviceId ? {deviceId: {exact: deviceId}} : {facingMode: {ideal: state.facing}};
    const stream = await navigator.mediaDevices.getUserMedia({video: {...selection, width: {ideal: 1920}, height: {ideal: 1080}}, audio: false});
    state.stream = stream; $('video').srcObject = stream;
    await $('video').play();
    if (!$('video').videoWidth || !$('video').videoHeight) throw Error('相機影像尚未就緒；請重新開啟相機。');
    state.source = 'camera'; state.image = null; state.cameraSetup = cameraSnapshot();
    preview.width = Math.min(1920, state.cameraSetup.nativeWidth);
    preview.height = Math.round(preview.width * state.cameraSetup.nativeHeight / state.cameraSetup.nativeWidth);
    sourceReady(`${state.cameraSetup.label || '手機相機'} · ${state.cameraSetup.nativeWidth}×${state.cameraSetup.nativeHeight}`);
    // Device enumeration is optional; a failure must not replace the live preview stream.
    try { await refreshCameraDevices(); } catch { /* Camera remains usable with the facing selector. */ }
  } catch (error) { stopCamera(); $('cameraHint').hidden = false; throw error; }
  finally { state.loading = false; freezeControls(false); }
  await detectRegions();
}
$('camera').onclick = guarded(openCamera);
$('cameraDevice').onchange = guarded(openCamera);
$('switch').onclick = guarded(async () => { if(state.running||state.loading||state.starting)return;state.facing = state.facing === 'environment' ? 'user' : 'environment'; $('cameraDevice').value = ''; await openCamera(); });
function sourceReady(label) { tracker.reset();state.tracking=null;state.candidates=[];$('candidates').replaceChildren();$('sourceLabel').textContent = label; $('cameraHint').hidden = true; }
async function detectRegions(){
  if(state.running||state.loading)return;
  state.loading=true;freezeControls(true);visibleStatus('正在找文字區域…');
  try {
    state.candidates=await engine.detect(capture().canvas);
    $('candidates').replaceChildren(...state.candidates.map((box,i)=>{const b=document.createElement('button');b.className='quiet';b.textContent=`${box.text} · 候選 ${i+1}`;b.onclick=()=>chooseCandidate(box);return b;}));
    visibleStatus(state.candidates.length?`點選虛線框選取（${state.candidates.length} 個）`:'未找到候選；請拖曳實線框');
  }finally{state.loading=false;freezeControls(false);}
}
function chooseCandidate(box){if(state.running||state.loading)return;state.rois[state.active]={x:box.x,y:box.y,w:box.w,h:box.h};refreshROIs();visibleStatus('已選取；可拖曳調整後開始');}
$('detect').onclick=guarded(detectRegions);
$('imageFile').onchange = guarded(async () => {
  const file = $('imageFile').files[0]; if (!file) return;
  const url = URL.createObjectURL(file), image = new Image();
  try { await new Promise((resolve,reject) => { image.onload = resolve; image.onerror = () => reject(Error('無法讀取照片。')); image.src = url; }); }
  finally { URL.revokeObjectURL(url); }
  stopCamera(); state.source = 'image'; state.image = image;
  const ratio = Math.min(1, 1280 / image.naturalWidth, 960 / image.naturalHeight);
  preview.width = Math.round(image.naturalWidth * ratio); preview.height = Math.round(image.naturalHeight * ratio);
  sourceReady('固定照片（非相機效能）');
});
function syntheticROIs() {
  const count = state.rois.length;
  state.rois = Array.from({length: count}, (_, i) => ({x: .30, y: .10 + i * .8 / count, w: .4, h: .20 / count}));
}
$('synthetic').onclick = guarded(() => { stopCamera(); state.source = 'synthetic'; state.image = null; preview.width = 800; preview.height = 480; syntheticROIs(); refreshROIs(); sourceReady('合成印刷數字（非真實儀器）'); });
function syntheticFrame(tick = 0) {
  const c = document.createElement('canvas'); c.width = 800; c.height = 480;
  const paint = c.getContext('2d'); paint.fillStyle = '#fff'; paint.fillRect(0,0,c.width,c.height);
  // Panel texture provides stable anchors outside the changing reading.
  paint.strokeStyle='#abb6c0';paint.lineWidth=2;paint.strokeRect(30,25,740,430);
  for(let i=0;i<60;i++){const x=40+(i*137)%710,y=35+(i*83)%400;if(state.rois.some(r=>x>r.x*800-20&&x<(r.x+r.w)*800+20&&y>r.y*480-20&&y<(r.y+r.h)*480+20))continue;paint.fillStyle=i%2?'#607284':'#acb9c5';paint.fillRect(x,y,8+i%9,8);}
  const expected = [];
  state.rois.forEach((roi,i) => {
    const text = (25.7 + i * 10 + tick * .03).toFixed(2); expected.push(Number(text));
    paint.font = `${Math.min(76, roi.h * c.height * .7)}px Arial`;
    paint.fillStyle = '#111'; paint.textAlign = 'center'; paint.textBaseline = 'middle';
    paint.fillText(text, (roi.x + roi.w / 2) * c.width, (roi.y + roi.h / 2) * c.height);
  });
  return {canvas: c, expected};
}
function capture(tick = 0) {
  assertCameraStable();
  if (state.source === 'synthetic') return syntheticFrame(tick);
  const c = document.createElement('canvas'); c.width = preview.width; c.height = preview.height;
  const source = state.source === 'camera' ? $('video') : state.image;
  if (!source) throw Error('請先開啟相機、選擇照片，或使用合成自測。');
  c.getContext('2d').drawImage(source,0,0,c.width,c.height);
  return {canvas: c, expected: []};
}
let lastPreview = 0;
let lastTrack=0;
function trackingFrame(frame){
  if(state.config?.tracking!=='handheld')return frame;
  const result=tracker.track(frame);state.tracking=result;
  $('trackingState').textContent=result.ok?`補正 ${Math.round(result.confidence*100)}%`:`停收：${result.reason}`;
  if(!result.ok){tryRelocation(frame);throw Error('Tracking：'+result.reason);}
  return tracker.align(frame,result);
}
function renderPreview(timestamp = 0) {
  if (state.source && timestamp - lastPreview > 65) {
    lastPreview = timestamp;
    try { assertCameraStable(); } catch (error) {
      if(state.running)state.runner?.stop('camera-changed');
      visibleStatus(error.message);
      requestAnimationFrame(renderPreview); return;
    }
    const image = state.source === 'camera' ? $('video') : state.source === 'image' ? state.image : syntheticFrame(state.lastTick || 0).canvas;
    ctx.drawImage(image,0,0,preview.width,preview.height);
    if(state.running&&state.config.tracking==='handheld'&&timestamp-lastTrack>180){lastTrack=timestamp;try{state.tracking=tracker.track(capture(state.lastTick||0).canvas);}catch{state.tracking={ok:false,reason:'追蹤失敗'};}}
    if(!state.running){ctx.setLineDash([8,6]);state.candidates.forEach((r,i)=>{ctx.strokeStyle='#FF9E64';ctx.lineWidth=2;ctx.strokeRect(r.x*preview.width,r.y*preview.height,r.w*preview.width,r.h*preview.height);ctx.fillStyle='#FF9E64';ctx.font='15px sans-serif';ctx.fillText(`候選 ${i+1}`,r.x*preview.width,r.y*preview.height-4);});ctx.setLineDash([]);}
    state.rois.forEach((r,i) => {
      const polygon=roiPolygon(r,state.running&&state.tracking?.ok?state.tracking.h:undefined);
      ctx.strokeStyle = state.running&&state.config.tracking==='handheld'&&!state.tracking?.ok?'#FF7B72':i === state.active ? '#3FCFA5' : '#58A6FF'; ctx.lineWidth = 3;
      ctx.beginPath();polygon.forEach((p,j)=>j?ctx.lineTo(p.x*preview.width,p.y*preview.height):ctx.moveTo(p.x*preview.width,p.y*preview.height));ctx.closePath();ctx.stroke();
      const edge=polygon[2];ctx.fillStyle=ctx.strokeStyle;if(!state.running)ctx.fillRect(edge.x*preview.width-16,edge.y*preview.height-16,16,16);
      ctx.font = '18px sans-serif';ctx.fillText(`ROI ${i+1}`,polygon[0].x*preview.width+8,polygon[0].y*preview.height+24);
    });
  }
  requestAnimationFrame(renderPreview);
}
renderPreview();
function refreshROIs() { $('activeROI').replaceChildren(...state.rois.map((_,i) => new Option(`ROI ${i+1}`,String(i)))); state.active = Math.min(state.active,state.rois.length-1); $('activeROI').value = state.active; }
$('activeROI').onchange = () => { state.active = Number($('activeROI').value); };
$('addROI').onclick = guarded(() => { if (state.rois.length >= 3) throw Error('最多 3 個 ROI。'); state.rois.push({x:.25,y:.55,w:.5,h:.2}); state.active = state.rois.length-1; if(state.source==='synthetic')syntheticROIs();refreshROIs(); });
$('removeROI').onclick = guarded(() => { if (state.rois.length === 1) throw Error('至少保留 1 個 ROI。'); state.rois.splice(state.active,1);if(state.source==='synthetic')syntheticROIs();refreshROIs(); });
let drag;
function point(event) { const rect=preview.getBoundingClientRect(),scale=Math.min(rect.width/preview.width,rect.height/preview.height),w=preview.width*scale,h=preview.height*scale;return{x:(event.clientX-rect.left-(rect.width-w)/2)/w,y:(event.clientY-rect.top-(rect.height-h)/2)/h}; }
preview.onpointerdown = event => {
  if (state.running || state.loading) return;
  const p = point(event);
  const candidate=state.candidates.find(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h);
  if(candidate&&!state.rois.some(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h)){chooseCandidate(candidate);return;}
  for (let i=state.rois.length-1;i>=0;i--) { const r=state.rois[i];if(p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h){state.active=i;refreshROIs();drag={p,original:{...r},resize:p.x>r.x+r.w-.06&&p.y>r.y+r.h-.06};preview.setPointerCapture(event.pointerId);break;} }
};
preview.onpointermove = event => {
  if(!drag)return;const p=point(event),r=state.rois[state.active],o=drag.original;
  if(drag.resize){r.w=Math.max(.04,Math.min(1-o.x,o.w+p.x-drag.p.x));r.h=Math.max(.04,Math.min(1-o.y,o.h+p.y-drag.p.y));}
  else {r.x=Math.max(0,Math.min(1-r.w,o.x+p.x-drag.p.x));r.y=Math.max(0,Math.min(1-r.h,o.y+p.y-drag.p.y));}
};
preview.onpointerup = preview.onpointercancel = () => { drag = null; };

async function sample(tick, target) {
  const started = performance.now(), capturedAt = Date.now(), items = [], settings = state.config;
  state.lastTick = tick;
  for (let i=0;i<state.rois.length;i++) {
    const readings = []; let processed, expected = null;
    for(let n=0;n<settings.burst;n++) {
      const frame = capture(tick), aligned=trackingFrame(frame.canvas), input = cropROI(aligned,state.rois[i]);
      if(state.source==='synthetic')expected=frame.expected[i];
      else if(i===0&&settings.expected!==null)expected=settings.expected;
      const result=await engine.recognize(input,{mode:settings.preprocess,height:settings.height});
      assertCameraStable();
      readings.push({text:result.text,rawText:result.rawText,confidence:result.confidence,decimal_evidence:result.decimal_evidence,decimal_checked:true,decimal:result.decimal,inputWidth:result.inputWidth,inputHeight:result.inputHeight,characterScores:result.characterScores,numericConflict:result.numericConflict});processed=result.processed;if(i===0){state.lastInput=input;state.lastProcessed=processed;}
      if(n<settings.burst-1)await sleep(80);
    }
    const validated=validateBrowserReadings(readings,{confidence:settings.threshold,decimals:settings.decimals});
    items.push({roi:i+1,readings,...validated,expected,correct:expected===null?null:validated.value!==null&&Math.abs(validated.value-expected)<1e-7,processed});
  }
  return {capturedAt,started,latenessMs:started-target,milliseconds:performance.now()-started,items,tracking:state.tracking?{confidence:state.tracking.confidence,h:state.tracking.h,inliers:state.tracking.inliers,rms:state.tracking.rms}:null};
}
function addRows(rows) {
  state.rows.push(...rows);
  $('rows').replaceChildren();
  for(const row of state.rows.slice(-20).reverse()) {
    const tr=document.createElement('tr');
    const fields=[new Date(row.capturedAt).toLocaleTimeString(),row.roi||'—',row.readings?.map(r=>(r.rawText??r.text)||'(空白)').join(' / ')||'—',row.value??'—',row.readings?.map(r=>`${Math.round(r.confidence*100)}%`).join(' / ')||'—',row.status,row.milliseconds==null?'—':`${Math.round(row.milliseconds)} ms`];
    fields.forEach(value=>{const td=document.createElement('td');td.textContent=String(value);if(row.status!=='VALID')td.className='reject';tr.append(td);});$('rows').append(tr);
  }
}
function onResult({tick,target,finished,result,error}) {
  if(error?.name==='CameraChangedError')state.runner?.stop('camera-changed');
  if(error){const trackingLost=error.message.startsWith('Tracking：');if(!trackingLost)state.errors++;addRows([{tick,capturedAt:Date.now(),status:trackingLost?'TRACKING_LOST':'ERROR',error:error.message}]);$('latest').textContent='—';$('raw').textContent=trackingLost?'停收，請重新對準原面板':error.message;$('readingStatus').textContent=trackingLost?'追蹤遺失':'辨識失敗';visibleStatus(error.message);document.querySelector('.live-result').classList.add('rejected');}
  else {
    state.rounds.push({tick,target,finished,milliseconds:result.milliseconds,latenessMs:result.latenessMs,tracking:result.tracking});
    addRows(result.items.map(({processed,...item})=>({...item,tick,capturedAt:result.capturedAt,milliseconds:result.milliseconds})));
    const first=result.items[0];$('latest').textContent=first.readings.at(-1)?.rawText||first.readings.at(-1)?.text||'(空白)';$('raw').textContent=first.value===null?`拒收：${first.status}`:`有效數值：${first.value}`;document.querySelector('.live-result').classList.toggle('rejected',first.status!=='VALID');
    $('extraResults').replaceChildren(...result.items.slice(1).map(item=>{const span=document.createElement('span');span.textContent=`ROI ${item.roi}：${item.readings.at(-1)?.text||'(空白)'} ${item.status==='VALID'?'✓':'⚠'}`;return span;}));
    visibleStatus(first.status==='VALID'?'辨識中':`拒收 ${first.status}`);$('exportCrop').disabled=false;
    $('confidence').textContent=`信心 ${first.readings.map(r=>Math.round(r.confidence*100)+'%').join(' / ')}`;
    $('latency').textContent=`整輪 ${Math.round(result.milliseconds)} ms`;$('readingStatus').textContent=first.status;
    $('crops').replaceChildren();result.items.forEach(item=>{const fig=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=`ROI ${item.roi} · ${item.status}`;fig.append(item.processed,caption);$('crops').append(fig);});
  }
  updateMetrics();
}
function summary() {
  const elapsedMs=state.running?performance.now()-state.started:state.elapsedMs;
  const readings=state.rows.filter(r=>r.roi),valid=readings.filter(r=>r.status==='VALID').length,checked=readings.filter(r=>r.correct!==null),correct=checked.filter(r=>r.correct).length;
  return {elapsedMs,completedRounds:state.rounds.length,skippedTicks:state.skipped,errors:state.errors,
    trackingLostTicks:state.rows.filter(r=>r.status==='TRACKING_LOST').length,
    effectiveHz:elapsedMs>0?state.rounds.length/(elapsedMs/1000):0,
    roundP50Ms:percentile(state.rounds.map(r=>r.milliseconds),.5),roundP95Ms:percentile(state.rounds.map(r=>r.milliseconds),.95),
    validReadings:valid,totalReadings:readings.length,validRatio:readings.length?valid/readings.length:null,
    checkedReadings:checked.length,correctReadings:correct,checkedAccuracy:checked.length?correct/checked.length:null};
}
function updateMetrics() {
  if(!state.config)return;const s=summary();
  const lost=state.running&&state.rows.at(-1)?.status==='TRACKING_LOST';
  const rate=state.running?(state.rounds.length<2?null:(state.rounds.length-1)/((state.rounds.at(-1).finished-state.rounds[0].finished)/1000)):s.effectiveHz;
  const rateLabel=lost?'停收':rate===null?'—':rate.toFixed(2);
  $('actualHz').textContent=rateLabel;$('p95').textContent=s.roundP95Ms===null?'—':`${Math.round(s.roundP95Ms)} ms`;
  $('skipped').textContent=s.skippedTicks;$('validRate').textContent=s.validRatio===null?'—':`${(s.validRatio*100).toFixed(1)}%`;
  $('accuracy').textContent=s.checkedAccuracy===null?'未核對':`${(s.checkedAccuracy*100).toFixed(1)}%`;
  $('progress').style.width=`${Math.min(100,s.elapsedMs/state.config.durationMs*100)}%`;
  $('elapsed').textContent=`${(s.elapsedMs/1000).toFixed(1)} / ${state.config.durationMs/1000} 秒 · ${state.rois.length} ROI × ${state.config.burst} 張 · 錯誤 ${s.errors}`;
  $('counts').textContent=`${s.completedRounds} 輪 · ${s.totalReadings} 讀值`;
  $('liveHz').textContent=rateLabel;$('liveP95').textContent=s.roundP95Ms===null?'—':`${Math.round(s.roundP95Ms)} ms`;$('liveSkipped').textContent=s.skippedTicks;
}
let metricTimer,wakeLock;
function onDone({reason,elapsedMs}) {
  state.running=false;state.elapsedMs=elapsedMs;clearInterval(metricTimer);wakeLock?.release();wakeLock=null;freezeControls(false);updateMetrics();
  document.body.classList.remove('testing');
  $('start').textContent='開始偵測';
  const s=summary(),targetHz=1000/state.config.intervalMs;
  const pass=reason==='duration'&&s.errors===0&&s.skippedTicks===0&&s.roundP95Ms!==null&&s.roundP95Ms<=state.config.intervalMs&&s.effectiveHz>=targetHz*.98;
  $('runState').textContent=reason==='duration'?'測試完成':reason==='hidden'?'背景暫停':'已停止';
  if(reason==='camera-changed'){
    const message='相機取像範圍已改變；請重新開啟相機並設定 ROI。';
    $('runState').textContent='相機範圍已變更';$('latest').textContent='—';$('raw').textContent=message;
    $('readingStatus').textContent='已停止，請重新設定 ROI';visibleStatus(message);
  }
  $('verdict').classList.toggle('good',pass);
  $('verdict').textContent=pass?`速度達標（${targetHz} Hz）。${s.checkedAccuracy===null?'正確率尚未核對，請比對儀器或填入已知讀值。':`有效且正確比例 ${(s.checkedAccuracy*100).toFixed(1)}%；仍需真實面板驗證。`}`:reason==='duration'?'此設定未達目標頻率。查看漏格與 p95；可縮小 ROI、使用 1 張或降低取樣率後重測。':'測試未完成完整時間；請重新測試後判讀頻率。';
  state.report={engine:OCR_VERSION,device:{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency},source:state.source,
    capture:{nativeWidth:$('video').videoWidth,nativeHeight:$('video').videoHeight,frameWidth:preview.width,frameHeight:preview.height,cameraAtSetup:state.cameraSetup,cameraAtEnd:cameraSnapshot()},
    startedAt:state.startedAt,settings:state.config,rois:state.rois.map(r=>({...r})),reason,summary:s,rows:state.rows.map(r=>({...r})),rounds:state.rounds};
  $('exportCSV').disabled=$('exportJSON').disabled=!state.rows.length;
}
$('start').onclick=guarded(async()=>{
  if(state.starting||state.running)return;
  state.starting=true;
  try {
  if(!state.source)throw Error('請先選擇影像來源。');
  assertCameraStable();
  await loadEngine();
  assertCameraStable();
  freezeControls(true);
  if(document.hidden)throw Error('請回到前景後再開始。');
  state.config={intervalMs:+$('interval').value,durationMs:+$('duration').value,burst:+$('burst').value,preprocess:$('preprocess').value,height:+$('height').value,threshold:+$('threshold').value,decimals:+$('decimals').value,tracking:$('tracking').value,expected:$('expected').value===''?null:Number($('expected').value)};
  if(state.config.tracking==='handheld'){visibleStatus('建立面板參考…');await tracker.initialize();const count=tracker.setReference(capture().canvas,state.rois);$('trackingState').textContent=`參考 ${count} 個特徵`;state.tracking=tracker.track(capture().canvas);if(!state.tracking.ok)throw Error('Tracking：'+state.tracking.reason);}else{$('trackingState').textContent='固定模式：不補正';state.tracking=null;}
  state.rows=[];state.rounds=[];state.skipped=0;state.errors=0;state.report=null;state.elapsedMs=0;state.running=true;
  state.started=performance.now();state.startedAt=new Date().toISOString();freezeControls(true);$('exportCSV').disabled=$('exportJSON').disabled=true;
  $('runState').textContent='測試中';$('verdict').classList.remove('good');$('verdict').textContent='固定時間格取樣中；沒有 OCR 工作排隊。';
  state.runner=new FixedRateRunner({...state.config,sample,onResult,
    onSkip:(tick,reason)=>{state.skipped++;addRows([{tick,capturedAt:Date.now(),status:reason==='busy'?'SKIPPED_BUSY':'SKIPPED_LATE'}]);},onDone});
  state.started=performance.now();state.runner.start();metricTimer=setInterval(updateMetrics,250);
  document.body.classList.add('testing');$('start').textContent='偵測中';$('setupDetails').open=false;$('liveStop').disabled=false;window.scrollTo({top:0,behavior:'instant'});
  navigator.wakeLock?.request('screen').then(lock=>{if(state.running)wakeLock=lock;else lock.release();}).catch(()=>{});
  }finally{state.starting=false;if(!state.running)freezeControls(false);}
});
$('interval').onchange=()=>{$('start').textContent='開始偵測';};
$('stop').onclick=()=>{if(!state.running)return;$('stop').disabled=true;$('runState').textContent='等待當前辨識完成…';state.runner?.stop();};
$('liveStop').onclick=()=>{$('liveStop').disabled=true;$('stop').click();};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.running)state.runner.stop('hidden');});
window.addEventListener('pagehide',()=>{state.runner?.stop('pagehide');stopCamera();});
function download(filename,type,text){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('exportCrop').onclick=()=>{if(!state.lastInput||!state.lastProcessed)return;const c=document.createElement('canvas');c.width=Math.max(state.lastInput.width,state.lastProcessed.width);c.height=state.lastInput.height+state.lastProcessed.height+48;const p=c.getContext('2d');p.fillStyle='white';p.fillRect(0,0,c.width,c.height);p.fillStyle='black';p.font='14px sans-serif';p.fillText('Aligned ROI',8,17);p.drawImage(state.lastInput,0,24);p.fillText('OCR input',8,state.lastInput.height+42);p.drawImage(state.lastProcessed,0,state.lastInput.height+48);c.toBlob(blob=>download('mobile-ocr-crop.png','image/png',blob));};
$('exportJSON').onclick=()=>download('mobile-ocr-report.json','application/json',JSON.stringify(state.report,null,2));
$('exportCSV').onclick=()=>{const fields=['tick','captured_at','roi','raw_text','numeric_text','confidence','value','status','round_ms','expected','correct'];const quote=value=>`"${String(value??'').replaceAll('"','""')}"`;const rows=state.report.rows.map(r=>[r.tick,new Date(r.capturedAt).toISOString(),r.roi,r.readings?.map(x=>x.rawText??x.text).join(' | '),r.readings?.map(x=>x.text).join(' | '),r.readings?.map(x=>x.confidence).join(' | '),r.value,r.status,r.milliseconds,r.expected,r.correct]);download('mobile-ocr-readings.csv','text/csv;charset=utf-8','\ufeff'+[fields,...rows].map(row=>row.map(quote).join(',')).join('\r\n'));};
