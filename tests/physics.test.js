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
  var deathX = st.x;
  GD_ASSERT.ok(!st.alive, '应已死亡，跑到第 ' + steps + ' 步 x=' + deathX + ' 仍活着');
  // 只断言 !alive 的话任何一次误判早死都能绿灯，所以把死亡瞬间的 x 钉住：实测 7.7462，
  // 即玩家前沿 x1=st.x+0.5 首次进入致死框 x∈[8.225, 8.775]（SPIKE_HB 0.55）那一步。
  GD_ASSERT.near(deathX, 7.75, 0.15, '尖刺致死点 x（实测 7.7462，第 ' + steps + ' 步）');
  // 反证：同一关卡把刺拆掉，同样步数还活着——证明这次死亡来自这根刺而不是别的判定。
  var ctl = GD_Physics.create(LV([]));
  for (var c = 0; c < steps; c++) GD_Physics.step(ctl, false);
  GD_ASSERT.ok(ctl.alive, '去掉尖刺后第 ' + steps + ' 步应仍活着，实得 x=' + ctl.x);
  // 等待步数由常数导出：写死 240 只在 DEATH_DELAY=1.0 时成立，改成 0.5 就 120 步重开，
  // 剩下 120 步是活跑（x 白走 5.19 格），正确的实现反而被跑红。
  var wait = Math.round(GD_Physics.CONST.DEATH_DELAY / GD_Physics.CONST.DT);
  for (var i = 0; i < wait; i++) GD_Physics.step(st, false);
  GD_ASSERT.ok(st.alive, 'DEATH_DELAY（' + wait + ' 步）后应自动重开');
  GD_ASSERT.near(st.x, 0, 0.05, '重开位置');
  // percent/time 不由 x 推出来，respawn 漏清就是"从死点继续"，x=0 也照样绿灯
  GD_ASSERT.ok(st.percent === 0, '重开后 percent 应为 0，实为 ' + st.percent);
  GD_ASSERT.ok(st.time === 0, '重开后 time 应为 0，实为 ' + st.time);
  GD_ASSERT.ok(st.attempt === 2, 'attempt 应为 2，实为 ' + st.attempt);
});

GD_ASSERT.test('T5b 跳过 2 格墙，撞 3 格墙死亡', function () {
  var span = GD_Physics.measureJump(1).span;      // 用实测跳距，不硬编码
  // 起跳点取"距墙半跳"而不是"距墙一整跳"。一整跳起跳会让人**落在墙上**而不是跳过墙：
  // 实测 6-span≈1.93 起跳时，下落途中 x=5.50 处 LAND_TOL 先把第 1 格的顶（y=1）
  // 当成可站面，把玩家吸到 y=1，等于钻进第 2 格内部，随后被缩小框判死。
  // 半跳起跳让顶点正好在墙前沿（顶点 2.17 > 墙高 2）。把起跳阈值从 1.00 扫到 5.95
  // （步长 0.05）实测可通过区间连续无空洞 x∈[2.5, 5.45]，6-span/2≈3.966 落在正中（中点 3.975）；
  // 阈值不是触发起跳的 x——起跳发生在第一个 x≥阈值的模拟步，实测 x=3.9813，差一个步长量化。
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
    return { alive: st.alive, x: st.x, y: st.y };
  }
  var over = trial(2);
  GD_ASSERT.ok(over.alive, '2 格墙应能跳过');
  // 活着不等于翻过了墙：480 步内实测跑到 x=20.77，必须确已越过 x=6 的墙柱才算跳过
  GD_ASSERT.ok(over.x > 8, '2 格墙应跳过后跑到墙后，实得 x=' + over.x + '（实测 20.77）');
  var hit = trial(3);
  GD_ASSERT.ok(!hit.alive, '3 格墙应撞死');
  // 且要死在墙柱里：实测 x=6.2316、y=2.1454（顶到第 3 格的侧面），死在别处就是判定的锅
  GD_ASSERT.ok(hit.x > 6 && hit.x < 7,
    '3 格墙应死在 x∈(6,7) 的墙柱内，实得 x=' + hit.x + ' y=' + hit.y + '（实测 6.2316 / 2.1454）');
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
  // 实测 7 次；6 是给合法常数微调留的余量，原来的 2 低到"只弹两次也算连跳"
  GD_ASSERT.ok(bounced >= 6, '长按应自动连跳，实际连跳 ' + bounced + ' 次');

  // coyote 探针。平地长按那个循环永远不离开地面，勾不出宽限期，所以要用台沿——
  // 但实测走下台沿并不产生空中态：无输入从 y=1 台面（block y=0、x=1..4）走到 x=5.5439
  // 那一步，stepCube 把 y 一步吸附到 0，全程 onGround 为真（空中态 0 步，台面高 2 格
  // 时同样一步吸到底）。于是"离开地面"只能由起跳造成，宽限期窗口从失去地面那步起算。
  var objs = [];
  for (var b = 1; b <= 4; b++) objs.push({ x: b, y: 0, t: 'block' });
  var cs = GD_Physics.create(LV(objs));
  cs.x = 1; cs.y = 1; cs.onGround = true;          // 站在台面上，台面顶 y=1
  GD_Physics.step(cs, true);                       // 起跳，这一步之后就不在地面了
  for (var w = 0; w < 3; w++) GD_Physics.step(cs, false);   // 先松手，边沿触发的宽限期也要能勾出来
  var reJump = 0, prevVy = cs.vy;
  for (var g = 0; g < 10; g++) {
    GD_Physics.step(cs, true);
    if (cs.vy >= prevVy) reJump++;        // 有宽限期就会在这里把 vy 重置回 JUMP_V0
    prevVy = cs.vy;
  }
  GD_ASSERT.ok(!cs.onGround, 'coyote 窗口应仍在空中，否则被落地重置污染，实测 y=' + cs.y);
  GD_ASSERT.ok(reJump === 0, '离地后按住 10 步不该再拿到起跳，vy 回升 ' + reJump + ' 次');
  for (var q = 0; q < 60 && cs.vy > 0; q++) GD_Physics.step(cs, true);   // 爬到顶点
  var fellBad = 0, prevY = cs.y;
  for (var d = 0; d < 10; d++) {
    GD_Physics.step(cs, true);
    if (!(cs.vy < 0 && cs.y < prevY)) fellBad++;   // 下落段长按：vy 须为负、y 须继续降
    prevY = cs.y;
  }
  GD_ASSERT.ok(fellBad === 0,
    '下落段按住不该起跳，异常 ' + fellBad + ' 步，末态 y=' + cs.y + ' vy=' + cs.vy);
});
