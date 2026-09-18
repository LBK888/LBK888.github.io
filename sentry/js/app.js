import { DEFAULTS, deviceId } from './config.js';
import { all, clear, get, openDb, put, remove, saveAlert, touchEvent } from './db.js';
import { FaceAI, bestMatch, meanEmbedding, qualityOkay } from './ai.js';
import { FaceTracker } from './tracker.js';
import { createAlert } from './alert.js';
import { OutboxWorker } from './outbox.js';
import { MIN_SAMPLES, MAX_SAMPLES, collectSample, finishIfFaceLost, suggestedName } from './enrollment.js';

const $ = id => document.getElementById(id);
const video = $('camera'), overlay = $('overlay'), ctx = overlay.getContext('2d');
const ai = new FaceAI();
let settings = { ...DEFAULTS }, persons = [], tracker, worker;
let running = false, stream, wakeLock, registration = null;
let frameTimes = [], selectedTrack = null, pendingCount = 0;
let objectUrls = [];
let lastStatusDraw = 0;

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}

function dot(id, state) {
  $(id).className = `dot ${state}`;
}

function status() {
  $('modeBadge').querySelector('span:last-child').textContent = running ? '監控中' : '待命中';
  $('modeBadge').querySelector('.status-dot').classList.toggle('active', running);
  $('cameraState').textContent = running ? '開啟' : '待命'; dot('cameraDot', running ? 'good' : '');
  $('aiState').textContent = ai.backend; dot('aiDot', ai.detector ? 'good' : '');
  $('networkState').textContent = navigator.onLine ? 'ONLINE' : 'OFFLINE'; dot('networkDot', navigator.onLine ? 'good' : 'bad');
  $('backendState').textContent = worker?.backend || '尚未測試'; dot('backendDot', worker?.backend === 'ONLINE' ? 'good' : worker?.backend === 'OFFLINE' ? 'bad' : '');
  $('debugBackend').textContent = ai.backend;
  $('debugDetectorMs').textContent = ai.detector ? `${ai.detectorMs.toFixed(1)} ms` : '—';
  $('debugRecognizerMs').textContent = ai.recognizer ? `${ai.recognizerMs.toFixed(1)} ms` : '—';
  $('debugAiFps').textContent = $('aiFps').textContent;
  $('debugCamera').textContent = running ? `${video.videoWidth} × ${video.videoHeight}` : '—';
  $('debugWake').textContent = wakeLock ? 'ACTIVE' : ('wakeLock' in navigator ? 'INACTIVE' : 'UNSUPPORTED');
  $('debugInternet').textContent = navigator.onLine ? 'ONLINE' : 'OFFLINE';
  $('debugN8n').textContent = worker?.backend || 'UNKNOWN';
  $('debugOutbox').textContent = pendingCount;
  $('pendingCount').textContent = pendingCount;
  $('debugThreshold').textContent = settings.recognitionThreshold.toFixed(2);
  const tracks = tracker?.tracks || [];
  const visible = tracks.filter(t => Date.now() - t.lastSeen < settings.lostGraceMs);
  $('faceCount').textContent = visible.length;
  $('knownCount').textContent = visible.filter(t => t.status === 'KNOWN').length;
  $('unknownCount').textContent = visible.filter(t => t.status === 'UNKNOWN_PENDING' || t.status === 'ALERTED').length;
  const face = selectedTrack && visible.includes(selectedTrack) ? selectedTrack : visible[0];
  $('debugTrack').textContent = face?.id || '—';
  $('debugDet').textContent = face ? face.detectionScore.toFixed(3) : '—';
  $('debugSim').textContent = face && face.similarity >= 0 ? face.similarity.toFixed(3) : '—';
  $('debugStatus').textContent = face?.status || '—';
  $('debugTimer').textContent = face?.unknownSince ? `${Math.min((Date.now() - face.unknownSince) / 1000, settings.alertDelayMs / 1000).toFixed(1)} / ${(settings.alertDelayMs / 1000).toFixed(1)} s` : '—';
}

function projection() {
  const width = overlay.clientWidth, height = overlay.clientHeight;
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  return { scale, x: (width - video.videoWidth * scale) / 2, y: (height - video.videoHeight * scale) / 2 };
}

