import { MOVES, NAMES, GLYPHS, SHORT_NAMES, MODEL_NAMES, predictModels, ensemble, strategy, chooseAction, resultFor, summary, aiPolicy, leadingModel, actedProbability } from './models.js';
import { CameraInput } from './camera.js';
import { renderReport } from './report.js';
import { initLesson } from './tutorial.js';
import { apiFetch, checkApiHealth, getApiBase, setApiBase } from './api.js';

const $ = id => document.getElementById(id);
const els = Object.fromEntries([
  'camera','camera-card','camera-state','camera-placeholder','placeholder-label','recognized','round-label','player-hand','ai-hand',
  'countdown','phase-indicator','pulse-fill','ai-score','player-score','draw-score','accuracy-value','recent-value',
  'main-button','pause-button','end-button','manual-inline','settings-dialog','settings-button','close-settings','rounds-setting',
  'capture-setting','input-setting','sound-setting','save-setting','save-status','manual-buttons',
  'api-setting','api-check','api-status','api-indicator','policy-cell','policy-value','result-mark',
].map(id => [id, $(id)]));

const game = {
  state: 'idle', history: [], pending: null, sessionId: crypto.randomUUID(), total: 24,
  captureMs: 1200, manual: false, save: false, serverSession: false, sound: true,
  token: 0, clearSince: null, holdUntil: 0, readings: [], external: null, externalFor: -1,
};
let camera = null;
let audioContext = null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const percent = rate => `${Math.round(rate * 100)}%`;
const randomBytes = () => crypto.randomUUID();

function setStatus(title, subtitle, className = '') {
  els.countdown.textContent = title;
  els.countdown.className = `countdown ${className}`;
  els['phase-indicator'].textContent = subtitle;
}

// The model behind the round on screen: the locked round, the one just revealed, or the next one.
function currentPolicy() {
  if (game.pending) return game.pending.policy;
  if (game.state === 'reveal') return game.history.at(-1)?.policy ?? 'ensemble';
  return aiPolicy(game.history, game.total);
}

function showMark(result) { els['result-mark'].dataset.result = result; els['result-mark'].hidden = false; }
function hideMark() { els['result-mark'].hidden = true; }

function render() {
  const s = summary(game.history);
  const round = String(s.rounds + 1).padStart(2, '0');
  els['round-label'].textContent = s.rounds < game.total ? `${round} / ${game.total}` : `${round} / ∞`;
  const policy = currentPolicy();
  els['policy-value'].textContent = SHORT_NAMES[policy] ?? policy;
  els['policy-cell'].title = policy === 'ensemble' ? 'Weighted mix of all models' : `${MODEL_NAMES[policy]}: best record so far`;
  els['policy-cell'].classList.toggle('leader', policy !== 'ensemble');
  els['ai-score'].textContent = s.ai;
  els['player-score'].textContent = s.player;
  els['draw-score'].textContent = s.draws;
  els['accuracy-value'].textContent = s.accuracy.total >= 5 ? percent(s.accuracy.rate) : '—';
  els['recent-value'].textContent = s.rounds ? percent(s.recentAiRate) : '—';
  els['main-button'].hidden = !['idle', 'error', 'paused', 'finished'].includes(game.state);
  els['pause-button'].hidden = !['clear', 'countdown', 'capture', 'reveal'].includes(game.state);
  els['end-button'].hidden = game.state !== 'paused';
  els['manual-inline'].hidden = !(game.manual && game.state === 'capture');
  els['main-button'].innerHTML = ({ idle: 'ENABLE CAMERA <span>↗</span>', error: 'TRY AGAIN <span>↗</span>', paused: 'RESUME <span>→</span>', finished: 'VIEW REPORT <span>↓</span>' })[game.state] ?? '';
  if (game.manual && game.state === 'idle') els['main-button'].innerHTML = 'START DEMO <span>↗</span>';
  if (game.manual && game.state === 'error') els['main-button'].innerHTML = 'START DEMO <span>↗</span>';
  els['rounds-setting'].disabled = game.history.length > 0 || !!game.pending;
  els['input-setting'].disabled = !['idle', 'error', 'finished'].includes(game.state);
  els['save-setting'].disabled = game.history.length > 0 || !!game.pending;
  els['api-setting'].disabled = !['idle', 'error'].includes(game.state) || game.serverSession;
  renderReport(game.history, policy);
}

