GD_ASSERT.test('T3 回放序列通关 Crossbeat', function () {
  var st = GD_Physics.create(GD_Level.crossbeat);
  var seq = GD_Replay.crossbeat, si = 0, held = false, diedAt = -1;
  var maxSteps = 240 * 40;
  // 记录模式/速度的切换点：漏掉任一速度门，回放也会 finished=true，只是时长变了
  var sw = { mode: [], speed: [] }, prevMode = st.mode, prevSpeed = st.speedKey;
  for (var n = 0; n < maxSteps && !st.finished; n++) {
    while (si < seq.length && seq[si].t <= st.time) { held = seq[si].d; si++; }
    GD_Physics.step(st, held);
    if (st.mode !== prevMode) { sw.mode.push(st.x); prevMode = st.mode; }
    if (st.speedKey !== prevSpeed) { sw.speed.push(st.x); prevSpeed = st.speedKey; }
    if (!st.alive && diedAt < 0) diedAt = st.x;
    if (!st.alive) break;
  }
  if (!st.finished) {
    throw new Error('未通关：percent=' + st.percent.toFixed(1) +
      '% 停在 x=' + st.x.toFixed(1) + (diedAt >= 0 ? '，首次死亡 @' + diedAt.toFixed(1) : ''));
  }
  GD_ASSERT.ok(st.percent >= 100, 'percent 应 ≥100');
  // 时长也要钉住：漏掉 speed_2x@116 → 全程 1x → 34.66 s；漏掉 speed_1x@254 → 后半段跑 2x → 30.05 s。
  // 这两种"假通关"的 finished 也是 true，只断 finished/percent 会放过它们。
  GD_ASSERT.ok(st.time >= 31.36 && st.time <= 32.64,
    '通关时长应在 32.0 ±2% 内，实测 ' + st.time.toFixed(4) + ' s');
  // 四个切换点：真实速度剖面是 1x[0,115.5] / 2x(115.5,253.5] / 1x[253.5,360]
  GD_ASSERT.ok(sw.mode.length === 2, '应有两次模式切换，实测 ' + sw.mode.length);
  GD_ASSERT.ok(sw.speed.length === 2, '应有两次速度切换，实测 ' + sw.speed.length);
  GD_ASSERT.near(sw.mode[0], 111.5, 0.5, '切成飞船的 x');
  GD_ASSERT.near(sw.speed[0], 115.5, 0.5, '变 2x 的 x');
  GD_ASSERT.near(sw.mode[1], 252.5, 0.5, '切回方块的 x');
  GD_ASSERT.near(sw.speed[1], 253.5, 0.5, '回 1x 的 x');
});
