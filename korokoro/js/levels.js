/* 關卡：外殼 × 內容物。難度 = 迷宮變大、回水彎陷阱變多、目標比例 50% → 95%、時間 30 秒起每關 +1 秒。
   約第 10 關開始需要策略（搖一搖、重新整理卷），第 20 關之後目標 95%，非常難。 */
(function () {
  'use strict';
  const PM = window.PM, U = PM.U;

  // 前 8 關依序介紹每一種外殼與內容物
  const ORDER = [
    ['jar', 'water'], ['bottle', 'balls'], ['heart', 'candy'], ['square', 'pills'],
    ['ellipse', 'salt'], ['pudding', 'honey'], ['cloud', 'lottery'], ['cat', 'sugar'],
  ];
  // 每種外殼至少要幾格寬，才放得下回水彎陷阱
  const MIN_COLS = { jar: 8, bottle: 9, heart: 10, square: 8, ellipse: 10, pudding: 9, cloud: 12, cat: 9 };

  function pickCombo(index) {
    if (index < ORDER.length) return ORDER[index];
    const rng = U.makeRng(9173 + index * 131);
    const prev = pickCombo(index - 1);
    let shape, mat;
    do { shape = U.pick(PM.SHAPE_IDS, rng); } while (shape === prev[0]);
    do { mat = U.pick(PM.MATERIAL_IDS, rng); } while (mat === prev[1]);
    return [shape, mat];
  }

  PM.getLevel = function (index) {
    const n = index + 1;
    const [shape, mat] = pickCombo(index);
    return {
      n, shape, mat,
      cols: Math.min(14, Math.max(MIN_COLS[shape], 8 + Math.floor((n - 1) / 3))),
      wallK: PM.MATERIALS[mat].wallK,
      room: Math.max(0.17, 0.26 - (n - 1) * 0.005),
      open: n <= 6 ? 2 : 1,
      traps: n <= 6 ? 1 : n <= 14 ? 2 : 3,
      // 口袋：迷宮裡會困住部分內容物的小凹處，越後面越多（加分物會優先放在口袋裡）
      pockets: n <= 5 ? [0, 0] : n <= 10 ? [0, 3] : n <= 15 ? [2, 6] : n <= 19 ? [3, 9] : [5, 14],
      hbias: n <= 10 ? 0.75 : 0.55,
      turns: [1, 99],
      target: Math.min(0.95, 0.5 + ((n - 1) * 0.45) / 19),
      time: 30 + (n - 1),
      bonus: n <= 3 ? 1 : n <= 9 ? 2 : 3,
      bonusHard: n > 3,
    };
  };

  // 示範用（標題畫面背景）
  PM.DEMO_LEVEL = { n: 0, shape: 'jar', mat: 'candy', cols: 8, room: 0.32, open: 2, traps: 1, turns: [1, 99], target: 1, time: 999, bonus: 1 };
})();