function pulse(fraction) { els['pulse-fill'].style.width = `${Math.max(0, Math.min(100, fraction * 100))}%`; }

function tone(frequency = 650, duration = 0.12) {
  if (!game.sound) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(0.0001, audioContext.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(volume).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
  } catch { /* Sound is optional. */ }
}

async function hashCommit(sessionId, round, ai, nonce) {
  const bytes = new TextEncoder().encode(`${sessionId}:${round}:${ai}:${nonce}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function prepareRound() {
  if (game.pending) return game.pending;
  const models = predictModels(game.history);
  const external = game.externalFor === game.history.length ? game.external : null;
  const mixed = ensemble(game.history, models, external);
  const policy = aiPolicy(game.history, game.total);
  const mode = policy === 'ensemble' ? strategy(game.history, mixed.probability) : 'leader';
  const predictedAt = new Date().toISOString();
  const ai = chooseAction(policy === 'ensemble' ? mixed.probability : models[policy], mode);
  const round = game.history.length + 1;
  const nonce = randomBytes();
  const commitment = await hashCommit(game.sessionId, round, ai, nonce);
  const pending = {
    sessionId: game.sessionId, round, ai, nonce, commitment, predictedAt, lockedAt: new Date().toISOString(),
    historyBefore: game.history.map(row => row.player).join(''),
    models: structuredClone(models), ensemble: [...mixed.probability], weights: { ...mixed.weights }, mode, policy,
  };
  game.pending = pending;
  if (game.save && game.serverSession) {
    try {
      const response = await apiFetch(`/api/sessions/${game.sessionId}/commits`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round, commitment, lockedAt: pending.lockedAt }),
      });
      if (!response.ok) throw new Error('commit rejected');
      pending.serverLockedAt = (await response.json()).receivedAt;
    } catch { pending.serverLockedAt = null; els['save-status'].textContent = 'Server commitment failed. Continuing locally; this round may not be saved.'; }
  }
  return pending;
}

// A fresh round whose leading model differs from the one that played last round.
function modelSwitch() {
  const last = game.history.at(-1);
  if (game.pending || !last || game.history.length < game.total) return null;
  const leader = leadingModel(game.history);
  return leader && leader.key !== last.policy ? leader : null;
}

function enterClear(message = 'MOVE HAND OUT TO RESET') {
  game.state = 'clear'; game.clearSince = null; game.readings = [];
  els['player-hand'].textContent = '?'; els['ai-hand'].textContent = '?';
  const leader = modelSwitch();
  // Hold a switch announcement long enough to read before the next countdown.
  game.holdUntil = leader ? Date.now() + 1500 : 0;
  if (leader) setStatus(`AI → ${SHORT_NAMES[leader.key]}`, `Best record so far · ${percent(leader.accuracy)} predicted${game.manual ? '' : ' · remove hand'}`);
  else setStatus('READY', game.manual ? 'Next countdown starts automatically' : message);
  pulse(0); render();
  if (game.manual) setTimeout(() => { if (game.state === 'clear') beginCountdown(); }, leader ? 2400 : 1100);
}

async function beginCountdown() {
  if (game.state !== 'clear') return;
  game.state = 'locking';
  hideMark();
  const token = ++game.token;
  setStatus('LOCKING', 'AI chooses before your hand appears');
  pulse(0); render();
  try { await prepareRound(); }
  catch (error) { game.state = 'error'; setStatus('ERROR', error.message); render(); return; }
  if (token !== game.token || game.state !== 'locking') return;
  game.state = 'countdown'; render();
  for (const [step, number] of ['3', '2', '1'].entries()) {
    if (token !== game.token) return;
    setStatus(number, 'AI MOVE LOCKED · prepare your throw');
    tone(540 + step * 80);
    pulse((step + 1) / 4);
    await delay(680);
  }
  if (token !== game.token) return;
  game.state = 'capture';
  game.readings = [];
  game.captureStarted = Date.now();
  setStatus('SHOOT!', game.manual ? 'Tap a demo hand below' : 'Hold your hand steady in the frame');
  tone(880, 0.23); pulse(1);
  render();
  if (!game.manual) setTimeout(() => { if (token === game.token && game.state === 'capture') decideCapture(); }, game.captureMs);
}

function decideCapture() {
  const readings = game.readings.filter(reading => reading.move && reading.hands === 1 && reading.confidence >= 0.7);
  const tally = Object.fromEntries(MOVES.map(move => [move, readings.filter(item => item.move === move).length]));
  const winning = MOVES.reduce((best, move) => tally[move] > tally[best] ? move : best, 'R');
  if (tally[winning] >= 3 && tally[winning] >= readings.length * 0.6) {
    const matching = readings.filter(item => item.move === winning);
    acceptMove(winning, matching.reduce((sum, item) => sum + item.confidence, 0) / matching.length, matching.at(-1).time);
  } else {
    enterClear('NOT CLEAR · remove hand, then retry');
  }
}

async function acceptMove(player, confidence, observedAt) {
  if (game.state !== 'capture' || !game.pending) return;
  const pending = game.pending;
  if (Date.parse(pending.lockedAt) > observedAt) return;
  const result = resultFor(player, pending.ai);
  const row = {
    ...pending, player, confidence, observedAt: new Date(observedAt).toISOString(), result,
    acceptedAt: new Date().toISOString(),
  };
  game.history.push(row);
  game.pending = null;
  game.external = null; game.externalFor = -1;
  game.state = 'reveal';
  els['player-hand'].textContent = GLYPHS[player];
  els['ai-hand'].textContent = GLYPHS[pending.ai];
  const acted = actedProbability(pending);
  const peak = Math.max(...acted);
  const favorites = acted.filter(p => Math.abs(p - peak) < 1e-9).length;
  const forecast = favorites === 1 ? `AI forecast ${NAMES[MOVES[acted.indexOf(peak)]]}` : 'AI forecast: no favorite';
  setStatus(result === 'ai' ? 'AI WINS' : result === 'player' ? 'YOU WIN' : 'DRAW',
    `${NAMES[player]}  ·  ${NAMES[pending.ai]}  |  ${forecast}`,
    `result-${result}`);
  showMark(result);
  pulse(0); tone(result === 'player' ? 970 : result === 'ai' ? 400 : 670, 0.2);
  render();
  const completedRounds = game.history.length;
  if (game.save) saveRound(row).then(saved => { if (saved) requestExternalPrediction(completedRounds); });
  const token = ++game.token;
  await delay(1200);
  if (token !== game.token || game.state !== 'reveal') return;
  enterClear();
}

function onReading(reading) {
  els.recognized.textContent = reading.hands > 1 ? '2 HANDS' : reading.move ? `${GLYPHS[reading.move]} ${Math.round(reading.confidence * 100)}%` : reading.hands ? 'HOLD STEADY' : '—';
  if (game.state === 'clear') {
    if (reading.hands === 0) {
      game.clearSince ??= reading.time;
      if (reading.time - game.clearSince >= 400 && reading.time >= game.holdUntil) beginCountdown();
    } else game.clearSince = null;
  } else if (game.state === 'capture' && reading.time >= game.captureStarted) {
    game.readings.push(reading);
  }
}

async function start() {
  if (game.state === 'finished') { $('analysis').scrollIntoView({ behavior: 'smooth' }); return; }
  if (game.state === 'paused') { enterClear('MOVE HAND OUT TO RESUME'); return; }
  if (!['idle', 'error'].includes(game.state)) return;
  game.state = 'loading'; render();
  game.total = Number(els['rounds-setting'].value);
  game.captureMs = Number(els['capture-setting'].value);
  game.manual = els['input-setting'].value === 'manual';
  game.save = els['save-setting'].checked;
  game.sound = els['sound-setting'].checked;
  if (game.save && !game.serverSession) await createServerSession();
  if (game.manual) {
    els['camera-state'].textContent = 'MANUAL DEMO';
    els['placeholder-label'].textContent = 'CHOOSE A HAND ON SHOOT';
    els['camera-placeholder'].hidden = false;
    els['manual-buttons'].hidden = false;
    setStatus('READY', 'Use the buttons in Settings on SHOOT');
    enterClear();
    return;
  }
  try {
    camera?.stop();
    camera = new CameraInput(els.camera, onReading, text => { els['camera-state'].textContent = text; });
    await camera.start();
    els['camera-card'].classList.add('live');
    els['camera-placeholder'].hidden = true;
    enterClear();
  } catch (error) {
    camera?.stop(); camera = null;
    game.state = 'error';
    setStatus('CAMERA ERROR', `${error.message || 'Camera unavailable'}. Manual demo is in Settings.`);
    els['camera-state'].textContent = 'CAMERA UNAVAILABLE';
    render();
  }
}

function pause() {
  if (!['clear', 'countdown', 'capture', 'reveal', 'locking'].includes(game.state)) return;
  game.token++;
  game.state = 'paused';
  hideMark();
  setStatus('PAUSED', 'Resume, or end the session to turn the camera off');
  pulse(0); render();
}

function finish() {
  game.state = 'finished'; game.token++;
  hideMark();
  camera?.stop(); camera = null;
  els['camera-card'].classList.remove('live');
  els['camera-placeholder'].hidden = false;
  els['placeholder-label'].textContent = 'SESSION COMPLETE';
  els['camera-state'].textContent = 'CAMERA OFF';
  setStatus('COMPLETE', 'Explore your report below');
  pulse(0); render();
}

async function createServerSession() {
  try {
    const response = await apiFetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: game.sessionId }) });
    game.serverSession = response.ok;
  } catch { game.serverSession = false; }
  els['save-status'].textContent = game.serverSession ? 'Server connected. Anonymous rounds will be saved.' : 'Server unavailable. This session stays in the browser only.';
}

async function saveRound(row) {
  if (!game.serverSession) return false;
  try {
    const response = await apiFetch(`/api/sessions/${game.sessionId}/rounds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
    if (!response.ok) els['save-status'].textContent = 'Server sync failed. This session continues locally; export JSON to keep it.';
    return response.ok;
  } catch { els['save-status'].textContent = 'Server sync failed. This session continues locally; export JSON to keep it.'; return false; }
}

