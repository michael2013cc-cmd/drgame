window.GD_Level = (function () {
  var BPM = 154;
  var BEAT_BLOCKS_1X = 10.386 * (60 / BPM);   // 4.046 格 = 一拍

  function spikeRun(startX, count, y) {
    var a = [];
    for (var i = 0; i < count; i++) a.push({ x: startX + i, y: y || 0, t: 'spike' });
    return a;
  }
  function pillar(x, h) {
    var a = [];
    for (var i = 0; i < h; i++) a.push({ x: x, y: i, t: 'block' });
    return a;
  }

  var objects = [].concat(
    // 开场 0–40：单尖刺 → 双尖刺，每 2 拍一个障碍
    spikeRun(14, 1),
    spikeRun(22, 1),
    spikeRun(30, 2),

    // 推进 40–110：柱阵 + 环 + 跳板
    pillar(42, 2),
    spikeRun(48, 1),
    { x: 52, y: 2.0, t: 'ring_pink' },
    pillar(58, 2),
    spikeRun(64, 2),
    { x: 70, y: 0, t: 'pad_pink' },
    spikeRun(74, 1, 0), spikeRun(75, 1, 0),
    pillar(82, 3),
    { x: 88, y: 2.4, t: 'ring_yellow' },
    spikeRun(94, 2),
    pillar(100, 2),
    spikeRun(106, 1),

    // 切船 110–118
    { x: 112, y: 0.5, t: 'portal_ship' },
    { x: 116, y: 0.5, t: 'speed_2x' },

    // 飞行 118–250：上下柱阵通道。@2x 一拍走 12.914*0.3896 = 5.03 格
    // 通道净空 4 格，玩家 1 格，容错 3 格
    pillar(126, 4), { x: 126, y: 8, t: 'block' }, { x: 126, y: 9, t: 'block' }, { x: 126, y: 10, t: 'block' },
    { x: 134, y: 0, t: 'block' }, { x: 134, y: 1, t: 'block' }, { x: 134, y: 7, t: 'block' }, { x: 134, y: 8, t: 'block' },
    pillar(142, 5), { x: 142, y: 9, t: 'block' }, { x: 142, y: 10, t: 'block' },
    { x: 150, y: 0, t: 'block' }, { x: 150, y: 1, t: 'block' }, { x: 150, y: 2, t: 'block' }, { x: 150, y: 8, t: 'block' },
    pillar(158, 3), { x: 158, y: 9, t: 'block' },
    { x: 166, y: 0, t: 'block' }, { x: 166, y: 1, t: 'block' }, { x: 166, y: 7, t: 'block' }, { x: 166, y: 8, t: 'block' },
    pillar(174, 6), { x: 174, y: 10, t: 'block' },
    { x: 182, y: 0, t: 'block' }, { x: 182, y: 6, t: 'block' }, { x: 182, y: 7, t: 'block' },
    pillar(190, 4), { x: 190, y: 9, t: 'block' }, { x: 190, y: 10, t: 'block' },
    { x: 198, y: 0, t: 'block' }, { x: 198, y: 1, t: 'block' }, { x: 198, y: 8, t: 'block' },
    pillar(206, 5), { x: 206, y: 10, t: 'block' },
    { x: 214, y: 0, t: 'block' }, { x: 214, y: 2, t: 'block' }, { x: 214, y: 7, t: 'block' },
    pillar(222, 3), { x: 222, y: 8, t: 'block' }, { x: 222, y: 9, t: 'block' },
    { x: 230, y: 0, t: 'block' }, { x: 230, y: 1, t: 'block' }, { x: 230, y: 9, t: 'block' },
    pillar(238, 4), { x: 238, y: 10, t: 'block' },

    // 回方块 254：门与降速同点，段落边界与传送门位置严格一致
    { x: 253, y: 1.0, t: 'portal_cube' },
    { x: 254, y: 1.0, t: 'speed_1x' },

    // 收尾 258–360：密集节奏段
    spikeRun(264, 1),
    spikeRun(272, 2),
    pillar(280, 2),
    spikeRun(286, 1), { x: 288, y: 2.0, t: 'ring_pink' },
    spikeRun(294, 2),
    { x: 300, y: 0, t: 'pad_pink' },
    spikeRun(304, 1), spikeRun(305, 1),
    pillar(312, 2),
    spikeRun(318, 2),
    pillar(324, 3),
    spikeRun(330, 1),
    { x: 334, y: 2.4, t: 'ring_yellow' },
    spikeRun(340, 3),
    { x: 352, y: 0, t: 'finish' }
  );

  var crossbeat = {
    meta: { name: 'Crossbeat', bpm: BPM, endBlock: 360, beatBlocks1x: BEAT_BLOCKS_1X },
    segments: [
      { from: 0,   to: 110, mode: 'cube', speed: 1, theme: 'blue'   },   // 10.591 s
      { from: 110, to: 118, mode: 'cube', speed: 1, theme: 'blue'   },   //  0.770 s  切船过渡
      { from: 118, to: 254, mode: 'ship', speed: 2, theme: 'violet' },   // 10.531 s
      { from: 254, to: 360, mode: 'cube', speed: 1, theme: 'blue'   }    // 10.206 s
    ],
    // 合计 32.098 s，落在 L2 测试的 32.0 ± 2% 容差内
    objects: objects
  };

  var VALID_TYPES = ['spike', 'block', 'pad_pink', 'pad_yellow', 'ring_pink', 'ring_yellow',
                     'portal_ship', 'portal_cube', 'speed_1x', 'speed_2x', 'speed_3x', 'speed_4x', 'finish'];

  function validate(lv) {
    var errs = [];
    if (!lv.meta) errs.push('缺 meta');
    if (!Array.isArray(lv.objects)) errs.push('缺 objects 数组');
    if (!Array.isArray(lv.segments)) errs.push('缺 segments 数组');
    if (lv.meta && typeof lv.meta.endBlock !== 'number') errs.push('meta.endBlock 非数字');
    if (lv.objects) {
      for (var i = 0; i < lv.objects.length; i++) {
        var o = lv.objects[i];
        if (typeof o.x !== 'number' || typeof o.y !== 'number') errs.push('对象缺 x/y: #' + i);
        if (VALID_TYPES.indexOf(o.t) < 0) errs.push('未知类型: ' + o.t + ' #' + i);
      }
    }
    if (lv.segments) {
      for (var s = 0; s < lv.segments.length; s++) {
        var sg = lv.segments[s];
        if (['cube', 'ship'].indexOf(sg.mode) < 0) errs.push('非法 mode: ' + sg.mode);
        if (typeof sg.from !== 'number' || typeof sg.to !== 'number') errs.push('段落缺 from/to #' + s);
      }
    }
    return errs;
  }

  return { crossbeat: crossbeat, validate: validate, VALID_TYPES: VALID_TYPES };
})();
