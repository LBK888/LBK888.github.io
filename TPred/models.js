export const MOVES = ['R', 'P', 'S'];
export const NAMES = { R: 'Rock', P: 'Paper', S: 'Scissors' };
export const GLYPHS = { R: '✊', P: '✋', S: '✌️' };
export const MODEL_NAMES = {
  random: 'Random baseline', frequency: 'Frequency', markov1: 'Markov 1',
  outcome: 'Outcome Markov', markov2: 'Markov 2',
  context: 'Variable context', hmm: 'Fixed-prior HMM',
};
export const MODEL_KEYS = Object.keys(MODEL_NAMES);
// Compact labels for the in-game HUD.
export const SHORT_NAMES = {
  ensemble: 'ENSEMBLE', random: 'RANDOM', frequency: 'FREQUENCY', markov1: 'MARKOV 1',
  outcome: 'OUTCOME', markov2: 'MARKOV 2', context: 'CONTEXT', hmm: 'HMM', tabpfn: 'TABPFN',
};
const UNIFORM = [1 / 3, 1 / 3, 1 / 3];
const index = move => MOVES.indexOf(move);
const normal = counts => {
  const total = counts.reduce((a, b) => a + b, 0);
  return counts.map(value => value / total);
};
const smoothed = counts => normal(counts.map(value => value + 0.5));
const countsFor = (history, match) => {
  const counts = [0, 0, 0];
  for (let i = 0; i < history.length; i++) {
    if (match(i)) counts[index(history[i].player)]++;
  }
  return counts;
};

export function predictModels(history) {
  const n = history.length;
  const frequency = smoothed(countsFor(history, () => true));
  const previous = history.at(-1);
  const markov1 = previous
    ? smoothed(countsFor(history, i => i > 0 && history[i - 1].player === previous.player))
    : frequency;
  const markov2 = n > 1
    ? smoothed(countsFor(history, i => i > 1 && history[i - 2].player === history[n - 2].player && history[i - 1].player === previous.player))
    : frequency;
  const outcome = previous
    ? smoothed(countsFor(history, i => i > 0 && history[i - 1].player === previous.player && history[i - 1].result === previous.result))
    : frequency;

  let context = frequency;
  for (let depth = 1; depth <= Math.min(3, n); depth++) {
    const counts = countsFor(history, i => i >= depth &&
      Array.from({ length: depth }, (_, k) => history[i - depth + k].player === history[n - depth + k].player).every(Boolean));
    const seen = counts.reduce((a, b) => a + b, 0);
    if (seen) {
      const local = smoothed(counts);
      const trust = seen / (seen + 3);
      context = context.map((p, i) => (1 - trust) * p + trust * local[i]);
    }
  }
  return {
    random: [...UNIFORM], frequency, markov1, outcome, markov2, context,
    hmm: predictHMM(history),
  };
}

// Four fixed strategy priors. Filtering updates probabilities of strategies, not model weights.
export function hmmState(history) {
  let posterior = [0.25, 0.25, 0.25, 0.25];
  for (let i = 1; i < history.length; i++) {
    const previous = index(history[i - 1].player);
    const observed = index(history[i].player);
    const expected = [null, previous, (previous + 1) % 3, (previous + 2) % 3];
    const prior = posterior.map((_, state) =>
      posterior.reduce((sum, p, old) => sum + p * (old === state ? 0.82 : 0.06), 0));
    posterior = normal(prior.map((p, state) => p *
      (state === 0 ? 1 / 3 : observed === expected[state] ? 0.8 : 0.1)));
  }
  return posterior;
}

export function predictHMM(history) {
  if (!history.length) return [...UNIFORM];
  const posterior = hmmState(history);
  const nextState = posterior.map((_, state) =>
    posterior.reduce((sum, p, old) => sum + p * (old === state ? 0.82 : 0.06), 0));
  const previous = index(history.at(-1).player);
  return normal(MOVES.map((_, move) =>
    nextState[0] / 3 +
    nextState[1] * (move === previous ? 0.8 : 0.1) +
    nextState[2] * (move === (previous + 1) % 3 ? 0.8 : 0.1) +
    nextState[3] * (move === (previous + 2) % 3 ? 0.8 : 0.1)));
}