function draw() {
  if (!running) return;
  const ratio = devicePixelRatio || 1;
  const width = overlay.clientWidth, height = overlay.clientHeight;
  if (overlay.width !== Math.round(width * ratio) || overlay.height !== Math.round(height * ratio)) {
    overlay.width = Math.round(width * ratio); overlay.height = Math.round(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (video.videoWidth) {
    const p = projection();
    for (const face of tracker.tracks) {
      if (Date.now() - face.lastSeen > settings.lostGraceMs) continue;
      const [x1, y1, x2, y2] = face.bbox;
      const x = p.x + x1 * p.scale, y = p.y + y1 * p.scale;
      const w = (x2 - x1) * p.scale, h = (y2 - y1) * p.scale;
      const color = face.status === 'KNOWN' ? '#3FCFA5' : face.status === 'ALERTED' ? '#FF7B72' : face.status === 'UNKNOWN_PENDING' ? '#F7C948' : '#58A6FF';
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.strokeRect(x, y, w, h);
      const title = face.person?.name || (face.status === 'DETECTING' ? '辨識中' : `UNKNOWN #${face.id}`);
      const det = `DET ${face.detectionScore.toFixed(2)}`;
      const sim = `SIM ${face.similarity >= 0 ? face.similarity.toFixed(2) : '—'}`;
      const timer = face.unknownSince && !face.person ? `  ${Math.min((Date.now() - face.unknownSince) / 1000, settings.alertDelayMs / 1000).toFixed(1)} / ${(settings.alertDelayMs / 1000).toFixed(1)}s` : '';
      ctx.font = 'bold 12px sans-serif';
      const labelWidth = Math.min(width - Math.max(0, x), Math.max(130, ctx.measureText(title).width + 16));
      const labelY = y > 51 ? y - 47 : y;
      ctx.fillStyle = color; ctx.fillRect(x, labelY, labelWidth, 46);
      ctx.fillStyle = '#07131c'; ctx.fillText(title, x + 7, labelY + 17, labelWidth - 12);
      ctx.font = '10px monospace'; ctx.fillText(`${det}  ${sim}${timer}`, x + 7, labelY + 34, Math.max(labelWidth - 12, 145));
    }
  }
  tracker.tick();
  if (performance.now() - lastStatusDraw > 250) { status(); lastStatusDraw = performance.now(); }
  requestAnimationFrame(draw);
}

function targetFps() {
  if (settings.detectorFps !== 'AUTO') return Number(settings.detectorFps);
  if (settings.performanceMode === 'QUALITY') return 10;
  if (settings.performanceMode === 'BATTERY') return 3;
  const total = ai.detectorMs + ai.recognizerMs;
  return total > 200 ? 3 : total > 100 ? 6 : 10;
}

function updateRegistrationUi() {
  if (!registration) return;
  const count = registration.samples.length;
  $('sampleCount').textContent = `${count} / ${MAX_SAMPLES}`;
  $('sampleProgress').value = count;
  $('savePersonBtn').disabled = count < MIN_SAMPLES;
  $('registerHint').textContent = registration.complete
    ? `取樣已結束，使用 ${count} 筆樣本即可登錄。`
    : count >= MIN_SAMPLES
      ? '已可登錄；也可繼續收集至 20 筆，離開鏡頭後會結束取樣。'
      : '請稍微轉動頭部，保持臉部清晰（至少 5 筆）。';
}

async function aiLoop() {
  while (running) {
    const began = performance.now();
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const detections = await ai.detect(video, settings.detectionThreshold);
        const detectedAt = Date.now();
        const tracks = tracker.update(detections, detectedAt);
        if (finishIfFaceLost(registration, tracks)) {
          if (registration.complete) updateRegistrationUi();
          else $('registerHint').textContent = '人臉訊號中斷，樣本不足 5 筆；請取消後重新點選人臉。';
        }
        for (const track of tracks) {
          if (track.lastSeen !== detectedAt) continue;
          if (!running || Date.now() - track.lastRecognition < (settings.performanceMode === 'BATTERY' ? 500 : 250)) continue;
          if (track.bbox[2] - track.bbox[0] < 60) continue;
          const result = await ai.recognize(video, track);
          const match = bestMatch(result.embedding, persons, settings.recognitionThreshold);
          tracker.recognize(track, { embedding: result.embedding, ...match });
          if (registration?.track === track && !registration.complete && qualityOkay(result.aligned, track)
            && collectSample(registration, result.embedding, Date.now())) {
            $('facePreview').getContext('2d').drawImage(result.aligned, 0, 0);
            updateRegistrationUi();
          }
        }
        const done = performance.now();
        frameTimes.push(done); frameTimes = frameTimes.filter(t => done - t < 2000);
        $('aiFps').textContent = (frameTimes.length / 2).toFixed(1);
        $('cameraFps').textContent = `${(frameTimes.length / 2).toFixed(1)} AI FPS`;
      }
    } catch (error) {
      if (ai.backend === 'WebGPU') {
        try { await ai.loadProvider('wasm', undefined, message => notice(`WebGPU 失敗，${message}`)); continue; }
        catch (fallbackError) { error = fallbackError; }
      }
      notice(`AI 推論失敗：${error.message}`, true);
      await stop(); break;
    }
    const remaining = Math.max(0, 1000 / targetFps() - (performance.now() - began));
    if (remaining) await new Promise(resolve => setTimeout(resolve, remaining));
  }
}

