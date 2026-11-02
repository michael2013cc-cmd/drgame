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

GD_ASSERT.test('T2 四档门速 1 秒水平位移', function () {
  var want = { 0.5: 8.372, 1: 10.386, 2: 12.914, 3: 15.600, 4: 19.200 };
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
    GD_ASSERT.approx(st.x, want[k], 0.02, k + 'x 速度');
  }
});

GD_ASSERT.test('T2b 2x 门的真实倍率是 1.243 而非 2', function () {
  var m1 = GD_Physics.measureJump(1), m2 = GD_Physics.measureJump(2);
  GD_ASSERT.approx(m2.span / m1.span, 1.243, 0.03, '跳距倍率');
  // 滞空与水平速度**完全无关**：竖直轨迹只有 v0 和 g，落地步数一模一样。
  // spec §4.1 说原版 0.389 → 0.398 微变，那是原版按帧子步的产物；我们的定步长
  // 实现是解析相等，所以这里钉成精确相等，不要写成 1.023 那种"看着像"的比值。
  GD_ASSERT.near(m2.airtime, m1.airtime, 1e-9, '滞空不随速度变');
});
