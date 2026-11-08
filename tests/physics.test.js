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

  // coyote 探针必须走台沿：平地长按那个循环永远不离开地面，多长的宽限期都勾不出来。
  // 台沿此前也勾不出来——旧 stepCube 在失去支撑那一步把 y 从台面直接吸附到 0，全程
  // onGround 为真（实测 x=5.5246 一步 1→0，两格台是 2→0），现在放成自由落体才验得了。
  // 对照组实测：给 12 步（0.05 s）宽限期则 vy 回升 12 次、顶点回到 21.88，用例能跑红。
  var objs = [];
  for (var b = 1; b <= 4; b++) objs.push({ x: b, y: 0, t: 'block' });
  var cs = GD_Physics.create(LV(objs));
  cs.x = 1.5; cs.y = 1; cs.onGround = true;          // 站在台面（顶 y=1）上
  var kk = 0;
  while (cs.onGround && kk < 300) { GD_Physics.step(cs, false); kk++; }
  GD_ASSERT.ok(!cs.onGround, '走下台沿应进入自由落体，实测 ' + kk + ' 步后 y=' + cs.y);
  GD_ASSERT.near(cs.y, 0.999, 0.01, '失去地面那步仍在台面上方（实测 0.999；旧吸附写法这里是 0）');
  GD_ASSERT.near(cs.vy, -0.479, 0.01, '落体从静止起步，一步重力的增量（实测 -0.479）');
  var reJump = 0, prevVy = cs.vy;
  for (var h = 0; h < 12; h++) {                     // 离地后 0.05 s 宽限期窗口
    GD_Physics.step(cs, true);
    if (cs.vy >= prevVy) reJump++;                   // 有宽限期就会在这里把 vy 重置回 JUMP_V0
    prevVy = cs.vy;
  }
  GD_ASSERT.ok(!cs.onGround, '宽限期窗口内应仍在下落，实得 y=' + cs.y + ' 第 ' + kk + ' 步离地');
  GD_ASSERT.ok(reJump === 0, '离地后长按 0.05 s 不该补到起跳，vy 回升 ' + reJump + ' 次');
  // 浮空冻结（onGround 假但 vy 不再积分）能同时躲过上面两条，所以把落地也钉住。
  // 期望步数由解析式现算、不从实测反推：台面顶 y=1，静止落下 1 格要 √(2·1/g)，
  // 离地那步 + 宽限期 12 步已用掉 13 步，实测余 19 步、总滞空 32 步。
  var analytic = Math.round(Math.sqrt(2 * 1 / GD_Physics.CONST.G) / GD_Physics.CONST.DT);
  var fall = 0;
  while (!cs.onGround && fall < 60) { GD_Physics.step(cs, false); fall++; }
  GD_ASSERT.ok(cs.onGround, '松手后应落回地面，窗口后再走 ' + fall + ' 步仍 y=' + cs.y);
  GD_ASSERT.near(1 + 12 + fall, analytic, 2, '离地到落地的总滞空步数（解析 ' + analytic + '，实测 32）');
  // 上升段不另开探针：长按连跳那个循环已经在钉 bounced，空中若多发一次起跳计数就会翻。
});

GD_ASSERT.test('L1 关卡数据自洽', function () {
  var errs = GD_Level.validate(GD_Level.crossbeat);
  GD_ASSERT.ok(errs.length === 0, '校验错误: ' + errs.join(' | '));
});

GD_ASSERT.test('L2 段落时长合计 32.0 秒', function () {
  var lv = GD_Level.crossbeat, t = 0, S = GD_Physics.CONST.SPEEDS;
  for (var i = 0; i < lv.segments.length; i++) {
    var sg = lv.segments[i];
    t += (sg.to - sg.from) / S[sg.speed];
  }
  GD_ASSERT.approx(t, 32.0, 0.02, '总时长秒');
});

GD_ASSERT.test('L3 对象不越界、尖刺两两不重叠、门框不压障碍、回方块门必定触发', function () {
  var lv = GD_Level.crossbeat, objs = lv.objects, end = lv.meta.endBlock;
  for (var i = 0; i < objs.length; i++) {
    GD_ASSERT.ok(objs[i].x >= 0 && objs[i].x <= end, '对象越界: ' + objs[i].t + '@' + objs[i].x);
  }
  var hazards = objs.filter(function (o) { return o.t === 'spike'; });
  for (var a = 0; a < hazards.length; a++) {
    for (var b = 0; b < hazards.length; b++) {
      if (a !== b && Math.abs(hazards[a].x - hazards[b].x) < 0.9 && hazards[a].y === hazards[b].y) {
        throw new Error('尖刺重叠 @' + hazards[a].x);
      }
    }
  }
  // 传送门/速度门的触发框不能压住尖刺或方块：压住了玩家就会死在门旁边而不是被门传送。
  // 框的尺寸直接读 physics 的常量，不在测试里另抄一份（抄一份就会各自漂移）。
  var HIT = GD_Physics.CONST.HIT, C = GD_Physics.CONST;
  var gates = objs.filter(function (o) { return o.t.indexOf('portal_') === 0 || o.t.indexOf('speed_') === 0; });
  var solids = objs.filter(function (o) { return o.t === 'spike' || o.t === 'block'; });
  for (var g = 0; g < gates.length; g++) {
    var gb = { x0: gates[g].x, x1: gates[g].x + HIT.GATE_W, y0: gates[g].y, y1: gates[g].y + HIT.GATE_H };
    for (var s = 0; s < solids.length; s++) {
      var sb = solids[s].t === 'spike'
        ? { x0: solids[s].x + 0.5 - C.SPIKE_HW / 2, x1: solids[s].x + 0.5 + C.SPIKE_HW / 2,
            y0: solids[s].y, y1: solids[s].y + C.SPIKE_HH }
        : { x0: solids[s].x, x1: solids[s].x + 1, y0: solids[s].y, y1: solids[s].y + 1 };
      if (gb.x0 < sb.x1 && gb.x1 > sb.x0 && gb.y0 < sb.y1 && gb.y1 > sb.y0) {
        throw new Error('传送门触发框压住 ' + solids[s].t + '@' + solids[s].x + ',' + solids[s].y +
                       '（门 ' + gates[g].t + '@' + gates[g].x + ',' + gates[g].y + '）');
      }
    }
  }
  // 回方块的门与降速门必须真的能触发。
  // 玩家贴地时框是 [0,1]；门放在 y=1.0 时触发框是 [1,3.6]，两者只在 y=1 处相接，
  // 而 overlap 用的是严格不等号 → 永远不重叠 → 门形同虚设：
  // 实测贴地跑过 x=253 仍是飞船模式，随后撞死在 x=264 的第一根尖刺。
  // 门贴地（y=0.5）后触发窗口是 y∈(-0.5, 3.1)，松手落地的玩家必然命中。
  var g2 = GD_Physics.create(lv);
  g2.mode = 'ship'; g2.speedKey = 2; g2.x = 250; g2.y = 0; g2.vy = 0; g2.onGround = false;
  for (var s2 = 0; s2 < 240 * 3 && g2.x < 258; s2++) GD_Physics.step(g2, false);
  GD_ASSERT.ok(g2.mode === 'cube',
    '贴地跑过回方块门后应切成 cube，实为 ' + g2.mode + '（x=' + g2.x.toFixed(2) + '）');
  GD_ASSERT.ok(g2.speedKey === 1,
    '贴地跑过降速门后应回到 1x，实为 ' + g2.speedKey);
});