async function acquireWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
    $('wakeStatus').textContent = wakeLock ? 'Wake Lock 啟用' : 'Wake Lock 不支援';
  } catch { $('wakeStatus').textContent = 'Wake Lock 無法啟用'; }
}

async function start() {
  if (running) return;
  if (!isSecureContext) { notice('相機需要 HTTPS 或 localhost。', true); return; }
  $('startBtn').disabled = true;
  try {
    notice('正在開啟相機…');
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
    video.srcObject = stream;
    await video.play();
    $('cameraPlaceholder').classList.add('hidden');
    $('cameraResolution').textContent = `${video.videoWidth} × ${video.videoHeight}`;
    notice('正在載入本機 AI 模型…');
    if (!ai.detector) await ai.init(message => notice(message));
    running = true;
    tracker = new FaceTracker(settings, onAlert, onActivity);
    tracker.restore(await all('events'));
    frameTimes = [];
    $('stopBtn').disabled = false;
    $('cameraHint').textContent = '黃色人臉框可點選登錄合法人物';
    notice('監控中。AI 辨識在手機執行。');
    await acquireWakeLock();
    requestAnimationFrame(draw);
    void aiLoop();
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    $('cameraPlaceholder').classList.remove('hidden');
    notice(`無法啟動：${error.message}`, true);
  } finally { $('startBtn').disabled = running; status(); }
}

async function stop() {
  running = false;
  tracker?.flushActivity();
  stream?.getTracks().forEach(track => track.stop());
  stream = null; video.srcObject = null;
  if (wakeLock) { try { await wakeLock.release(); } catch {} wakeLock = null; }
  $('cameraPlaceholder').classList.remove('hidden');
  $('cameraResolution').textContent = '— × —';
  $('startBtn').disabled = false; $('stopBtn').disabled = true;
  $('cameraHint').textContent = '點選「開始監控」並允許相機權限';
  if (registration) closeRegistration();
  notice('監控已停止。本機事件與待送通知仍保留。');
  status();
}

async function onAlert(track, at, record) {
  try {
    const event = await createAlert(video, track, settings, at);
    event.unknownEmbedding = record.embedding;
    event.lastSeenAt = Math.max(at, record.at);
    await saveAlert(event);
    record.eventId = event.eventId;
    notice(`陌生人物 ${track.id} 已記錄，通知進入待送佇列。`);
    await refreshLists();
    void worker.flush();
  } catch (error) { notice(`警報保存失敗：${error.message}`, true); }
}

async function onActivity(track, at, eventId) {
  try {
    if (await touchEvent(eventId, at) && !$('eventsPanel').classList.contains('hidden')) await refreshLists();
  } catch (error) { notice(`事件時間更新失敗：${error.message}`, true); }
}

function openRegistration(track) {
  if (!track || track.status === 'KNOWN') return;
  selectedTrack = track;
  registration = { track, samples: [], lastSample: 0, complete: false };
  $('personName').value = suggestedName(persons.map(person => person.name));
  updateRegistrationUi();
  $('registerDialog').showModal();
}

