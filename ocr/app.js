import {drawChart} from './chart.js';
import {BrowserOCR} from './browser-ocr.js';
import {PanelTracker, roiPolygon, alignedCrop, sharpness} from './panel-tracker.js';
import {assessReading, wireReading, inferType, decimalsOf, TYPE_PRESETS} from './reading-parser.js';
import {LocalBackend} from './local-backend.js';
const APP_VERSION = 'v3.0';
const $=id=>document.getElementById(id);
const state={mode:'local',base:location.origin,token:'',role:'local',catalog:[],channels:[],selected:'',rois:[],roi:0,stream:null,facing:'environment',running:false,generation:0,offset:0,snapshot:null,hidden:new Set(),next:new Map()};
let raf,pollTimer,wakeLock;
const tracker=new PanelTracker(),local=new LocalBackend();
const STATUS={TRUNCATED:'數字碰到框邊',VALID:'有效',AUTO_DECIMAL_RECOVERY:'補回小數點',DECIMAL_UNCERTAIN:'小數點不確定',UNIT_MISMATCH:'單位不符',INVALID_FORMAT:'格式不符',LOW_CONFIDENCE:'信心不足',OCR_CONFLICT:'多張不一致',OUT_OF_RANGE:'超出範圍',RATE_EXCEEDED:'變化過快',TRACKING_ERROR:'追蹤遺失',MISSING:'無讀值'};
const label=status=>`${status}${STATUS[status]?' · '+STATUS[status]:''}`;
const localOCR=new BrowserOCR(message=>{$('browserOcrState').textContent=`手機 OCR：${message.status}`;$('cameraStatus').textContent=message.status;});
const canvas=$('overlay'),ctx=canvas.getContext('2d');
const now=()=>Date.now()/1000+state.offset;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
$('appVersion').textContent=APP_VERSION;
function notice(message){$('notice').textContent=message;$('notice').hidden=!message;}
function freezeCamera(busy){for(const id of ['camera','switch','detect','addROI','removeROI','testRead','linkROI','tracking','ocrBurst','ocrPreprocess'])$(id).disabled=busy;}
function guarded(fn){return async e=>{try{await fn(e);}catch(error){notice(error.message);}};}
async function api(path,{method='GET',body,timeout=30000}={}){
  if(state.mode==='local')return local.request(path,{method,body});
  const requestToken=state.token;
  const response=await fetch(state.base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(state.token?{Authorization:'Bearer '+state.token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
  if(response.status===401&&requestToken&&requestToken===state.token){
    pause();clearTimeout(pollTimer);state.token='';persist();
    document.body.classList.remove('focus');$('focusMode').textContent='Focus view / 專注模式';
    $('connectionDetails').open=true;$('connectionState').textContent='Session expired · 請重新連線，或改用本機模式';
  }
  if(!response.ok){let data;try{data=await response.json();}catch{data={detail:response.statusText};}throw Error(`${response.status}: ${typeof data.detail==='string'?data.detail:JSON.stringify(data.detail)}`);}
  return response.json();
}
function persist(){
  try{sessionStorage.setItem('read-predict',JSON.stringify({mode:state.mode,base:state.base,token:state.token,role:state.role,selected:state.selected,rois:state.rois}));}catch{}
  // Local channels live in localStorage, so their ROIs must survive a closed tab too.
  if(state.mode==='local')try{localStorage.setItem('read-predict-local-ui',JSON.stringify({selected:state.selected,rois:state.rois}));}catch{}
}
function selected(){return state.channels.find(c=>c.id===state.selected);}
async function refreshChannels(){
  state.channels=await api('/api/channels');$('channels').replaceChildren();
  for(const channel of state.channels){const option=document.createElement('option');option.value=channel.id;option.textContent=`${channel.name} · ${channel.source} · ${channel.interval}s`;$('channels').append(option);}
  if(!state.channels.some(c=>c.id===state.selected))state.selected=state.channels[0]?.id||'';
  state.rois.forEach(r=>{if(r.channel&&!state.channels.some(c=>c.id===r.channel))delete r.channel;});
  $('channels').value=state.selected;persist();
  const shared=await api('/api/catalog');
  state.catalog=[...shared.map(item=>({...item,origin:'ta'})),...Object.values(TYPE_PRESETS).map(item=>({...item,origin:'preset'}))];
  $('catalog').replaceChildren(new Option('Custom item / 自訂',''),...state.catalog.map((item,i)=>new Option(item.origin==='ta'?`TA · ${item.name} · ${item.unit} · ${item.interval}s`:`Preset · ${item.name} · ${item.unit}`,String(i))));
  $('retrain').hidden=state.role!=='ta';$('clearLocal').hidden=state.mode!=='local';
  for(const id of ['train','retrain','csvFile','exportForecast'])$(id).disabled=state.mode==='local';
}
function fillItem(item,decimals){
  for(const key of ['name','unit','minimum','maximum'])$(key).value=item[key]??'';
  $('itemKey').value=item.item_key;$('rate').value=item.max_rate??'';
  // undefined: preset default; null: Auto (a value read without a point must not force decimals).
  const places=decimals===undefined?item.decimals:decimals;$('decimals').value=places==null||places>3?'':String(places);
  if(item.origin==='ta')$('interval').value=item.interval;
}
$('catalog').onchange=()=>{const item=state.catalog[$('catalog').value];if(item)fillItem(item);};
if(!location.hostname.endsWith('github.io'))$('server').value=location.origin;
async function useLocal(message){
  pause();clearTimeout(pollTimer);
  let saved=null;try{saved=JSON.parse(localStorage.getItem('read-predict-local-ui')||'null');}catch{}
  Object.assign(state,{mode:'local',token:'',role:'local',offset:0,rois:saved?.rois||[],selected:saved?.selected||''});
  await refreshChannels();
  $('modeTag').textContent='Local mode / 本機模式';
  $('connectionState').textContent=message||'Local mode · 資料只存在這支手機的瀏覽器，不做預測；可匯出 CSV 核對。需要預測時在上方連線 Colab 後端。';
  notice('');poll();
}
$('localMode').onclick=guarded(()=>useLocal());
$('connectForm').onsubmit=guarded(async e=>{
  e.preventDefault();pause();clearTimeout(pollTimer);
  const url=new URL($('server').value.trim());
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Use HTTPS for the class server.');
  Object.assign(state,{mode:'server',base:url.origin,token:''});
  const start=Date.now()/1000;let result;
  try{result=await api('/api/sessions',{method:'POST',body:{code:$('code').value}});}catch(error){await useLocal();throw error;}
  state.offset=result.server_time-(start+Date.now()/1000)/2;state.token=result.token;state.role=result.role;state.rois=state.rois.map(({channel,...r})=>r);state.selected='';$('code').value='';
  await refreshChannels();$('modeTag').textContent=`Server / ${url.host}`;
  $('connectionState').textContent=`Connected as ${state.role==='ta'?'TA':'Student'} · Private readings, shared models`;$('connectionDetails').open=false;notice('');poll();
});
$('channelForm').onsubmit=guarded(async e=>{
  e.preventDefault();
  if(state.running)throw Error('Pause before creating a channel.');
  const spec={name:$('name').value,item_key:$('itemKey').value,unit:$('unit').value,interval:+$('interval').value,minimum:+$('minimum').value,maximum:+$('maximum').value,decimals:$('decimals').value===''?null:+$('decimals').value,max_rate:$('rate').value?+$('rate').value:null,source:$('source').value};
  if(spec.source==='ocr'&&state.rois[state.roi]?.channel)throw Error('Add or select an unlinked ROI first.');
  const channel=await api('/api/channels',{method:'POST',body:spec});state.selected=channel.id;
  if(spec.source==='ocr'){if(!state.rois.length)addROI();state.rois[state.roi].channel=channel.id;}
  await refreshChannels();await refresh();notice('');
});
$('channels').onchange=guarded(async()=>{state.selected=$('channels').value;const i=state.rois.findIndex(r=>r.channel===state.selected);if(i>=0)state.roi=i;persist();await refresh();});
async function openCamera(){
  pause();tracker.reset();state.trackingResult=null;state.candidates=[];if(state.stream)state.stream.getTracks().forEach(t=>t.stop());
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera needs HTTPS or localhost.');
  state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:state.facing},width:{ideal:1920},height:{ideal:1080}},audio:false});
  $('video').srcObject=state.stream;await $('video').play();
  const width=Math.min(1920,$('video').videoWidth);canvas.width=width;canvas.height=Math.round(width*$('video').videoHeight/$('video').videoWidth);
  $('cameraHint').hidden=true;$('cameraState').textContent='Camera on';cancelAnimationFrame(raf);renderCamera();
  await detectRegions();
}
$('camera').onclick=guarded(openCamera);$('switch').onclick=guarded(async()=>{state.facing=state.facing==='environment'?'user':'environment';await openCamera();});
let lastTrack=0,lastCameraPaint=-Infinity;
function renderCamera(timestamp=0){
  if(timestamp-lastCameraPaint<65){raf=requestAnimationFrame(renderCamera);return;}lastCameraPaint=timestamp;
  if(state.stream){ctx.drawImage($('video'),0,0,canvas.width,canvas.height);const font=`${Math.max(15,Math.round(canvas.width/42))}px sans-serif`;
    // Continuous frame-to-frame tracking keeps each step small while the hand shakes.
    if(state.running&&state.trackingMode==='handheld'&&timestamp-lastTrack>180){lastTrack=timestamp;try{state.trackingResult=tracker.track($('video'));}catch{}}
    if(!state.running){ctx.setLineDash([8,6]);(state.candidates||[]).forEach((r,i)=>{ctx.strokeStyle='#FF9E64';ctx.lineWidth=2;ctx.strokeRect(r.x*canvas.width,r.y*canvas.height,r.w*canvas.width,r.h*canvas.height);ctx.fillStyle='#FF9E64';ctx.font=font;ctx.fillText(`${i+1} ${r.type?.name??''} ${r.text}`,r.x*canvas.width,r.y*canvas.height-4);});ctx.setLineDash([]);}
    const lost=state.running&&state.trackingMode==='handheld'&&!state.trackingResult?.ok;
    state.rois.forEach((r,i)=>{const points=roiPolygon(r,state.running&&state.trackingResult?.ok?state.trackingResult.h:undefined);ctx.strokeStyle=lost?'#FF7B72':i===state.roi?'#3FCFA5':'#58A6FF';ctx.lineWidth=3;ctx.beginPath();points.forEach((p,j)=>j?ctx.lineTo(p.x*canvas.width,p.y*canvas.height):ctx.moveTo(p.x*canvas.width,p.y*canvas.height));ctx.closePath();ctx.stroke();ctx.fillStyle=ctx.strokeStyle;if(!state.running)ctx.fillRect(points[2].x*canvas.width-12,points[2].y*canvas.height-12,12,12);ctx.font=font;const name=state.channels.find(c=>c.id===r.channel)?.name;ctx.fillText(`${i+1}${name?' · '+name:''}`,points[0].x*canvas.width+5,points[0].y*canvas.height-6);});}
  raf=requestAnimationFrame(renderCamera);
}
function addROI(box){if(state.running)throw Error('Pause before editing a ROI.');if(state.rois.length>=3)throw Error('Maximum 3 regions.');state.rois.push(box||{x:.32,y:.43,w:.36,h:.14});state.roi=state.rois.length-1;persist();}
$('addROI').onclick=guarded(()=>addROI());$('removeROI').onclick=guarded(()=>{if(state.running)throw Error('Pause first.');state.rois.splice(state.roi,1);state.roi=Math.max(0,state.roi-1);persist();});
$('linkROI').onclick=guarded(()=>{if(state.running)throw Error('Pause first.');if(selected()?.source!=='ocr'||!state.rois[state.roi])throw Error('Select a camera channel and a ROI.');if(state.rois[state.roi].channel&&state.rois[state.roi].channel!==state.selected)throw Error('This ROI belongs to another channel.');state.rois.forEach(r=>{if(r.channel===state.selected)delete r.channel;});state.rois[state.roi].channel=state.selected;persist();notice('ROI linked to '+selected().name);});
let drag=null;
function pointer(e){const r=canvas.getBoundingClientRect(),scale=Math.min(r.width/canvas.width,r.height/canvas.height),w=canvas.width*scale,h=canvas.height*scale;return {x:(e.clientX-r.left-(r.width-w)/2)/w,y:(e.clientY-r.top-(r.height-h)/2)/h};}
canvas.onpointerdown=e=>{if(state.running||state.detecting)return;const p=pointer(e);for(let i=state.rois.length-1;i>=0;i--){const r=state.rois[i];if(p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h){state.roi=i;drag={p,original:{...r},resize:p.x>r.x+r.w-.04&&p.y>r.y+r.h-.04};canvas.setPointerCapture(e.pointerId);return;}}const box=(state.candidates||[]).find(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h);if(box)guarded(async()=>selectCandidate(box))();};
canvas.onpointermove=e=>{if(!drag)return;const p=pointer(e),r=state.rois[state.roi],o=drag.original;if(drag.resize){r.w=Math.max(.04,Math.min(1-o.x,o.w+p.x-drag.p.x));r.h=Math.max(.04,Math.min(1-o.y,o.h+p.y-drag.p.y));}else{r.x=Math.max(0,Math.min(1-r.w,o.x+p.x-drag.p.x));r.y=Math.max(0,Math.min(1-r.h,o.y+p.y-drag.p.y));}};
canvas.onpointerup=()=>{drag=null;persist();};canvas.onpointercancel=()=>{drag=null;};
function frame(){if(!state.stream)throw Error('Open your camera first.');const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;c.getContext('2d').drawImage($('video'),0,0,c.width,c.height);return c;}
function nextVideoFrame(){const video=$('video');return Promise.race([sleep(90),new Promise(r=>video.requestVideoFrameCallback?video.requestVideoFrameCallback(()=>r()):setTimeout(r,40))]);}
/* Of two consecutive camera frames, OCR the one with the sharper ROI (less motion blur). */
async function sharpestFrame(roi){
  const polygon=roiPolygon(roi,state.trackingResult?.ok?state.trackingResult.h:undefined);let best=null,score=-1;
  for(let k=0;k<2;k++){if(k)await nextVideoFrame();const shot=frame(),s=sharpness(shot,polygon);if(s>score){best=shot;score=s;}}
  return best;
}
function showType(type,source){
  $('typeHint').textContent=type?`偵測到項目：${type.name}（${type.unit}）· ${source}。已填入資料設定，確認後按 Create channel。`:`未辨識出項目類型（${source}）；請選 Item presets 或手動填寫。`;
}
function selectCandidate(box){
  if(state.running||state.detecting)return;
  const roi={x:box.x,y:box.y,w:box.w,h:box.h};
  if(state.rois[state.roi]&&!state.rois[state.roi].channel)state.rois[state.roi]={...state.rois[state.roi],...roi};else addROI(roi);
  persist();$('cameraStatus').textContent='候選框已選取，可拖曳調整';
  if(box.type){fillItem(box.type,box.decimals>0?box.decimals:null);$('source').value='ocr';}
  showType(box.type,`讀到「${box.rawText}」${box.label?'，附近標籤「'+box.label+'」':''}`);
}
async function detectRegions(){if(state.running||state.detecting)return;state.detecting=true;$('start').disabled=true;freezeCamera(true);try{state.candidates=await localOCR.detect(frame());$('candidateChoices').replaceChildren(...state.candidates.map((box,i)=>{const button=document.createElement('button');button.className='quiet';button.textContent=`${i+1} · ${box.type?.name??'數值'} ${box.text}${box.unit?' '+box.unit:''}`;button.onclick=guarded(async()=>selectCandidate(box));return button;}));$('cameraStatus').textContent=state.candidates.length?`點選虛線候選框（${state.candidates.length} 個）`:'未找到數值；請手動調框';}finally{state.detecting=false;$('start').disabled=false;freezeCamera(false);}}
$('detect').onclick=guarded(detectRegions);
/* One read of the active ROI before starting: shows raw OCR, decision and item type. */
$('testRead').onclick=guarded(async()=>{
  if(state.running||state.detecting)throw Error('Pause first.');const roi=state.rois[state.roi];if(!roi)throw Error('Add or select a ROI first.');
  state.detecting=true;freezeCamera(true);
  try{
    // Same wide search margin as the ROI fit at Start.
    const crop=alignedCrop(await sharpestFrame(roi),roi,undefined,{pad:.5}),r=await localOCR.readROI(crop.canvas,crop.inner,{mode:$('ocrPreprocess').value,labels:true});
    const linked=state.channels.find(c=>c.id===roi.channel),spec=linked||{decimals:$('decimals').value===''?null:+$('decimals').value,unit:$('unit').value};
    const assessed=assessReading(r,spec),type=inferType(r,r.nearby);
    $('cameraReading').textContent=r.rawText||'(空白)';
    $('cameraReadingStatus').textContent=`試讀 → ${assessed.text||'—'}${r.unit?' '+r.unit:''} · ${label(assessed.status)} · 信心 ${Math.round(r.confidence*100)}% · ${Math.round(r.milliseconds)} ms`;
    if(!linked&&type)fillItem(type,decimalsOf(assessed.text)||null);
    showType(type,`框內讀到「${r.rawText||'—'}」${r.nearby.length?'，附近「'+r.nearby.join(' ')+'」':''}`);
  }finally{state.detecting=false;freezeCamera(false);}
});
/* At Start the hand may have moved since the ROI was drawn: fit each OCR ROI to
   the numeric text row in the reference frame (ROI + 50% search margin). */
