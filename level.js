window.GD_Level = (function () {
  var BPM = 154;

  function spikeRun(startX, count, y) {
    var a = [];
    for (var i = 0; i < count; i++) a.push({ x: startX + i, y: y || 0, t: 'spike' });
    return a;
  }
  // cube 段的柱子限高 2 格：单跳顶点 2.17，3 格柱实测 65 个起跳阈值 0 个能通过。
  // 长按能蹭过去不算合法路线——那是 LAND_TOL 把人吸上墙肩后再起跳的副作用。
  function pillar(x, h) {
    var a = [];
    for (var i = 0; i < h; i++) a.push({ x: x, y: i, t: 'block' });
    return a;
  }

  var objects = [].concat(
    // 开场 0–40：单尖刺 → 双尖刺，每 2 拍一个障碍（1 拍 = 4.046 格，8 格 = 1.98 拍）
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
    pillar(82, 2),
    { x: 88, y: 2.4, t: 'ring_yellow' },
    spikeRun(94, 2),
    pillar(100, 2),
    spikeRun(106, 1),

    // 切船 110–118：门都贴着地面（y=0.5），与地面线齐平
    { x: 112, y: 0.5, t: 'portal_ship' },
    { x: 116, y: 0.5, t: 'speed_2x' },

    // 飞行 118–254：上下柱阵通道。@2x 一拍走 12.914*0.3896 = 5.03 格
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
    { x: 214, y: 0, t: 'block' }, { x: 214, y: 1, t: 'block' }, { x: 214, y: 2, t: 'block' }, { x: 214, y: 7, t: 'block' },
    pillar(222, 3), { x: 222, y: 8, t: 'block' }, { x: 222, y: 9, t: 'block' },
    { x: 230, y: 0, t: 'block' }, { x: 230, y: 1, t: 'block' }, { x: 230, y: 9, t: 'block' },
    pillar(238, 4), { x: 238, y: 10, t: 'block' },

    // 回方块：切船门在 x=112、降速门在 x=116，两扇门都贴地（y=0.5）。
    // 触发点是玩家前沿（x+0.5）碰到门的 x，所以实际切换发生在 x≈111.5 / 115.5，
    // 段落的 118 / 254 只是主题分段点——两者不是一回事，别再写成"严格相等"。
    // 回方块这扇门同样必须贴地：触发框从 o.y 往上延伸，玩家贴地时框是 [0,1]，
    // 门放在 y=1.0 时 1 > 1 不成立，门永远不触发——实测贴地跑过 x=253 仍是飞船模式，
    // 随后撞死在 x=264 的第一根尖刺。
    // Task 7 把触发框改成了**通高**（GATE_H = 256 格，框是 [0.5, 256.5]）：
    // 通道内的玩家（y≲11）和出口前一小段内起飞的人都能命中。
    // 但这**不是**"飞到多高都不会错过"——飞船段没有封顶，玩家理论上能飞到 y≥256.5
    // 仍会错过这扇门（那个洞记在 spec §13，要靠关卡封顶解决，不是靠门框）。
    // 门的底边仍是 0.5——不能改成 0，否则悬在半空的门会被地面上的玩家触发，语义就错了。
    { x: 253, y: 0.5, t: 'portal_cube' },
    { x: 254, y: 0.5, t: 'speed_1x' },

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
    pillar(324, 2),
    spikeRun(330, 1),
    { x: 334, y: 2.4, t: 'ring_yellow' },
    spikeRun(340, 2),   // 三连刺打不过：y>=0.55 的窗口只有 3.49 格，三刺要 3.55
    { x: 360, y: 0, t: 'finish' }   // 旗子与 endBlock 同点：越过 x=360 的瞬间判通关
  );

  var crossbeat = {
    meta: { name: 'Crossbeat', bpm: BPM, endBlock: 360 },
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
  // 合法门速。写在这里而不是从 physics 读：level.js 是纯数据层，不能反向依赖物理层。
  var VALID_SPEEDS = [0.5, 1, 2, 3, 4];

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
        // 对象不能落在终点之后：那样它永远不会被玩家碰到，等于白放一个障碍
        if (lv.meta && typeof lv.meta.endBlock === 'number' && o.x > lv.meta.endBlock) {
          errs.push('对象越过终点: ' + o.t + '@' + o.x);
        }
      }
    }
    if (lv.segments) {
      for (var s = 0; s < lv.segments.length; s++) {
        var sg = lv.segments[s];
        if (['cube', 'ship'].indexOf(sg.mode) < 0) errs.push('非法 mode: ' + sg.mode);
        if (typeof sg.from !== 'number' || typeof sg.to !== 'number') errs.push('段落缺 from/to #' + s);
        else {
          if (sg.to <= sg.from) errs.push('段落 from>=to #' + s + ' (' + sg.from + '→' + sg.to + ')');
          if (VALID_SPEEDS.indexOf(sg.speed) < 0) errs.push('非法 speed: ' + sg.speed + ' #' + s);
        }
      }
      // 段落必须首尾相接且从 0 开始：Task 12 的 tOf() 按段落做分段积分，
      // 段落之间留缝会让"到达 x 的时刻"整体算偏。
      if (lv.segments.length && lv.segments[0].from !== 0) errs.push('第一个段落必须从 0 开始');
      for (var k = 1; k < lv.segments.length; k++) {
        if (lv.segments[k].from !== lv.segments[k - 1].to) {
          errs.push('段落不连续: #' + (k - 1) + ' 结束于 ' + lv.segments[k - 1].to +
                    '，#' + k + ' 从 ' + lv.segments[k].from + ' 开始');
        }
      }
    }
    return errs;
  }

  return { crossbeat: crossbeat, validate: validate, VALID_TYPES: VALID_TYPES };
})();