async function requestExternalPrediction(afterRound) {
  if (!game.serverSession || !game.save) return;
  try {
    // A late answer is still used if the next round has not been locked yet.
    const response = await apiFetch(`/api/sessions/${game.sessionId}/predict`, { method: 'POST', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const payload = await response.json();
    if (game.history.length === afterRound && payload.afterRound === afterRound && Array.isArray(payload.probability)) {
      game.external = payload.probability; game.externalFor = afterRound;
    }
  } catch { /* Optional model. */ }
}

els['main-button'].addEventListener('click', start);
els['pause-button'].addEventListener('click', pause);
els['end-button'].addEventListener('click', () => { if (game.state === 'paused') finish(); });
els['settings-button'].addEventListener('click', () => { if (['clear', 'countdown', 'capture', 'reveal', 'locking'].includes(game.state)) pause(); els['settings-dialog'].hidden = false; els['close-settings'].focus(); });
els['close-settings'].addEventListener('click', () => { els['settings-dialog'].hidden = true; els['settings-button'].focus(); });
els['settings-dialog'].addEventListener('click', event => { if (event.target === els['settings-dialog']) els['settings-dialog'].hidden = true; });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !els['settings-dialog'].hidden) els['settings-dialog'].hidden = true; });
els['input-setting'].addEventListener('change', () => { game.manual = els['input-setting'].value === 'manual'; els['manual-buttons'].hidden = !game.manual; render(); });
els['rounds-setting'].addEventListener('change', () => { game.total = Number(els['rounds-setting'].value); render(); });
els['capture-setting'].addEventListener('change', () => { game.captureMs = Number(els['capture-setting'].value); });
els['sound-setting'].addEventListener('change', () => { game.sound = els['sound-setting'].checked; });
els['save-setting'].addEventListener('change', () => { els['save-status'].textContent = els['save-setting'].checked ? 'Server connection will be checked when play starts.' : 'Local only. Server storage is off.'; });
const API_ICONS = {
  checking: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="38 19"/></svg>',
  ok: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="currentColor"/><path d="M6.5 12.5l3.6 3.6L17.5 8.7" fill="none" stroke="#0b171c" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fail: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="currentColor"/><path d="M8 8l8 8M16 8l-8 8" fill="none" stroke="#0b171c" stroke-width="2.8" stroke-linecap="round"/></svg>',
};
const API_LABELS = { checking: 'Checking connection', ok: 'Connected', fail: 'Connection failed' };
function setApiIndicator(state) {
  const indicator = els['api-indicator'];
  indicator.hidden = !state;
  els['api-status'].dataset.state = state ?? '';
  if (!state) return;
  indicator.dataset.state = state;
  indicator.innerHTML = API_ICONS[state];
  indicator.setAttribute('aria-label', API_LABELS[state]);
}

