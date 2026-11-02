GD_ASSERT.test('T1 方块跳跃常数', function () {
  var m = GD_Physics.measureJump(1);
  GD_ASSERT.approx(m.airtime, 0.389, 0.02, '滞空秒');
  GD_ASSERT.approx(m.apex, 2.17, 0.02, '顶点格');
  GD_ASSERT.approx(m.span, 4.04, 0.02, '@1x 跳距格');
  // 积分器指纹：上面三条的 2% 相对容差**拦不住**半隐式欧拉。
  // 实测（dt=1/240, v0=22.36, g=115）三种积分的顶点：
  //   velocity-Verlet    2.173668  （对 2.17 偏差 0.17%，对解析值 v0²/(2g)（由 CONST 现算）偏差 0.005%）
  //   欧拉·先减速度     2.127420  （对 2.17 偏差 1.96% → 落在 2% 容差内，会被放过）
  //   欧拉·先加位置     2.220587  （偏差 2.33%，只是勉强红）
  // 容差下限 2.17×0.98 = 2.1266，欧拉·先减速度 距它只差 0.0008 格。
  // 所以必须再钉一条绝对精度：Verlet 距解析顶点 0.00011，两种欧拉各差约 0.046，
  // 0.002 的绝对容差把两者都关在外面，且不会因浮点噪声误红。
  GD_ASSERT.near(m.apex,
    GD_Physics.CONST.JUMP_V0 * GD_Physics.CONST.JUMP_V0 / (2 * GD_Physics.CONST.G),
    0.002, 'Verlet 积分指纹');
});

GD_ASSERT.test('T2 五档门速与速度门切换', function () {
  var want = { 0.5: 8.372, 1: 10.386, 2: 12.914, 3: 15.600, 4: 19.200 };
  // 五档全收集完再断言：run() 一条用例只在第一个抛出处中止，
  // 逐档直接 assert 的话一次只能看到一档坏了，其余三档要等修完再跑才暴露。
  var bad = [];
  for (var k in want) {
    if (!Object.prototype.hasOwnProperty.call(want, k)) continue;
    // 关卡必须带非空 segments：Task 2 修掉 respawn 的静默回退之后，
    // 缺 segments 的关卡在死亡重开时会抛错，而不是悄悄变成 cube 1x。
    var st = GD_Physics.create({
      segments: [{ from: 0, to: 1e9, mode: 'cube', speed: 1 }],
      objects: [],
      meta: { endBlock: 1e9 }
    });
    st.speedKey = parseFloat(k);
    for (var i = 0; i < 240; i++) GD_Physics.step(st, false);
    var err = Math.abs(st.x - want[k]) / want[k];
    if (err > 0.02) {
      bad.push(k + 'x 期望 ' + want[k] + ' 实得 ' + st.x + '（偏 ' + (err * 100).toFixed(2) + '%）');
    }
  }
  GD_ASSERT.ok(bad.length === 0, '门速表: ' + bad.join(' | '));

  // 上面是直接写 st.speedKey，绕过了 collide 里的 speed_* 分支——那个分支此前零覆盖。
  // 必须补：vxOf 的 `|| SPEEDS[1]` 回退会把认不出的速度门静默当成 1x，
  // 实测写错一个键名（speed_05x）后 st.x 精确等于 1x 那一行的 10.386，测试照样绿。
  var pst = GD_Physics.create({
    segments: [{ from: 0, to: 1e9, mode: 'cube', speed: 1 }],
    objects: [{ x: 5, y: 0, t: 'speed_2x' }],
    meta: { endBlock: 1e9 }
  });
  for (var j = 0; j < 240; j++) GD_Physics.step(pst, false);   // 前 5 格走 1x，之后过门
  GD_ASSERT.ok(pst.speedKey === 2, '过 speed_2x 门后 speedKey 应为 2，实得 ' + pst.speedKey);
  var xBefore = pst.x;
  for (var m = 0; m < 240; m++) GD_Physics.step(pst, false);
  GD_ASSERT.approx(pst.x - xBefore, 12.914, 0.02, '过门后 1 秒水平位移');
});