function closeRegistration() {
  registration = null;
  $('registerDialog').close();
}

async function savePerson() {
  const name = $('personName').value.trim();
  if (!name) { $('registerHint').textContent = '請輸入姓名。'; $('personName').focus(); return; }
  if (!registration || registration.samples.length < MIN_SAMPLES) return;
  const { track } = registration;
  const samples = registration.samples.slice();
  registration.complete = true;
  $('savePersonBtn').disabled = true;
  const person = { id: crypto.randomUUID(), name, embedding: meanEmbedding(samples), sampleCount: samples.length, createdAt: Date.now() };
  await put('persons', person);
  persons.push(person);
  if (tracker.tracks.includes(track)) tracker.recognize(track, { embedding: person.embedding, person, similarity: 1 });
  closeRegistration(); await refreshLists(); notice(`${name} 已儲存在此裝置。`);
}

async function refreshLists() {
  pendingCount = await worker.pendingCount(); status();
  const personList = $('personList'); personList.replaceChildren();
  if (!persons.length) personList.innerHTML = '<div class="empty-state">尚未登錄合法人物。</div>';
  for (const person of persons) {
    const item = document.createElement('div'); item.className = 'list-item';
    const icon = document.createElement('span'); icon.className = 'icon'; icon.textContent = person.name.slice(0, 1);
    const detail = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = person.name;
    const sub = document.createElement('small'); sub.textContent = `${person.sampleCount} 筆樣本 · ${new Date(person.createdAt).toLocaleString('zh-TW')}`;
    const del = document.createElement('button'); del.type = 'button'; del.textContent = '移除';
    del.onclick = async () => { if (!confirm(`移除 ${person.name}？`)) return; await remove('persons', person.id); persons = persons.filter(p => p.id !== person.id); await refreshLists(); };
    detail.append(title, sub); item.append(icon, detail, del); personList.append(item);
  }
  objectUrls.forEach(URL.revokeObjectURL); objectUrls = [];
  const events = (await all('events')).sort((a, b) => (b.lastSeenAt ?? b.alertAt) - (a.lastSeenAt ?? a.alertAt));
  const eventList = $('eventList'); eventList.replaceChildren();
  if (!events.length) eventList.innerHTML = '<div class="empty-state">尚無警報事件。</div>';
  for (const event of events.slice(0, 50)) {
    const item = document.createElement('div'); item.className = 'list-item';
    const image = document.createElement('img'); image.alt = '陌生人物警報截圖';
    const url = URL.createObjectURL(event.screenshotBlob); objectUrls.push(url); image.src = url;
    const detail = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `陌生人物 ${event.trackId}`;
    const sub = document.createElement('small'); sub.textContent = `初次警報 ${new Date(event.alertAt).toLocaleString('zh-TW')} · 最近出現 ${new Date(event.lastSeenAt ?? event.alertAt).toLocaleString('zh-TW')} · ${event.status} · DET ${event.detScore.toFixed(2)} / SIM ${event.maxKnownSimilarity.toFixed(2)}`;
    detail.append(title, sub); item.append(image, detail); eventList.append(item);
  }
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
  for (const key of ['debug', 'persons', 'events', 'settings']) $(`${key}Panel`).classList.toggle('hidden', key !== name);
  if (name === 'events') void refreshLists();
}

function fillSettings() {
  const form = $('settingsForm');
  for (const key of ['deviceName', 'webhookUrl', 'recognitionThreshold', 'detectionThreshold', 'performanceMode', 'detectorFps', 'screenshotMaxKb']) form.elements[key].value = settings[key];
  form.elements.alertDelaySec.value = settings.alertDelayMs / 1000;
  form.elements.lostGraceSec.value = settings.lostGraceMs / 1000;
  form.elements.cooldownSec.value = settings.cooldownMs / 1000;
  form.elements.sessionKey.value = sessionStorage.getItem('sentry-session-key') || '';
}