async function snapROIs(shot){
  for(const roi of state.rois.filter(r=>state.channels.some(c=>c.id===r.channel&&c.source==='ocr'))){
    const crop=alignedCrop(shot,roi,undefined,{pad:.5}),row=await localOCR.locate(crop.canvas,crop.inner);if(!row)continue;
    const e=crop.region,sx=e.w/crop.canvas.width,sy=e.h/crop.canvas.height,m=row.h*.12;
    const x=Math.max(0,e.x+(row.x-m)*sx),y=Math.max(0,e.y+(row.y-m)*sy);
    Object.assign(roi,{x,y,w:Math.min(1,e.x+(row.x+row.w+m)*sx)-x,h:Math.min(1,e.y+(row.y+row.h+m)*sy)-y});
  }
  persist();
}
function showTrackingLost(reason){$('cameraReading').textContent='—';$('cameraReadingStatus').textContent=`TRACKING_ERROR · ${reason}`;$('liveStatus').textContent='TRACKING_ERROR · 已停收，重新對準原面板即可恢復';$('monitorState').textContent='TRACKING_ERROR · 重新對準原面板可恢復';}
async function sample(channel,generation){
  const event_id=crypto.randomUUID().replaceAll('-',''),captured_at=now();
  if(channel.source==='simulation'){
    const span=channel.maximum-channel.minimum,v=(channel.maximum+channel.minimum)/2+span*.1*Math.sin((captured_at-channel.epoch)/40);
    return api(`/api/channels/${channel.id}/observations`,{method:'POST',body:{event_id,captured_at,readings:[{text:v.toFixed(channel.decimals??2),confidence:1}],tracking:'fixed'}});
  }
  const roi=state.rois.find(r=>r.channel===channel.id);if(!roi)throw Error(`No ROI for ${channel.name}. Select its ROI and press Link ROI.`);
  const handheld=state.trackingMode==='handheld',count=+$('ocrBurst').value,start=performance.now(),readings=[],seen=[];let trackingConfidence=1,line=null;
  for(let i=0;i<count;i++){
    const shot=await sharpestFrame(roi);let result=null;
    if(handheld){
      result=tracker.track(shot);state.trackingResult=result;
      $('cameraStatus').textContent=result.ok?`補正 ${Math.round(result.confidence*100)}%${result.mode==='relocated'?' · 已重新定位':''}`:`停收：${result.reason}`;
      if(!result.ok){showTrackingLost(result.reason);return api(`/api/channels/${channel.id}/client-ocr`,{method:'POST',body:{event_id,captured_at,readings:[],tracking:'lost'}});}
      trackingConfidence=Math.min(trackingConfidence,result.confidence);
    }
    const crop=alignedCrop(shot,roi,result?.h,{cv:tracker.cv});
    // Burst frames are aligned to the same reference, so the text row found in the first is reused.
    const r=await localOCR.readROI(crop.canvas,crop.inner,{mode:$('ocrPreprocess').value,line});line??=r.line;
    if(!state.running||generation!==state.generation)return null;
    const assessed=assessReading(r,channel);readings.push(wireReading(r,assessed));seen.push({r,assessed});
    if(i<count-1)await sleep(60);
  }
  const last=seen.at(-1);
  $('cameraReading').textContent=last.r.rawText||'(空白)';
  $('cameraReadingStatus').textContent=`${channel.name} · ${seen.map(x=>x.assessed.text||'—').join(' / ')} · 信心 ${Math.round(last.r.confidence*100)}%`;
  $('browserOcrState').textContent=`手機 OCR ${(performance.now()-start).toFixed(0)} ms · ${seen.map(x=>`${x.r.rawText||'(空白)'}→${label(x.assessed.status)}`).join(' / ')}`;
  return api(`/api/channels/${channel.id}/client-ocr`,{method:'POST',body:{event_id,captured_at,readings,tracking:handheld?'verified':'fixed',tracking_confidence:handheld?trackingConfidence:null}});
}
async function monitor(generation){
  while(state.running&&generation===state.generation){
    for(const channel of state.channels.filter(c=>['ocr','simulation'].includes(c.source))){
      if(!state.running||generation!==state.generation)break;
      const t=now(),tick=Math.round((t-channel.epoch)/channel.interval),target=channel.epoch+tick*channel.interval;
      if(t>=target&&t-target<channel.interval*.3&&tick>(state.next.get(channel.id)??-Infinity)){
        state.next.set(channel.id,tick);
        try{const result=await sample(channel,generation);if(result){const text=`${channel.name}: ${result.value??'—'} · ${label(result.status)}`;$('monitorState').textContent=text;$('liveStatus').textContent=text;if(channel.source==='ocr'&&result.status!=='TRACKING_ERROR')$('cameraReadingStatus').textContent=`${channel.name} → ${result.value??'—'} ${channel.unit} · ${label(result.status)}`;if(state.mode==='local'&&channel.id===state.selected)refresh().catch(()=>{});}}
        catch(error){notice(error.message);}
      }
    }
    await sleep(80);
  }
}
$('start').onclick=guarded(async()=>{
  if(!state.channels.some(c=>['ocr','simulation'].includes(c.source)))throw Error('Create a Camera OCR or Simulation channel first.');
  if(state.channels.some(c=>c.source==='ocr')&&!state.stream)throw Error('Open camera first.');
  if(state.running||state.starting||state.detecting)return;state.starting=true;$('start').disabled=true;freezeCamera(true);
  try{
    state.trackingMode=$('tracking').value;state.trackingResult=null;
    if(state.channels.some(c=>c.source==='ocr')){
      await localOCR.initialize();
      const reference=frame();await snapROIs(reference);
      if(state.trackingMode==='handheld'){await tracker.initialize();tracker.setReference(reference,state.rois);state.trackingResult=tracker.track(frame());if(!state.trackingResult.ok)throw Error('Tracking：'+state.trackingResult.reason);}
    }
    if(document.hidden)throw Error('Return to the foreground before starting.');
    state.running=true;const generation=++state.generation;$('stop').disabled=false;$('livePause').disabled=false;$('captureSettings').open=false;$('connectionDetails').open=false;document.body.classList.add('focus');$('focusMode').textContent='Settings / 設定';window.scrollTo({top:0,behavior:'instant'});
    navigator.wakeLock?.request('screen').then(lock=>{if(state.running)wakeLock=lock;else lock.release();}).catch(()=>{});notice('');monitor(generation);
  }finally{state.starting=false;if(!state.running){$('start').disabled=false;freezeCamera(false);}}
});
function pause(){freezeCamera(false);state.running=false;state.generation++;$('start').disabled=false;$('stop').disabled=true;$('livePause').disabled=true;$('monitorState').textContent='Paused · 暫停收集';$('liveStatus').textContent='Paused · 暫停收集';wakeLock?.release();wakeLock=null;}
$('livePause').onclick=pause;
$('stop').onclick=pause;document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
$('submitValue').onclick=guarded(async()=>{const c=selected();if(c?.source!=='manual')throw Error('Select a Manual channel.');const tick=Math.round((now()-c.epoch)/c.interval);const t=c.epoch+tick*c.interval;if(t>now()+2)throw Error('Wait for the next sample time.');await api(`/api/channels/${c.id}/observations`,{method:'POST',body:{event_id:crypto.randomUUID().replaceAll('-',''),captured_at:t,readings:[{text:$('manualValue').value,confidence:1}]}});await refresh();});
function rawOCR(row){let raw=row.raw;if(typeof raw==='string')try{raw=JSON.parse(raw);}catch{raw=null;}if(raw?.tracking==='lost')return '(tracking lost)';return raw?.readings?.map(x=>x.raw_text??x.text).join(' / ')||'—';}
function render(snapshot){
  const {channel,observations,metrics,models}=snapshot,last=observations.at(-1);
  $('latest').textContent=last?.value==null?'—':Number(last.value).toFixed(channel.decimals??2);$('latestUnit').textContent=channel.unit;$('quality').textContent=last?label(last.status):'Waiting for data';$('sampleCount').textContent=last?`${Math.max(0,Math.round(now()-last.captured_at))}s ago · ${observations.length} points · ${observations.filter(o=>o.value!=null).length} valid`:'0 points';$('sourceTag').textContent=channel.source==='simulation'?'SIMULATION / 模擬':channel.source.toUpperCase();
  $('modelState').textContent=models.local?`Local mode / 本機模式：只收集與檢查讀值，不做預測。\nConnect the Colab backend for Kalman / Chronos-2 / RNN / LSTM forecasts.${models.saveError?`\n⚠ 無法儲存到手機（${models.saveError}）：請匯出 CSV。`:''}`:`Chronos-2: ${models.chronos}${models.chronos_error?' / '+models.chronos_error:''}\nShared RNN / LSTM [${channel.item_key}]: ${models.training.state}\n${models.training.points?`Training points: ${models.training.points} · Created by: ${models.training.trained_by}`:`Your consecutive points: ${models.training_quality.points} / 180 minimum`}\n${models.training.models?Object.entries(models.training.models).map(([k,v])=>`${k}: ${v.state} · validation MAE ${v.validation_mae.toPrecision(3)}`).join('\n'):''}\nPending: ${models.pending} · Last batch: ${models.last_batch_seconds?.toFixed(2)??'—'} s`;
  $('metrics').replaceChildren();if(!metrics.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent=models.local?'Local mode: no forecasts. 本機模式不做預測。':'Waiting for matching observations.';tr.append(td);$('metrics').append(tr);}
  for(const m of metrics){const tr=document.createElement('tr');for(const val of [m.model,m.mae,m.rmse,m.smape,m.n]){const td=document.createElement('td');td.textContent=val==null?'—':typeof val==='number'&&!Number.isInteger(val)?val.toFixed(3):String(val);tr.append(td);}$('metrics').append(tr);}
  $('readings').replaceChildren();for(const r of observations.slice(-20).reverse()){const tr=document.createElement('tr');for(const val of [new Date(r.captured_at*1000).toLocaleTimeString(),rawOCR(r),r.value??'—',label(r.status)]){const td=document.createElement('td');td.textContent=String(val);tr.append(td);}$('readings').append(tr);}
  const names=['Observed',...new Set(snapshot.forecasts.map(f=>f.model))];$('legend').replaceChildren();
  for(const name of names){const item=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=!state.hidden.has(name);input.onchange=()=>{input.checked?state.hidden.delete(name):state.hidden.add(name);plot();};item.append(input,document.createTextNode(name));$('legend').append(item);}plot();
}
function plot(){if(state.snapshot)drawChart($('chart'),state.snapshot,{count:+$('view').value,historical:$('historical').checked,hidden:state.hidden,horizon:+$('horizon').value});}
async function refresh(){if(!state.selected)return;if(state.mode==='server'&&!state.token)return;state.snapshot=await api(`/api/channels/${state.selected}/snapshot?horizon=${$('horizon').value}&common=${$('common').checked}`);render(state.snapshot);}
async function poll(){clearTimeout(pollTimer);try{await refresh();}catch(e){notice(e.message);}if(state.mode==='local'||state.token)pollTimer=setTimeout(poll,2000);}
for(let i=1;i<=10;i++){const option=document.createElement('option');option.value=i;option.textContent=`H${i}`;$('horizon').append(option);}
for(const id of ['horizon','common'])$(id).onchange=guarded(refresh);for(const id of ['view','historical'])$(id).onchange=plot;
$('train').onclick=guarded(async()=>{if(!state.selected)throw Error('Select a channel.');await api(`/api/channels/${state.selected}/train`,{method:'POST'});await refresh();});
$('retrain').onclick=guarded(async()=>{if(!state.selected)throw Error('Select a channel.');await api(`/api/channels/${state.selected}/train?retrain=true`,{method:'POST'});await refresh();});
$('csvFile').onchange=guarded(async()=>{const file=$('csvFile').files[0];if(!file)return;if(file.size>1000000)throw Error('CSV must be under 1 MB.');await api(`/api/channels/${state.selected}/import`,{method:'POST',body:{csv:await file.text()}});await refreshChannels();await refresh();$('csvFile').value='';});
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function download(kind){
  if(!state.selected)throw Error('Select a channel.');
  const c=selected(),stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  if(state.mode==='local'){save(new Blob([local.csv(state.selected)],{type:'text/csv;charset=utf-8'}),`${c.item_key}-readings-${stamp}.csv`);return;}
  const response=await fetch(state.base+`/api/channels/${state.selected}/export?kind=${kind}`,{headers:{Authorization:'Bearer '+state.token}});if(!response.ok)throw Error('Export failed. Reconnect and retry.');save(await response.blob(),`${kind}.csv`);
}
$('export').onclick=guarded(()=>download('observations'));$('exportForecast').onclick=guarded(()=>download('forecasts'));
$('clearLocal').onclick=guarded(async()=>{if(state.running)throw Error('Pause first.');if(!confirm('Delete all local channels and readings on this phone? 確定刪除本機所有通道與讀值？（建議先匯出 CSV）'))return;local.clear();state.rois.forEach(r=>delete r.channel);state.selected='';state.snapshot=null;await refreshChannels();$('readings').replaceChildren();$('latest').textContent='—';drawChart($('chart'),{observations:[],forecasts:[],channel:{}},{});});
$('theme').onclick=()=>{document.body.classList.toggle('dark');plot();};new ResizeObserver(plot).observe($('chart'));
$('focusMode').onclick=()=>{if(document.body.classList.contains('focus')&&state.running)pause();document.body.classList.toggle('focus');$('focusMode').textContent=document.body.classList.contains('focus')?'Settings / 設定':'Focus view / 專注模式';if(!document.body.classList.contains('focus'))$('captureSettings').open=true;window.scrollTo({top:0,behavior:'instant'});};
window.addEventListener('beforeunload',()=>{pause();state.stream?.getTracks().forEach(t=>t.stop());});
try{
  const saved=JSON.parse(sessionStorage.getItem('read-predict')||'null');
  if(saved?.mode==='server'&&saved.token){Object.assign(state,saved);$('server').value=state.base;const start=Date.now()/1000;const health=await api('/api/health');state.offset=health.server_time-(start+Date.now()/1000)/2;await refreshChannels();$('modeTag').textContent=`Server / ${new URL(state.base).host}`;$('connectionState').textContent='Session restored · 工作階段已恢復';$('connectionDetails').open=false;poll();}
  else await useLocal();
}catch(e){notice('Server session ended: '+e.message);await useLocal();}