GD_ASSERT.test('T2b 2x 门的真实倍率是 1.243 而非 2', function () {
  var m1 = GD_Physics.measureJump(1), m2 = GD_Physics.measureJump(2);
  GD_ASSERT.approx(m2.span / m1.span, 1.243, 0.03, '跳距倍率');
  // 滞空与水平速度**完全无关**：竖直轨迹只有 v0 和 g，落地步数一模一样。
  // spec §4.1 说原版 0.389 → 0.398 微变，那是原版按帧子步的产物；我们的定步长
  // 实现是解析相等，所以这里钉成精确相等，不要写成 1.023 那种"看着像"的比值。
  GD_ASSERT.near(m2.airtime, m1.airtime, 1e-9, '滞空不随速度变');
});

// 本任务三条用例都要重开（T5a 直接撞死，T5b/T5c 也可能死），
// 所以关卡必须带非空 segments：Task 2 已把 respawn 的静默回退拆掉，
// 缺 segments 会在重开时抛 TypeError，而不是悄悄退回 cube 1x。
var LV = function (objs) {
  return {
    segments: [{ from: 0, to: 1000, mode: 'cube', speed: 1 }],
    objects: objs,
    meta: { endBlock: 1000 }
  };
};

GD_ASSERT.test('T5a 撞尖刺死亡并从 0% 重开', function () {
  var st = GD_Physics.create(LV([{ x: 8, y: 0, t: 'spike' }]));
  var steps = 0;
  while (st.alive && steps < 240 * 5) { GD_Physics.step(st, false); steps++; }
  GD_ASSERT.ok(!st.alive, '应已死亡');
  for (var i = 0; i < 240; i++) GD_Physics.step(st, false);   // 跨过 1.0 s 延迟
  GD_ASSERT.ok(st.alive, '1 秒后应自动重开');
  GD_ASSERT.near(st.x, 0, 0.05, '重开位置');
  GD_ASSERT.ok(st.attempt === 2, 'attempt 应为 2，实为 ' + st.attempt);
});

GD_ASSERT.test('T5b 跳过 2 格墙，撞 3 格墙死亡', function () {
  var span = GD_Physics.measureJump(1).span;      // 用实测跳距，不硬编码
  // 起跳点取"距墙半跳"而不是"距墙一整跳"。一整跳起跳会让人**落在墙上**而不是跳过墙：
  // 实测 6-span≈1.93 起跳时，下落途中 x=5.50 处 LAND_TOL 先把第 1 格的顶（y=1）
  // 当成可站面，把玩家吸到 y=1，等于钻进第 2 格内部，随后被缩小框判死。
  // 半跳起跳让顶点正好在墙前沿（顶点 2.17 > 墙高 2），实测可通过的起跳区间是
  // x∈[2.5, 4.6]，6-span/2≈3.97 落在区间正中。
  var takeoffX = 6 - span / 2;
  function trial(wallH) {
    var objs = [];
    for (var i = 0; i < wallH; i++) objs.push({ x: 6, y: i, t: 'block' });
    var st = GD_Physics.create(LV(objs));
    var jumped = false;
    for (var s = 0; s < 240 * 2 && st.alive; s++) {
      var want = !jumped && st.x >= takeoffX && st.onGround;
      if (want) jumped = true;
      GD_Physics.step(st, want);
    }
    return st.alive;
  }
  GD_ASSERT.ok(trial(2) === true, '2 格墙应能跳过');
  GD_ASSERT.ok(trial(3) === false, '3 格墙应撞死');
});

GD_ASSERT.test('T5c 无 coyote time，长按落地自动连跳', function () {
  var st = GD_Physics.create(LV([]));
  GD_Physics.step(st, true);
  var minY = 99, bounced = 0, prevGround = true;
  for (var i = 0; i < 240 * 3; i++) {
    GD_Physics.step(st, true);
    if (st.onGround && !prevGround) bounced++;
    prevGround = st.onGround;
    if (st.y < minY) minY = st.y;
  }
  GD_ASSERT.near(minY, 0, 0.001, '不应穿地');
  GD_ASSERT.ok(bounced >= 2, '长按应自动连跳，实际连跳 ' + bounced + ' 次');
});