async function saveSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const url = form.elements.webhookUrl.value.trim().replace(/\/$/, '');
  if (!/^https:\/\//.test(url) && !/^http:\/\/localhost(?::\d+)?\//.test(url)) { notice('Webhook URL 必須使用 HTTPS。', true); return; }
  const next = {
    deviceName: form.elements.deviceName.value.trim(), webhookUrl: url,
    recognitionThreshold: Number(form.elements.recognitionThreshold.value),
    detectionThreshold: Number(form.elements.detectionThreshold.value),
    alertDelayMs: Number(form.elements.alertDelaySec.value) * 1000,
    lostGraceMs: Number(form.elements.lostGraceSec.value) * 1000,
    cooldownMs: Number(form.elements.cooldownSec.value) * 1000,
    screenshotMaxKb: Number(form.elements.screenshotMaxKb.value),
    performanceMode: form.elements.performanceMode.value,
    detectorFps: form.elements.detectorFps.value
  };
  settings = { ...settings, ...next }; if (tracker) tracker.settings = settings;
  await put('settings', { key: 'main', value: settings });
  sessionStorage.setItem('sentry-session-key', form.elements.sessionKey.value.trim());
  worker.backend = 'UNKNOWN';
  notice('設定已儲存。警報送達後會更新 n8n 狀態。'); status(); void worker.flush(true);
}

async function init() {
  await openDb();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  const stored = (await get('settings', 'main'))?.value;
  settings = { ...DEFAULTS, ...stored };
  if (stored && !stored.unknownMergeVersion) {
    if (stored.cooldownMs === 60000) settings.cooldownMs = DEFAULTS.cooldownMs;
    settings.unknownMergeVersion = 1;
    await put('settings', { key: 'main', value: settings });
  }
  persons = await all('persons');
  deviceId(); fillSettings();
  worker = new OutboxWorker(() => settings, () => void refreshLists()); worker.start();
  await refreshLists(); status();
  if (!localStorage.getItem('sentry-privacy-accepted')) $('privacyDialog').showModal();
  $('acceptPrivacyBtn').onclick = () => { localStorage.setItem('sentry-privacy-accepted', '1'); $('privacyDialog').close(); };
  $('startBtn').onclick = start; $('stopBtn').onclick = stop;
  $('retryBtn').onclick = () => void worker.flush(true);
  $('settingsForm').onsubmit = saveSettings;
  document.querySelectorAll('.tab').forEach(tab => tab.onclick = () => showTab(tab.dataset.tab));
  overlay.onclick = event => {
    if (!running || !video.videoWidth) return;
    const rect = overlay.getBoundingClientRect(), p = projection();
    const x = (event.clientX - rect.left - p.x) / p.scale, y = (event.clientY - rect.top - p.y) / p.scale;
    const track = tracker.tracks.find(t => x >= t.bbox[0] && x <= t.bbox[2] && y >= t.bbox[1] && y <= t.bbox[3]);
    if (track) { selectedTrack = track; if (track.status !== 'KNOWN') openRegistration(track); }
  };
  $('closeRegisterBtn').onclick = $('cancelRegisterBtn').onclick = closeRegistration;
  $('registerDialog').addEventListener('close', () => { registration = null; });
  $('savePersonBtn').onclick = () => void savePerson();
  $('clearPersonsBtn').onclick = async () => { if (!confirm('清除所有合法人物？')) return; await clear('persons'); persons = []; await refreshLists(); };
  $('clearEventsBtn').onclick = async () => { if (!confirm('清除所有事件紀錄與截圖？')) return; await clear('events'); await clear('outbox'); await refreshLists(); };
  $('clearOutboxBtn').onclick = async () => { if (!confirm('清除所有待送通知？')) return; await clear('outbox'); await refreshLists(); };
  $('resetBtn').onclick = async () => { if (!confirm('重設所有本機資料與設定？')) return; await stop(); for (const store of ['persons', 'embeddings', 'events', 'outbox', 'settings']) await clear(store); localStorage.removeItem('sentry-device-id'); localStorage.removeItem('sentry-privacy-accepted'); sessionStorage.removeItem('sentry-session-key'); location.reload(); };
  window.addEventListener('online', () => { status(); void worker.flush(); });
  window.addEventListener('offline', status);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && running && !wakeLock) void acquireWakeLock(); });
  setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('zh-TW', { hour12: false }); status(); }, 1000);
}

init().catch(error => notice(`初始化失敗：${error.message}`, true));