export function ensemble(history, models, external = null) {
  const keys = [...MODEL_KEYS];
  if (external && validProbability(external)) {
    models.tabpfn = external;
    keys.push('tabpfn');
  }
  const raw = keys.map(key => {
    let loss = 0;
    for (const row of history) {
      if (row.models?.[key]) {
        loss = 0.92 * loss - Math.log(Math.max(0.001, row.models[key][index(row.player)]));
      } else {
        // A late optional model must not enter with a free zero-loss record.
        loss = 0.92 * loss + Math.log(3);
      }
    }
    return Math.exp(-0.35 * loss);
  });
  const weights = normal(raw);
  const probability = normal(MOVES.map((_, i) => keys.reduce((sum, key, j) => sum + weights[j] * models[key][i], 0)));
  return { probability, weights: Object.fromEntries(keys.map((key, i) => [key, weights[i]])) };
}

export function validProbability(value) {
  return Array.isArray(value) && value.length === 3 &&
    value.every(p => Number.isFinite(p) && p >= 0 && p <= 1) &&
    Math.abs(value.reduce((a, b) => a + b, 0) - 1) < 0.01;
}

export function predictAccuracy(history, key = 'ensemble') {
  const pick = typeof key === 'function' ? key : row => row[key];
  const eligible = history.filter(row => validProbability(pick(row)));
  const correct = eligible.reduce((sum, row) => sum + predictionCredit(pick(row), row.player), 0);
  return { correct, total: eligible.length, rate: eligible.length ? correct / eligible.length : null };
}

// An "anti" model reads a saved forecast the other way round: the model's top pick is the move
// the player will NOT throw. It is derived from stored probabilities; nothing is retrained.
const ANTI = ':anti';
export const isAnti = key => key.endsWith(ANTI);
export const baseModel = key => isAnti(key) ? key.slice(0, -ANTI.length) : key;
export function forecastOf(models, key) {
  const probability = models?.[baseModel(key)];
  return probability && isAnti(key) ? probability.map(p => (1 - p) / 2) : probability;
}

export function modelLabel(key, short = false) {
  const base = baseModel(key);
  const name = short ? SHORT_NAMES[base] ?? base.toUpperCase() : MODEL_NAMES[base] ?? (base === 'tabpfn' ? 'TabPFN' : base);
  return isAnti(key) ? `${short ? 'ANTI' : 'Anti'} ${name}` : name;
}

// The AI's score had it best-responded to this forecast: +1 win, 0 draw, -1 loss,
// averaged over equally good responses (the live game picks one of them at random).
export function responseScore(probability, player) {
  const best = bestResponses(probability);
  return best.reduce((sum, ai) => {
    const result = resultFor(player, ai);
    return sum + (result === 'ai' ? 1 : result === 'player' ? -1 : 0);
  }, 0) / best.length;
}

export function modelMetrics(history, key) {
  const rows = history.filter(row => forecastOf(row.models, key));
  if (!rows.length) return null;
  let correct = 0, logLoss = 0, brier = 0, net = 0;
  for (const row of rows) {
    const probability = forecastOf(row.models, key);
    const observed = index(row.player);
    correct += predictionCredit(probability, row.player);
    logLoss -= Math.log(Math.max(0.001, probability[observed]));
    brier += probability.reduce((sum, p, i) => sum + (p - Number(i === observed)) ** 2, 0);
    net += responseScore(probability, row.player);
  }
  const total = rows.length;
  return { accuracy: correct / total, correct, total, logLoss: logLoss / total, brier: brier / total, net: net / total };
}

// Optional TabPFN starts predicting at round 9 and can miss a round when late.
// It joins the comparison once it has this many predictions (the report's usual minimum).
export const MIN_OPTIONAL_PREDICTIONS = 5;
// The AI plays the model with the best score over this many latest shared rounds.
export const RECENT_ROUNDS = 15;

export function comparedModels(history) {
  const tabpfn = history.filter(row => row.models?.tabpfn).length;
  return tabpfn >= MIN_OPTIONAL_PREDICTIONS ? [...MODEL_KEYS, 'tabpfn'] : [...MODEL_KEYS];
}

