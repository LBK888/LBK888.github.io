/* 關卡：外殼 × 內容物；難度 = 迷宮更大更彎 + 目標倒出比例提高（轉彎數上限 8，避免太難） */
(function () {
  'use strict';
  const PM = window.PM, U = PM.U;

  // cols 格數、room 房間比例、open 房間開口數、turns 最少轉彎數範圍、target 目標比例、time 秒、bonus 加分物數
  PM.LEVELS = [
    { shape: 'jar', mat: 'water', cols: 8, room: 0.42, open: 2, turns: [2, 3], target: 0.5, time: 60, bonus: 1 },
    { shape: 'bottle', mat: 'balls', cols: 8, room: 0.4, open: 2, turns: [2, 4], target: 0.55, time: 60, bonus: 1 },
    { shape: 'heart', mat: 'candy', cols: 9, room: 0.38, open: 2, turns: [3, 4], target: 0.6, time: 70, bonus: 1 },
    { shape: 'square', mat: 'pills', cols: 9, room: 0.36, open: 2, turns: [3, 5], target: 0.6, time: 70, bonus: 2 },
    { shape: 'ellipse', mat: 'salt', cols: 10, room: 0.34, open: 1, turns: [3, 5], target: 0.6, time: 70, bonus: 2 },
    { shape: 'pudding', mat: 'honey', cols: 9, room: 0.36, open: 2, turns: [3, 5], target: 0.5, time: 90, bonus: 2 },
    { shape: 'cloud', mat: 'lottery', cols: 10, room: 0.34, open: 1, turns: [4, 6], target: 0.65, time: 70, bonus: 2 },
    { shape: 'cat', mat: 'sugar', cols: 11, room: 0.3, open: 1, turns: [4, 6], target: 0.62, time: 90, bonus: 2 },
    { shape: 'heart', mat: 'water', cols: 11, room: 0.3, open: 1, turns: [5, 7], target: 0.7, time: 60, bonus: 2 },
    { shape: 'jar', mat: 'candy', cols: 12, room: 0.28, open: 1, turns: [5, 7], target: 0.7, time: 95, bonus: 3 },
    { shape: 'bottle', mat: 'honey', cols: 11, room: 0.28, open: 1, turns: [5, 7], target: 0.62, time: 110, bonus: 3 },
    { shape: 'square', mat: 'lottery', cols: 11, room: 0.3, open: 1, turns: [5, 7], target: 0.7, time: 100, bonus: 3 },
    { shape: 'cat', mat: 'salt', cols: 11, room: 0.3, open: 1, turns: [5, 7], target: 0.65, time: 120, bonus: 3 },
    { shape: 'cloud', mat: 'pills', cols: 12, room: 0.26, open: 1, turns: [6, 8], target: 0.8, time: 75, bonus: 3 },
  ];

  // 第 15 關之後：無盡模式，隨機組合，難度緩慢上升到上限
  PM.getLevel = function (index) {
    if (index < PM.LEVELS.length) return Object.assign({ n: index + 1 }, PM.LEVELS[index]);
    const k = index - PM.LEVELS.length;
    const rng = U.makeRng(9173 + index * 131);
    const prev = PM.getLevel(index - 1);
    let shape, mat;
    do { shape = U.pick(PM.SHAPE_IDS, rng); } while (shape === prev.shape);
    do { mat = U.pick(PM.MATERIAL_IDS, rng); } while (mat === prev.mat);
    return {
      n: index + 1, shape, mat,
      cols: Math.min(13, 12 + (k >> 2)), room: 0.27, open: 1,
      turns: [6, 8],
      target: Math.min(0.85, 0.72 + k * 0.01),
      time: mat === 'honey' || mat === 'salt' ? 120 : 105, bonus: 3,
    };
  };

  // 示範用（標題畫面背景）
  PM.DEMO_LEVEL = { n: 0, shape: 'jar', mat: 'candy', cols: 7, room: 0.5, open: 3, turns: [1, 3], target: 1, time: 999, bonus: 1 };
})();
