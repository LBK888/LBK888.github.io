const LESSONS = [
  {
    kicker: '01 / PRE-COMMIT', title: 'Prediction must come first.',
    body: 'The AI predicts from past hands, chooses its own hand, and locks a SHA-256 commitment. Only then does the countdown begin. Reveal the nonce after the throw to check the commitment.',
    zh: '先鎖定 AI 的拳，才能避免看到玩家出拳後再改答案。',
    motion: '<div class="motion-lock">LOCKED BEFORE SHOOT</div><div class="motion-sequence"><div class="motion-token">◈</div><div class="motion-arrow">→</div><div class="motion-token">3</div><div class="motion-token">2</div><div class="motion-token">1</div></div><div class="motion-caption">HISTORY → COMMIT → COUNTDOWN → HAND</div>',
  },
  {
    kicker: '02 / FREQUENCY', title: 'First, simply count.',
    body: 'Count how often you play R, P and S. Add a half-count to every option before turning counts into probabilities. This Dirichlet smoothing prevents an unseen hand from getting impossible 0% odds. Chance starts at one third.',
    zh: '先數出拳次數，再加平滑值，避免少量資料造成過度自信。',
    motion: '<div class="motion-sequence"><div class="motion-token">R</div><div class="motion-token">R</div><div class="motion-token">P</div><div class="motion-arrow">→</div><div class="motion-token">?</div></div><div class="motion-caption">COUNTS + ½ EACH → PROBABILITIES</div>',
  },
  {
    kicker: '03 / MARKOV', title: 'The last symbol matters.',
    body: 'Markov 1 asks what usually follows your previous hand. Markov 2 asks what follows the last two. Outcome Markov also checks whether you won, lost or drew. A DNA k-mer question is similar: after ACG, which base tends to come next?',
    zh: '前一拳、前兩拳及上一局勝負，都可能改變下一拳的機率。',
    motion: '<div class="motion-sequence"><div class="motion-token">R</div><div class="motion-arrow">→</div><div class="motion-token">P</div><div class="motion-arrow">→</div><div class="motion-token">?</div></div><div class="motion-caption">P(NEXT | PREVIOUS, OUTCOME)</div>',
  },
  {
    kicker: '04 / VARIABLE CONTEXT', title: 'Back off when data runs thin.',
    body: 'A three-hand suffix is specific, but may have appeared only once. The variable-context mixture trusts long suffixes only when repeated evidence exists. It blends them with two-hand, one-hand and global counts. This demonstrates the idea behind context models, not full CTW.',
    zh: '長片段若樣本不足，就逐層回退到較短的片段與整體頻率。',
    motion: '<div class="motion-sequence"><div class="motion-token">R</div><div class="motion-token">P</div><div class="motion-token">S</div><div class="motion-arrow">→</div><div class="motion-token">?</div></div><div class="motion-caption">RPS → PS → S → GLOBAL FREQUENCY</div>',
  },
  {
    kicker: '05 / LATENT STRATEGY', title: 'The strategy is invisible.',
    body: 'The fixed-prior HMM considers four hidden styles: random, stay, forward cycle and reverse cycle. It updates the probability of each style as hands arrive. Biological HMMs similarly infer hidden sequence states.',
    zh: '看得到出拳序列，看不到玩家心中的策略；HMM 用觀察值推估隱藏狀態。',
    motion: '<div class="motion-state">STRATEGY</div><div class="motion-caption">HIDDEN STATE → OBSERVED HANDS</div>',
  },
  {
    kicker: '06 / PRETRAINED MODEL', title: 'A model arrives with a prior.',
    body: 'Optional TabPFN reads a table of earlier rounds and predicts the next hand through in-context inference. It is a comparison with the small classical models, not a guarantee of improvement. During a session, its pretrained neural-network weights are not fine-tuned.',
    zh: '預訓練模型讀取少量回合作為情境；本活動不微調其神經網路權重。',
    motion: '<div class="motion-lock">PRETRAINED WEIGHTS</div><div class="motion-sequence"><div class="motion-token">R</div><div class="motion-token">P</div><div class="motion-token">S</div><div class="motion-arrow">→</div><div class="motion-token">?</div></div><div class="motion-caption">PAST ROUNDS + FEATURES → NEXT-HAND PROBABILITY</div>',
  },
];

export function initLesson() {
  const tabs = [...document.querySelectorAll('.lesson-tab')];
  const motion = document.getElementById('lesson-motion');
  const play = document.getElementById('lesson-play');
  let current = 0, playing = true, timer = null;
  const show = index => {
    current = index;
    const lesson = LESSONS[index];
    motion.innerHTML = lesson.motion;
    document.getElementById('lesson-kicker').textContent = lesson.kicker;
    document.getElementById('lesson-title').textContent = lesson.title;
    document.getElementById('lesson-body').textContent = lesson.body;
    document.getElementById('lesson-zh').textContent = lesson.zh;
    document.getElementById('lesson-progress').textContent = `${String(index+1).padStart(2,'0')} / ${String(LESSONS.length).padStart(2,'0')}`;
    tabs.forEach((tab, i) => { tab.classList.toggle('active', i === index); tab.setAttribute('aria-selected', String(i === index)); });
  };
  const schedule = () => {
    clearInterval(timer);
    if (playing && !matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => show((current+1)%LESSONS.length), 7000);
  };
  tabs.forEach((tab, index) => tab.addEventListener('click', () => { show(index); schedule(); }));
  play.addEventListener('click', () => { playing = !playing; play.textContent = playing ? 'PAUSE' : 'PLAY'; schedule(); });
  show(0); schedule();
}
