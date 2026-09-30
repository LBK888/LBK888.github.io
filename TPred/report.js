import { MOVES, MODEL_KEYS, MODEL_NAMES, summary, hmmState, modelMetrics, actedProbability } from './models.js';

const $ = id => document.getElementById(id);
const percent = value => `${(value * 100).toFixed(1)}%`;
const symbols = { R: '✊', P: '✋', S: '✌️' };
const REPLAY_LIMIT = 50;
const policyName = key => !key || key === 'ensemble' ? 'Live ensemble' : MODEL_NAMES[key] ?? key;
const safe = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function chart(series, colors, maxRounds, rolling = false) {
  if (!maxRounds) return '<p class="empty">Chart appears after your first throw.</p>';
  const w = 500, h = 170, left = 30, right = 14, top = 12, bottom = 28;
  const x = i => left + i * (w - left - right) / Math.max(1, maxRounds - 1);
  const y = value => top + (1 - value) * (h - top - bottom);
  const grid = [0, .25, .5, .75, 1].map(level => `<line class="grid" x1="${left}" x2="${w-right}" y1="${y(level)}" y2="${y(level)}"/><text x="0" y="${y(level)+3}">${Math.round(level*100)}%</text>`).join('');
  const lines = series.map((values, seriesIndex) => {
    const points = values.map((value, i) => `${x(i)},${y(value)}`).join(' ');
    return `<polyline fill="none" stroke="${colors[seriesIndex]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${points}"/>`;
  }).join('');
  const labels = [1, Math.ceil(maxRounds/2), maxRounds].filter((v, i, a) => a.indexOf(v) === i).map(v => `<text x="${x(v-1)}" y="${h-3}" text-anchor="middle">${v}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${rolling ? 'Rolling ten-round' : 'Cumulative'} win rate by round">${grid}${lines}${labels}</svg>`;
}

function transitionText(history) {
  if (history.length < 2) return 'Transitions appear after two throws.';
  const matrix = Object.fromEntries(MOVES.map(move => [move, Object.fromEntries(MOVES.map(next => [next, 0]))]));
  for (let i = 1; i < history.length; i++) matrix[history[i-1].player][history[i].player]++;
  const rows = MOVES.map(move => `<div><b>${move} →</b> ${MOVES.map(next => `${next}: ${matrix[move][next]}`).join(' · ')}</div>`).join('');
  const state = hmmState(history);
  const names = ['Random', 'Stay', 'Forward cycle', 'Reverse cycle'];
  const top = state.indexOf(Math.max(...state));
  return `${rows}<div>Fixed-prior hidden state: <b>${names[top]} ${percent(state[top])}</b></div>`;
}

function replayRow(row) {
  const result = row.result === 'ai' ? 'AI WIN' : row.result === 'player' ? 'YOU WIN' : 'DRAW';
  const probabilities = Object.entries(row.models ?? {}).map(([key, p]) => `<div class="prob-line"><b>${safe(MODEL_NAMES[key] ?? key)}</b><span>R ${Math.round(p[0]*100)}%</span><span>P ${Math.round(p[1]*100)}%</span><span>S ${Math.round(p[2]*100)}%</span></div>`).join('');
  const p = row.ensemble;
  return `<details class="replay-row"><summary><b>#${String(row.round).padStart(2,'0')}</b><span>YOU ${symbols[row.player]}</span><span>AI ${symbols[row.ai]}</span><span>${result}</span></summary><div class="replay-detail"><div><b>Prior sequence:</b> ${safe(row.historyBefore || 'none')}</div><div><b>AI used:</b> ${safe(policyName(row.policy))} · <b>Policy:</b> ${safe(row.mode)} · <b>Locked:</b> ${safe(row.lockedAt)} · <b>Observed:</b> ${safe(row.observedAt)}</div>${row.serverLockedAt ? `<div><b>Server received commitment:</b> ${safe(row.serverLockedAt)}</div>` : ''}<div><b>Commit SHA-256:</b> <code>${safe(row.commitment)}</code></div><div><b>Nonce:</b> <code>${safe(row.nonce)}</code></div><button class="verify-button" data-round="${row.round}">VERIFY COMMIT</button> <span class="verify-result"></span><div><b>Gesture confidence:</b> ${Math.round(row.confidence*100)}%</div><h4>Probabilities before your throw</h4>${probabilities}<div class="prob-line"><b>Live ensemble</b><span>R ${Math.round(p[0]*100)}%</span><span>P ${Math.round(p[1]*100)}%</span><span>S ${Math.round(p[2]*100)}%</span></div></div></details>`;
}

export function renderReport(history, policy = 'ensemble') {
  const stats = summary(history);
  $('report-title').textContent = history.length ? `${history.length} ${history.length === 1 ? 'throw' : 'throws'}. One evolving sequence.` : 'Your story starts with the first throw.';
  $('report-ai').textContent = history.length ? percent(stats.aiRate) : '—';
  $('report-player').textContent = history.length ? percent(stats.playerRate) : '—';
  $('report-draw').textContent = `${stats.draws} draws`;
  $('report-accuracy').textContent = stats.accuracy.total >= 5 ? percent(stats.accuracy.rate) : '—';
  $('accuracy-count').textContent = stats.accuracy.total >= 5 ? `${stats.accuracy.correct.toFixed(1)} / ${stats.accuracy.total} tie-adjusted · chance 33.3%` : `Collecting evidence · ${stats.accuracy.total}/5 rounds`;
  const meanLogLoss = history.length ? history.reduce((sum, row) => sum - Math.log(Math.max(0.001, actedProbability(row)[MOVES.indexOf(row.player)])), 0) / history.length : Math.log(3);
  $('report-insight').textContent = history.length < 10 ? 'Early evidence is noisy. Keep playing before interpreting the pattern. / 前幾局樣本不足。' : meanLogLoss < Math.log(3) - 0.1 && stats.accuracy.rate > 0.45 ? `This sequence shows some predictability, but ${history.length} rounds cannot prove a stable habit. Try another session. / 可能有規律，仍需重複驗證。` : 'No stable pattern detected in this short session. Near-random play is a valid result. / 未偵測到穩定規律，也是重要結果。';

  const aiSeries = [], playerSeries = [], rollingSeries = [];
  let ai = 0, player = 0;
  history.forEach((row, i) => {
    ai += Number(row.result === 'ai'); player += Number(row.result === 'player');
    aiSeries.push(ai / (i+1)); playerSeries.push(player / (i+1));
    const recent = history.slice(Math.max(0, i-9), i+1);
    rollingSeries.push(recent.filter(item => item.result === 'ai').length / recent.length);
  });
  $('win-chart').innerHTML = chart([aiSeries, playerSeries], ['#c76e31', '#4a8b92'], history.length);
  $('rolling-chart').innerHTML = chart([rollingSeries], ['#c76e31'], history.length, true);
  const policyLabel = row => row.mode === 'leader' ? `leader ${policyName(row.policy)}` : row.mode;
  const changes = history.filter((row, i) => i === 0 || policyLabel(row) !== policyLabel(history[i-1])).map(row => `R${row.round} ${policyLabel(row)}`);
  $('policy-timeline').textContent = history.length ? `AI policy: ${changes.join(' · ')}` : 'AI policy changes will appear here.';

  const modelKeys = history.some(row => row.models?.tabpfn) ? [...MODEL_KEYS, 'tabpfn'] : MODEL_KEYS;
  $('model-chart').innerHTML = history.length >= 5 ? modelKeys.map(key => {
    const metric = modelMetrics(history, key);
    if (!metric) return '';
    if (metric.total < 5) return `<div class="model-row"><span>${safe(MODEL_NAMES[key] ?? 'TabPFN')}</span><div class="bar"></div><strong>—</strong><small>Collecting ${metric.total}/5 predictions</small></div>`;
    const tag = key === policy ? ' <em class="model-tag" title="The AI is playing this model">AI</em>' : '';
    return `<div class="model-row ${key === 'random' ? '' : 'primary'}"><span>${safe(MODEL_NAMES[key] ?? 'TabPFN')}${tag}</span><div class="bar"><i style="width:${Math.round(metric.accuracy*100)}%"></i></div><strong>${Math.round(metric.accuracy*100)}%</strong><small>${metric.correct.toFixed(1)}/${metric.total} · log loss ${metric.logLoss.toFixed(2)} · Brier ${metric.brier.toFixed(2)}</small></div>`;
  }).join('') + '<p class="panel-note">Prequential, tie-adjusted top-choice scores. Equal probabilities split credit among tied choices. A higher short-run score does not prove a model is better.</p>' : `<p class="empty">Collecting model evidence · ${history.length}/5 rounds.</p>`;
  $('sequence-view').innerHTML = history.length ? history.map(row => `<span title="${safe(row.player)}">${safe(row.player)}</span>`).join('') : '<p class="empty">Your R / P / S sequence will appear here.</p>';
  $('transition-view').innerHTML = transitionText(history);
  // Long sessions keep the full record in memory and in the JSON export; only the latest rows are drawn.
  const hidden = Math.max(0, history.length - REPLAY_LIMIT);
  $('replay-list').innerHTML = history.length ? history.slice(hidden).reverse().map(replayRow).join('') +
    (hidden ? `<p class="empty">Showing the latest ${REPLAY_LIMIT} of ${history.length} rounds. Export JSON for the full record.</p>` : '')
    : '<p class="empty">No rounds yet. Start the game above.</p>';
}
