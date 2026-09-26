export const MOVES = ['R', 'P', 'S'];
export const NAMES = { R: 'Rock', P: 'Paper', S: 'Scissors' };
export const GLYPHS = { R: '✊', P: '✋', S: '✌️' };
export const MODEL_NAMES = {
  random: 'Random baseline', frequency: 'Frequency', markov1: 'Markov 1',
  outcome: 'Outcome Markov', markov2: 'Markov 2',
  context: 'Variable context', hmm: 'Fixed-prior HMM',
};
export const MODEL_KEYS = Object.keys(MODEL_NAMES);
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
  const eligible = history.filter(row => row[key] && validProbability(row[key]));
  const correct = eligible.reduce((sum, row) => sum + predictionCredit(row[key], row.player), 0);
  return { correct, total: eligible.length, rate: eligible.length ? correct / eligible.length : null };
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

export function bestResponse(probability) {
  const [r, p, s] = probability;
  const payoff = [s - p, r - s, p - r];
  return MOVES[payoff.indexOf(Math.max(...payoff))];
}

export function chooseAction(probability, mode, random = Math.random) {
  const exploitChance = { observe: 0, adapt: 0.7, exploit: 0.95 }[mode];
  return random() < exploitChance ? bestResponse(probability) : MOVES[Math.floor(random() * 3)];
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
    accuracy: predictAccuracy(history),
  };
}
