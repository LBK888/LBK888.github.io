/* 關卡：每一關的罐子與內容物都是隨機的（每次開新局都不同），迷宮也每次隨機生成。
   難度只靠：時間（30 秒起每關 +1 秒）、目標比例（50% → 第 20 關 95%）、越來越大的迷宮。 */
(function () {
  'use strict';
  const PM = window.PM, U = PM.U;

  PM.runSeed = U.randSeed();
  PM.newRun = function () { PM.runSeed = U.randSeed(); };

  // 同一局裡固定（重新開始本關時組合不變），換一局就不同；不和上一關重複
  function pickCombo(index) {
    const rng = U.makeRng(PM.runSeed + index * 7919);
    const prev = index > 0 ? pickCombo(index - 1) : [null, null];
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
      cols: Math.min(14, 8 + Math.floor((n - 1) / 3)),
      wallK: PM.MATERIALS[mat].wallK,
      room: Math.max(0.24, 0.36 - (n - 1) * 0.006),
      open: n <= 6 ? 2 : 1,
      turns: [1, 99],
      pockets: [0, Math.round(2 + n * 0.5)],   // 會困住內容物的凹處別太多
      target: Math.min(0.95, 0.5 + ((n - 1) * 0.45) / 19),
      time: 30 + (n - 1),
      bonus: n <= 3 ? 1 : n <= 9 ? 2 : 3,
      bonusHard: n > 3,
    };
  };

  // 示範用（標題畫面背景）
  PM.DEMO_LEVEL = { n: 0, shape: 'jar', mat: 'candy', cols: 8, room: 0.36, open: 2, turns: [1, 99], target: 1, time: 999, bonus: 1 };
})();