els['api-setting'].value = getApiBase();
els['api-setting'].addEventListener('change', () => {
  setApiIndicator(null);
  try {
    const origin = setApiBase(els['api-setting'].value);
    els['api-setting'].value = origin;
    els['api-status'].textContent = origin ? 'Backend set. Check connection to verify.' : 'No backend set. Local play remains available.';
  } catch (error) { els['api-status'].textContent = error.message; }
});
els['api-check'].addEventListener('click', async () => {
  try {
    const origin = setApiBase(els['api-setting'].value);
    els['api-setting'].value = origin;
    els['api-status'].textContent = 'Connecting…';
    setApiIndicator('checking');
    const health = await checkApiHealth();
    const tabpfn = { ready: 'ready', loading: 'loading…', error: 'failed to load', disabled: 'off' }[health.tabpfn?.status] ?? 'unknown';
    els['api-status'].textContent = `Connected to ${origin}. TabPFN: ${tabpfn}.`;
    setApiIndicator('ok');
  } catch (error) { els['api-status'].textContent = `Connection failed: ${error.message}`; setApiIndicator('fail'); }
});
els['manual-buttons'].querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', () => {
  if (game.state === 'capture' && game.manual) { els['settings-dialog'].hidden = true; acceptMove(button.dataset.move, 1, Date.now()); }
}));
els['manual-inline'].querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', () => {
  if (game.state === 'capture' && game.manual) acceptMove(button.dataset.move, 1, Date.now());
}));
$('export-button').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ sessionId: game.sessionId, rounds: game.history }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'sequence-duel-report.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('replay-list').addEventListener('click', async event => {
  const button = event.target.closest('.verify-button');
  if (!button) return;
  const row = game.history.find(item => item.round === Number(button.dataset.round));
  if (!row) return;
  const digest = await hashCommit(game.sessionId, row.round, row.ai, row.nonce);
  const timestampsValid = Date.parse(row.lockedAt) < Date.parse(row.observedAt) && (!row.serverLockedAt || Date.parse(row.serverLockedAt) < Date.parse(row.observedAt));
  button.nextElementSibling.textContent = digest === row.commitment && timestampsValid ? '✓ MATCH' : '✕ MISMATCH';
});
$('delete-button').addEventListener('click', async () => {
  game.token++;
  camera?.stop(); camera = null;
  if (game.serverSession) { try { await apiFetch(`/api/sessions/${game.sessionId}`, { method: 'DELETE' }); } catch {} }
  game.history = []; game.pending = null; game.state = 'idle'; game.serverSession = false; hideMark();
  game.sessionId = crypto.randomUUID(); game.external = null; game.externalFor = -1;
  els['save-status'].textContent = 'Local only. Server storage is off.'; els['save-setting'].checked = false;
  els['camera-card'].classList.remove('live'); els['camera-placeholder'].hidden = false;
  els['placeholder-label'].textContent = 'PLACE YOUR HAND HERE';
  els['camera-state'].textContent = 'CAMERA OFF'; els['player-hand'].textContent = '?'; els['ai-hand'].textContent = '?';
  setStatus('READY', 'Your session has been deleted'); render();
});
window.addEventListener('pagehide', () => camera?.stop());
initLesson(); render();