// Like-for-like rounds: every compared model had a prediction. Without this, a model that
// skipped the early, data-poor rounds would look better than models scored on all rounds.
export function sharedRows(history, keys = comparedModels(history)) {
  return history.filter(row => keys.every(key => row.models?.[key]));
}

// Compared models plus the anti version of each model that picked right less than a third of
// the time over `recent`. Offering only these keeps lucky flukes among extra candidates rare.
export function candidateModels(keys, recent) {
  const below = keys.filter(key => key !== 'random' && modelMetrics(recent, key)?.accuracy < 1 / 3 - 1e-9);
  return [...keys, ...below.map(key => key + ANTI)];
}

// Follow the recent leader: the candidate whose forecasts would have given the AI the best net
// score (wins minus losses per round) over the latest RECENT_ROUNDS shared rounds, ties broken by
// log loss. `available` limits the pick to models with a prediction for the next round.
export function leadingModel(history, available = null) {
  const keys = comparedModels(history);
  const rows = sharedRows(history, keys).slice(-RECENT_ROUNDS);
  let best = null;
  for (const key of candidateModels(keys, rows)) {
    if (available && !available.includes(baseModel(key))) continue;
    const metric = modelMetrics(rows, key);
    if (!metric) continue;
    if (!best || metric.net > best.net + 1e-9 ||
      (metric.net > best.net - 1e-9 && metric.logLoss < best.logLoss)) best = { key, ...metric };
  }
  return best;
}

// The ensemble plays the first `ensembleRounds`; afterwards the current leader plays, re-chosen every round.
export function aiPolicy(history, ensembleRounds, available = null) {
  return history.length < ensembleRounds ? 'ensemble' : leadingModel(history, available)?.key ?? 'ensemble';
}

// The probabilities the AI actually acted on in a round.
export function actedProbability(row) {
  return (row.policy && row.policy !== 'ensemble' && forecastOf(row.models, row.policy)) || row.ensemble;
}

export function predictionCredit(probability, observed) {
  const peak = Math.max(...probability);
  const tied = probability.map((p, i) => Math.abs(p - peak) < 1e-9 ? i : -1).filter(i => i >= 0);
  return tied.includes(index(observed)) ? 1 / tied.length : 0;
}

export function strategy(history, probability) {
  if (history.length < 6) return 'observe';
  const recent = history.slice(-8);
  const score = recent.filter(row => row.ensemble).reduce((sum, row) =>
    sum - Math.log(Math.max(0.001, row.ensemble[index(row.player)])), 0) / recent.length;
  const accuracy = predictAccuracy(recent).rate ?? 0;
  const peak = Math.max(...probability);
  if (history.length >= 10 && score < Math.log(3) - 0.12 && accuracy >= 0.5 && peak >= 0.5) return 'exploit';
  if (score < Math.log(3) - 0.05 && peak >= 0.42) return 'adapt';
  return 'observe';
}

function bestResponses(probability) {
  const [r, p, s] = probability;
  const payoff = [s - p, r - s, p - r];
  const peak = Math.max(...payoff);
  return MOVES.filter((_, i) => peak - payoff[i] < 1e-9);
}

export function bestResponse(probability, random = Math.random) {
  const best = bestResponses(probability);
  // Break ties randomly so an uninformative forecast does not always yield Rock.
  return best.length === 1 ? best[0] : best[Math.floor(random() * best.length)];
}

export function chooseAction(probability, mode, random = Math.random) {
  const exploitChance = { observe: 0, adapt: 0.7, exploit: 0.95, leader: 1 }[mode];
  return random() < exploitChance ? bestResponse(probability, random) : MOVES[Math.floor(random() * 3)];
}

export function resultFor(player, ai) {
  if (player === ai) return 'draw';
  return (index(player) + 1) % 3 === index(ai) ? 'ai' : 'player';
}

export function summary(history) {
  const count = type => history.filter(row => row.result === type).length;
  const recent = history.slice(-10);
  return {
    rounds: history.length, ai: count('ai'), player: count('player'), draws: count('draw'),
    aiRate: history.length ? count('ai') / history.length : 0,
    playerRate: history.length ? count('player') / history.length : 0,
    recentAiRate: recent.length ? recent.filter(row => row.result === 'ai').length / recent.length : 0,
    accuracy: predictAccuracy(history, actedProbability),
  };
}
