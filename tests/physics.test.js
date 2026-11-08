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

GD_ASSERT.test('L3 对象不越界、无重复、尖刺不重叠、门框不压障碍、天花板连续且飞不过顶', function () {
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
  // 玩家贴地时框是 [0,1]；门放在 y=1.0 时触发框是 [1, 1+GATE_H]，两者只在 y=1 处相接，
  // 而 overlap 用的是严格不等号 → 永远不重叠 → 门形同虚设：
  // 实测贴地跑过 x=253 仍是飞船模式，随后撞死在 x=264 的第一根尖刺。
  // 门贴地（y=0.5）后触发窗口是 y∈(-0.5, 0.5+GATE_H)，GATE_H=256 时是 (-0.5, 256.5)，
  // 松手落地的玩家必然命中。
  var g2 = GD_Physics.create(lv);
  g2.mode = 'ship'; g2.speedKey = 2; g2.x = 250; g2.y = 0; g2.vy = 0; g2.onGround = false;
  for (var s2 = 0; s2 < 240 * 3 && g2.x < 258; s2++) GD_Physics.step(g2, false);
  GD_ASSERT.ok(g2.mode === 'cube',
    '贴地跑过回方块门后应切成 cube，实为 ' + g2.mode + '（x=' + g2.x.toFixed(2) + '）');
  GD_ASSERT.ok(g2.speedKey === 1,
    '贴地跑过降速门后应回到 1x，实为 ' + g2.speedKey);

  // 关卡里不该有位置完全相同的重复对象。天花板（y=9，x=118…252）会与通道里原有的
  // y=9 块（x=126/142/158/190/222/230）落在同一格——物理上无害（判定幂等），
  // 但那是冗余数据，而且会让人以为关卡里有两套东西。objects 拼好后统一去重过。
  var seenDup = Object.create(null), dupCount = 0;
  for (var di = 0; di < objs.length; di++) {
    var dk = objs[di].t + '@' + objs[di].x + ',' + objs[di].y;
    if (seenDup[dk]) dupCount++; else seenDup[dk] = true;
  }
  GD_ASSERT.ok(dupCount === 0, '关卡里有 ' + dupCount + ' 个位置重复的对象');

  // 飞船段的天花板必须**连续**，而且玩家飞不过顶。
  // 以前这里没有封顶：实测从切船门起一直按住能爬到 y=46.55，从柱阵顶上飞过整个
  // 飞船段，还能以 2x 直接飞过收尾段通关（spec §13 第 11 条）——关卡 1/3 的挑战是空的。
  // 天花板挡在 y=9 之后，飞船最高只到 8.72，按住不放会在 x≈120 撞顶死。
  var CEIL_Y = 9, CEIL_X0 = 118, CEIL_X1 = 252;
  var ceilAt = Object.create(null);
  for (var ci = 0; ci < objs.length; ci++) {
    if (objs[ci].t === 'block' && objs[ci].y === CEIL_Y) ceilAt[objs[ci].x] = true;
  }
  var ceilGaps = [];
  for (var cx = CEIL_X0; cx <= CEIL_X1; cx++) if (!ceilAt[cx]) ceilGaps.push(cx);
  GD_ASSERT.ok(ceilGaps.length === 0,
    '飞船段天花板必须连续（x∈[' + CEIL_X0 + ',' + CEIL_X1 + '] 每格一块），缺口 ' +
    ceilGaps.length + ' 处: ' + ceilGaps.slice(0, 8).join(','));

  // 行为层：按住不放也飞不过顶，更不可能以飞船状态通关。
  var holdSt = GD_Physics.create(lv);
  holdSt.x = 111.5; holdSt.mode = 'ship'; holdSt.speedKey = 1;
  holdSt.y = 0; holdSt.vy = 0; holdSt.onGround = false;
  var holdTopY = 0;
  for (var hs = 0; hs < 240 * 40 && holdSt.alive && !holdSt.finished; hs++) {
    GD_Physics.step(holdSt, true);
    if (holdSt.y > holdTopY) holdTopY = holdSt.y;
  }
  GD_ASSERT.ok(holdTopY < CEIL_Y,
    '按住不放也飞不过天花板（y=' + CEIL_Y + '），实测最高 y=' + holdTopY.toFixed(2));
  GD_ASSERT.ok(!holdSt.finished,
    '按住不放不该能通关（那说明又从顶上飞过去了），实测 x=' + holdSt.x.toFixed(1) +
    ' percent=' + holdSt.percent.toFixed(1) + ' alive=' + holdSt.alive);
});

// P1/P2 复用上面 LV 助手（与文件里其它用例保持一致：关卡带非空 segments）。
GD_ASSERT.test('P1 跳板/跳环可达高度符合 spec §4.3', function () {
  var C = GD_Physics.CONST;
  // 常量先钉死。下面的高度是从 CONST 推出来的：CONST 漂了，高度断言会跟着漂，
  // 两边一起漂就没人发现了。所以"常量断言"和"高度指纹"分工不同，两个都要有——
  // 常量断言保证推的原料是 spec §4.3 的数，指纹保证物理实现本身是精确的。
  GD_ASSERT.near(C.PAD.pad_pink, 21.08, 0.001, 'spec §4.3 粉跳板速度');
  GD_ASSERT.near(C.PAD.pad_yellow, 32.28, 0.001, 'spec §4.3 黄跳板速度');
  GD_ASSERT.near(C.RING.ring_pink, 15.78, 0.001, 'spec §4.3 粉环速度');
  GD_ASSERT.near(C.RING.ring_yellow, 23.40, 0.001, 'spec §4.3 黄环速度');
  // 命中框尺寸同样是行为依据（板厚 0.35 格；环框 [o.x-0.6, o.x+1.6] × [o.y-0.6, o.y+1.6]），
  // 计划正文按这些数字推理过触发行为，改了它们却没有断言会红，一并钉住。
  GD_ASSERT.near(C.HIT.PAD_H, 0.35, 0.001, '跳板顶面厚度');
  GD_ASSERT.near(C.HIT.RING_X0, -0.6, 0.001, '跳环触发框左边界');
  GD_ASSERT.near(C.HIT.RING_X1, 1.6, 0.001, '跳环触发框右边界');
  GD_ASSERT.near(C.HIT.RING_Y0, -0.6, 0.001, '跳环触发框下边界');
  GD_ASSERT.near(C.HIT.RING_Y1, 1.6, 0.001, '跳环触发框上边界');

  // 跳板：贴地跑过去，接触即触发（不用按键）。
  function padApex(obj) {
    var st = GD_Physics.create(LV([obj]));
    var apex = 0, trigY = null, guard = 0;
    // 先跑到 obj.x - 0.2 格：玩家前沿是 x+0.5，跳板在 x+0.5 > obj.x 的那一步
    // （实测 x=4.5006）就弹射了，这一段留在第一阶段，弹射后的顶点由第二阶段记。
    while (st.x < obj.x - 0.2 && guard++ < 240 * 10) {
      var vyB = st.vy;
      GD_Physics.step(st, false);
      if (trigY === null && Math.abs(st.vy - C.PAD[obj.t]) < 1e-6) trigY = st.y;
    }
    var g2 = 0;
    while (st.alive && g2++ < 240 * 3) {
      GD_Physics.step(st, false);
      if (st.y > apex) apex = st.y;
      // 24 步 = 0.1 秒的稳定窗口：弹射后玩家至少飞 44 步（0.18 秒）才可能再落地，
      // 所以头 24 步里的 onGround=true 不能当作"结束"（否则会记到还没弹出去的高度）。
      if (st.onGround && g2 > 24) break;
    }
    return { apex: apex, trigY: trigY };
  }

  // 跳环：要在**环心高度**上按住才触发。
  function ringApex(obj) {
    var st = GD_Physics.create(LV([obj]));
    var guard = 0;
    while (st.x < obj.x - 0.2 && guard++ < 240 * 10) GD_Physics.step(st, false);
    // 环的触发框是 [o.y-0.6, o.y+1.6]（2.2 格高），玩家只有 1 格高：
    // 从地面起跳时脚边在 y≈0.83 就先碰到框的下沿，那一次的触发高度跟环心无关，
    // 测出来的顶点自然不是「环心 + 可达高度」。所以瞬移到环心高度（vy=0，正在下落）再按，
    // 触发点才落在环心上（实测 y=2.399，比环心低的那 0.001 格是放置后那一步的自由落体）。
    st.y = obj.y; st.vy = 0; st.onGround = false;
    var apex = 0, trigY = null, g2 = 0;
    while (st.alive && g2++ < 240 * 3) {
      var vyB = st.vy;
      GD_Physics.step(st, true);
      if (trigY === null && Math.abs(st.vy - C.RING[obj.t]) < 1e-6) trigY = st.y;
      if (st.y > apex) apex = st.y;
      if (st.onGround && g2 > 24) break;
    }
    return { apex: apex, trigY: trigY };
  }

  // spec §4.3：可达高度 h = v²/(2g)。表里的值（粉跳板 1.933、粉环 1.083、黄环 2.383）
  // 是解析值取整；环的高度用 obj.y（这枚环自己的 y）而不是写死的 2.4，
  // 将来把环挪到别的 y，期望值会跟着走，不会悄悄过期。
  var pad = { x: 5, y: 0, t: 'pad_pink' };
  var p = padApex(pad);
  GD_ASSERT.ok(p.trigY !== null, '粉跳板应当触发过');
  GD_ASSERT.approx(p.apex, 1.933, 0.005, '粉跳板高度');
  // 指纹：弹射点到顶点的抬升必须正好是 v²/(2g)（跳板的弹射点就是地面，trigY=0）。
  GD_ASSERT.near(p.apex - p.trigY,
    C.PAD.pad_pink * C.PAD.pad_pink / (2 * C.G), 0.002, '粉跳板高度指纹');

  var ringP = { x: 5, y: 2.4, t: 'ring_pink' };
  var rp = ringApex(ringP);
  GD_ASSERT.ok(rp.trigY !== null, '粉环应当触发过');
  GD_ASSERT.approx(rp.apex, 1.083 + ringP.y, 0.005, '粉环相对高度');
  GD_ASSERT.near(rp.apex - rp.trigY,
    C.RING.ring_pink * C.RING.ring_pink / (2 * C.G), 0.002, '粉环高度指纹');

  var ringY = { x: 5, y: 2.4, t: 'ring_yellow' };
  var ry = ringApex(ringY);
  GD_ASSERT.ok(ry.trigY !== null, '黄环应当触发过');
  GD_ASSERT.approx(ry.apex, 2.383 + ringY.y, 0.005, '黄环相对高度');
  GD_ASSERT.near(ry.apex - ry.trigY,
    C.RING.ring_yellow * C.RING.ring_yellow / (2 * C.G), 0.002, '黄环高度指纹');

  // 跳板的三种"接触"现状，显式钉住。
  // spec §4.3 写的是"跳板为接触即触发"，现在的实现是"一次接触只给一次冲量"，
  // 方向由 vy<=0 定：贴地跑过会弹、从高处砸下来会弹、**上升中掠过不弹**。
  // 第三条是与 spec §4.3 的一处语义偏离（GD 里跳板是钉在方块底部的实体，
  // 玩家踩不到板子下面；本项目的跳板是独立的 0.35 格薄片，"从下面穿过"要自己定方向）。
  // 钉在这里是为了让它显式、可被 review，而不是只活在散文里；改不改留给 Task 13 实玩定夺。
  function padScenario(withPad, x, y, vy) {
    var objs = withPad ? [{ x: 5, y: 0, t: 'pad_pink' }] : [];
    var st = GD_Physics.create(LV(objs));
    st.x = x; st.y = y; st.vy = vy; st.onGround = false;
    var apex = 0, fired = false, trigY = null, n = 0;
    while (n++ < 240) {
      GD_Physics.step(st, false);
      if (!fired && Math.abs(st.vy - C.PAD.pad_pink) < 1e-6) { fired = true; trigY = st.y; }
      if (st.y > apex) apex = st.y;
    }
    return { apex: apex, fired: fired, trigY: trigY };
  }
  // (1) 贴地跑过跳板 → 弹：就是上面 padApex 那条（顶点 1.932，触发点在地面 y=0）。
  // (2) 上升中掠过跳板 → 不弹：玩家在 x=4.55、y=0.05、vy=+16，
  //     脚在板体厚度里（0.05 < 0.35）、正在上升、前沿已经压到板子左边（4.55+0.5=5.05>5），
  //     三种"接触"条件全满足。旧实现（只按重叠判）这里会弹 3 次，现在 0 次。
  var rise = padScenario(true, 4.55, 0.05, 16);
  var riseCtl = padScenario(false, 4.55, 0.05, 16);
  GD_ASSERT.ok(!rise.fired, '上升中掠过跳板不该触发（spec §4.3 的语义偏离，见注释）');
  GD_ASSERT.near(rise.apex, riseCtl.apex, 1e-9, '上升中掠过跳板时轨迹与没有跳板时逐帧相同');
  // (3) 从高处砸到跳板上 → 弹：玩家在 x=5.2、y=1.0、vy=-15，脚落到板体厚度里就弹。
  //     起点放在 y=1.0 而不是更高，是为了让"下落途中的最高点"不盖过弹射后的顶点。
  var fall = padScenario(true, 5.2, 1.0, -15);
  GD_ASSERT.ok(fall.fired, '从高处砸到跳板上应当触发');
  GD_ASSERT.near(fall.apex - fall.trigY,
    C.PAD.pad_pink * C.PAD.pad_pink / (2 * C.G), 0.002, '砸下来弹射的高度指纹');

  // spec §4.3：跳环需玩家按下触发，跳板为接触即触发。
  // 同一个位置按一次 vs 不按一次：不按的时候环的速度不会被写进 vy。
  function ringVy(held) {
    var st = GD_Physics.create(LV([{ x: 5, y: 2.4, t: 'ring_pink' }]));
    st.x = 4.8; st.y = 2.4; st.vy = 0; st.onGround = false;
    GD_Physics.step(st, held);
    return st.vy;
  }
  GD_ASSERT.near(ringVy(true), C.RING.ring_pink, 1e-6, '按下时跳环触发');
  GD_ASSERT.ok(Math.abs(ringVy(false) - C.RING.ring_pink) > 1,
    '不按的时候跳环不该触发');
});

GD_ASSERT.test('P2 跳环只能触发一次', function () {
  var RING = GD_Physics.CONST.RING.ring_pink;
  var st = GD_Physics.create(LV([{ x: 5, y: 2.4, t: 'ring_pink' }]));
  var triggers = 0, lastVy = 0;
  var guard = 0;
  while (st.x < 4.5 && guard++ < 240 * 10) GD_Physics.step(st, false);
  for (var i = 0; i < 240; i++) {
    GD_Physics.step(st, true);
    // 触发标志 = 环的速度被写进 vy 的那一帧。
    // 不能拿「vy 突然变大」当标志：长按的普通起跳和落地同样是 vy 猛增
    // （实测 240 步里数出 5 次，而且压根数不到环那次——环触发时玩家正在上升，
    //  环把 vy 从 18.05 压到 15.78，是**变小**）。
    if (Math.abs(st.vy - RING) < 1e-6) triggers++;
    lastVy = st.vy;
  }
  // 玩家在环的触发框里待了约 50 帧（框宽 2.2 格，@1x 一帧 0.043 格），
  // 没有一次性标记就会每帧触发一次（实测 49 次）——这条断言是有牙齿的。
  GD_ASSERT.ok(triggers >= 1,
    '跳环应当触发过，实测 ' + triggers + ' 次（最后一次 vy=' + lastVy + '，期望 ' + RING + '）');
  GD_ASSERT.ok(triggers <= 1,
    '跳环触发 ' + triggers + ' 次，应 ≤ 1（最后一次 vy=' + lastVy + '）');

  // 对照组：同一个 240 步场景、同样一直按住，关卡里**没有环** —— 一次都不该触发。
  // 有这条才敢说上面那 1 次确实来自环，而不是别的什么往 vy 里写数的路径。
  var ctl = GD_Physics.create(LV([]));
  var ctlTriggers = 0, guard2 = 0;
  while (ctl.x < 4.5 && guard2++ < 240 * 10) GD_Physics.step(ctl, false);
  for (var j = 0; j < 240; j++) {
    GD_Physics.step(ctl, true);
    if (Math.abs(ctl.vy - RING) < 1e-6) ctlTriggers++;
  }
  GD_ASSERT.ok(ctlTriggers === 0, '没有环就不该有触发，实测 ' + ctlTriggers + ' 次');
});

GD_ASSERT.test('T4 飞船速度上限钳制', function () {
  function shipVy(held, seconds) {
    // 关卡必须带非空 segments：Task 2 拆掉了 respawn 的静默回退，
    // 缺 segments 时死亡重开会抛 TypeError，而不是悄悄退回 cube/1x。
    // 本用例测的是飞船模式，所以段落的 mode 写 ship、speed 与 create() 的初值一致。
    var st = GD_Physics.create({
      segments: [{ from: 0, to: 100000, mode: 'ship', speed: 1 }],
      objects: [],
      meta: { endBlock: 100000 }
    });
    st.mode = 'ship'; st.y = 50;
    // 起点必须高于 2 秒的下坠距离：飞船碰到地面会被钳成 y=0、vy=0
    // （stepShip 的 `if (st.y < GROUND)`），落在地上的飞船根本测不出 -19.2 的下限钳位
    // （实测从 y=5 起松手 2 秒，vy=0）。实测 2 秒最多下坠 35.25 格（y=50 → 14.749），
    // 50 格留足余量。
    for (var i = 0; i < 240 * seconds; i++) GD_Physics.step(st, held);
    return st.vy;
  }
  GD_ASSERT.approx(shipVy(true, 2), 16.0, 0.02, '按住 2 秒收敛到 +16.0');
  GD_ASSERT.approx(shipVy(false, 2), -19.2, 0.02, '松开 2 秒收敛到 -19.2');
});

GD_ASSERT.test('T4b 飞船水平速度与方块模式完全相同', function () {
  function run(mode) {
    // segments 只在死亡重开时才起作用，本用例不会死；固定写 ship/speed 2 是为了
    // 不给 run('cube') 那一路引入第二个变量（两路的差别只应该是 mode）。
    var st = GD_Physics.create({
      segments: [{ from: 0, to: 100000, mode: 'ship', speed: 2 }],
      objects: [],
      meta: { endBlock: 100000 }
    });
    st.mode = mode; st.speedKey = 2;
    for (var i = 0; i < 240; i++) GD_Physics.step(st, false);
    return st.x;
  }
  GD_ASSERT.near(run('ship'), run('cube'), 0.001, '同 1 秒水平位移');
});

GD_ASSERT.test('T4c 传送门切换模式', function () {
  var C = GD_Physics.CONST;
  // 门的触发框尺寸先钉死：GATE_H 决定"门有多高"，改了它不用别的测试就会红。
  // GATE_H = 256 是**通高**（框从门的底边 o.y 往上延伸 256 格），见 physics.js 的注释。
  GD_ASSERT.near(C.HIT.GATE_W, 1.4, 0.001, '门的触发框宽度');
  GD_ASSERT.near(C.HIT.GATE_H, 256, 0.001, '门的触发框高度（通高）');

  var st = GD_Physics.create({
    // 两个门都贴地（y=0.5）：飞船落到地面后框是 [0,1]，而门框从 o.y 往上，
    // y=1 的门框 [1, …] 与玩家框只在边界相接（overlap 用严格不等号）→ 永远不触发。
    // 这正是 035e7be 在关卡里修掉的"门形同虚设"（见 level.js 与 L3 用例的注释）。
    // 第二个门放在 x=60：原计划的 x=30 会在第一段循环（4 s ≈ x=41.5）里被越过，
    // 于是"过第一个门应为 ship"必然看到 cube——门要放在第一段跑完之后才够得到。
    objects: [{ x: 10, y: 0.5, t: 'portal_ship' }, { x: 60, y: 0.5, t: 'portal_cube' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'cube', speed: 1 }]
  });
  st.y = 1;
  for (var i = 0; i < 240 * 4 && st.alive; i++) { GD_Physics.step(st, false); st.y = Math.max(st.y, 0); }
  GD_ASSERT.ok(st.mode === 'ship', '过第一个门应为 ship，实为 ' + st.mode);
  for (var j = 0; j < 240 * 3 && st.alive; j++) GD_Physics.step(st, false);
  GD_ASSERT.ok(st.mode === 'cube', '过第二个门应回 cube，实为 ' + st.mode);

  // 高空飞过回方块门也必须切成 cube：门的触发框要覆盖整条航道
  var hi = GD_Physics.create({
    objects: [{ x: 10, y: 0.5, t: 'portal_cube' }],
    meta: { endBlock: 100000 },
    // 段落的 mode 写 ship：这两个子场景里玩家是在**飞船**模式下飞过回方块门，
    // 若写成 cube，玩家一旦死亡重开就会变成 cube，"高空飞过也应切成 cube"就假绿了。
    segments: [{ from: 0, to: 100, mode: 'ship', speed: 1 }]
  });
  hi.mode = 'ship'; hi.y = 9; hi.vy = 0;
  for (var k = 0; k < 240 * 3 && hi.alive && hi.mode === 'ship'; k++) {
    hi.y = 9; hi.vy = 0;            // 把飞船悬停在 y=9（远高于旧门框的 3.1），模拟"飞到高处再过门"
    GD_Physics.step(hi, false);
  }
  GD_ASSERT.ok(hi.mode === 'cube',
    '高空飞过回方块门也应切成 cube，实为 ' + hi.mode + '（y=' + hi.y.toFixed(2) + '）');

  // 悬在半空的门不能被贴地玩家吃到：触发框的底边就是门的底边（o.y），
  // 不能改成 0——那样"这一层高度的门"就变成"整根柱子都触发"，语义就错了。
  var air = GD_Physics.create({
    objects: [{ x: 10, y: 6, t: 'portal_ship' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'cube', speed: 1 }]
  });
  for (var a = 0; a < 240 * 3 && air.alive; a++) GD_Physics.step(air, false);
  GD_ASSERT.ok(air.mode === 'cube',
    '悬在半空的门不该被贴地玩家触发，实为 ' + air.mode + '（x=' + air.x.toFixed(2) + '）');

  // 速度门与传送门走同一条路径（不按门型特判）：高空飞过 speed_2x 门也必须变速。
  // 只钉 GATE_H 常量不够——把 speed 分支单独改回 2.6 高的变异会全绿通过。
  var spd = GD_Physics.create({
    objects: [{ x: 10, y: 0.5, t: 'speed_2x' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'ship', speed: 1 }]
  });
  spd.mode = 'ship'; spd.y = 5; spd.vy = 0;
  for (var sp = 0; sp < 240 * 3 && spd.alive; sp++) { spd.y = 5; spd.vy = 0; GD_Physics.step(spd, false); }
  GD_ASSERT.ok(spd.speedKey === 2, '高空飞过 speed_2x 门也应变速到 2x，实为 ' + spd.speedKey);

  // 切回方块的那一刻，"在地面 ⇒ vy==0"必须成立（handoff 缺陷清单第 1 条）
  var g = GD_Physics.create({
    objects: [{ x: 10, y: 0.5, t: 'portal_cube' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'ship', speed: 1 }]
  });
  g.mode = 'ship'; g.y = 0.2; g.vy = 16;    // 贴着地面、正要往上冲的飞船
  for (var k2 = 0; k2 < 240 * 3 && g.alive; k2++) {
    if (g.mode === 'ship') { g.y = 0.2; g.vy = 16; }   // 钉住这个状态直到进门
    GD_Physics.step(g, false);
    if (g.mode === 'cube') break;                       // 刚切回来的那一瞬间
  }
  GD_ASSERT.ok(g.mode === 'cube', '贴地过回方块门应切成 cube，实为 ' + g.mode);
  // 这条是**护栏**：当前恒真（onGround 会被 collide() 尾部的落地判定改回 false），
  // 拦不住真正的症状。留着是为了万一哪天真的"在地面却带着 vy"，标签能一眼看出
  // 这是有意保留的检查，而不是忘了删的废断言。
  GD_ASSERT.ok(!(g.onGround && g.vy !== 0),
    '切回方块后若在地面，vy 必须为 0（当前恒真，见上方注释：onGround 会被 collide() 尾部改回 false）实为 vy=' + g.vy + ' onGround=' + g.onGround);
  // 上面那条恒真，拦不住真正的症状——飞船残余的 vy 被带进方块模式，
  // 方块会再往上飞一截。改成直接钉住 vy：
  GD_ASSERT.near(g.vy, 0, 1e-9, '切回方块那一刻 vy 必须归零（修复前实测 15.77）');
  // 行为层面：切回方块后不该继续上升（修复前从 y=0.266 被顶到 1.3475，修复后落回地面）
  var ySwitch = g.y, peak = g.y;
  for (var m = 0; m < 240; m++) {
    GD_Physics.step(g, false);
    if (g.y > peak) peak = g.y;
  }
  GD_ASSERT.ok(peak <= ySwitch + 1e-9,
    '切回方块后不应被飞船残余速度顶上天，实测峰值 ' + peak.toFixed(4) +
    '（切回时 y=' + ySwitch.toFixed(4) + '）');

  // 空中切回方块必须**保留**上升速度：把 vy 无条件清零（连空中也清）会让
  // ship→cube 的转换变成"凭空掉下来"。这里只钉"不被清成 0"，不钉具体数值——
  // 手感数值留给 Task 13 校准，本条只钉"地面清 / 空中不清"这个分支区别。
  var air2 = GD_Physics.create({
    objects: [{ x: 10, y: 0.5, t: 'portal_cube' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'ship', speed: 1 }]
  });
  air2.mode = 'ship'; air2.y = 5; air2.vy = 16;
  for (var n2 = 0; n2 < 240 * 3 && air2.alive; n2++) {
    if (air2.mode === 'ship') { air2.y = 5; air2.vy = 16; }
    GD_Physics.step(air2, false);
    if (air2.mode === 'cube') break;
  }
  GD_ASSERT.ok(air2.mode === 'cube', '高空过回方块门应切成 cube，实为 ' + air2.mode);
  GD_ASSERT.ok(air2.vy > 0, '空中切回方块应保留上升速度（vy>0），实为 vy=' + air2.vy);

  // 门框必须盖得住"飞船段内能爬到的高度"：玩家从切船门起一直按住，
  // 理论上能爬到 (252.5−111.5)/10.386 × 16 ≈ 217 格（按最慢的 1x 算），
  // GATE_H = 256 盖得住。关卡只放两扇门（飞船段的柱阵会把玩家撞死，
  // 这里要的是"纯爬升上界"），门的 x 从真实关卡里读——关卡长度改了，这个界会跟着动。
  var lvGates = GD_Level.crossbeat.objects.filter(function (o) {
    return o.t === 'portal_ship' || o.t === 'portal_cube';
  });
  var shipGate = lvGates.filter(function (o) { return o.t === 'portal_ship'; })[0];
  var cubeGate = lvGates.filter(function (o) { return o.t === 'portal_cube'; })[0];
  var climb = GD_Physics.create({
    objects: [{ x: shipGate.x, y: shipGate.y, t: 'portal_ship' },
              { x: cubeGate.x, y: cubeGate.y, t: 'portal_cube' }],
    meta: { endBlock: 1e9 },
    segments: [{ from: 0, to: 1e9, mode: 'ship', speed: 1 }]
  });
  climb.mode = 'ship'; climb.speedKey = 1;      // 按最慢的 1x 算 = 爬升时间的上界
  climb.x = shipGate.x - 0.5; climb.y = 0; climb.vy = 0; climb.onGround = false;
  var maxY = 0;
  for (var cl = 0; cl < 240 * 40 && climb.alive && climb.x < cubeGate.x - 0.5; cl++) {
    GD_Physics.step(climb, true);               // 一直按住
    if (climb.y > maxY) maxY = climb.y;
  }
  GD_ASSERT.ok(maxY < C.HIT.GATE_H,
    '按住不放时飞船段内爬到的高度必须仍在门框内，实测 ' + maxY.toFixed(2) +
    '（门框上沿 ' + (cubeGate.y + C.HIT.GATE_H).toFixed(1) + '）');
});

GD_ASSERT.test('T6 随机输入 3000 步无异常无 NaN', function () {
  var seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  var st = GD_Physics.create(GD_Level.crossbeat);
  for (var i = 0; i < 3000; i++) {
    GD_Physics.step(st, rnd() < 0.35);
    if (!isFinite(st.x) || !isFinite(st.y) || !isFinite(st.vy)) {
      throw new Error('NaN/Inf @step ' + i + ' x=' + st.x + ' y=' + st.y + ' vy=' + st.vy);
    }
    if (st.y < -0.001) throw new Error('穿地 @step ' + i + ' y=' + st.y);
    if (st.percent < 0 || st.percent > 100) throw new Error('percent 越界: ' + st.percent);
  }
  GD_ASSERT.ok(true);
});

GD_ASSERT.test('T6b 死亡重开 20 次状态干净', function () {
  var st = GD_Physics.create(GD_Level.crossbeat);
  var seg0 = st.level.segments[0];
  // 一直不按必然撞刺；撞死后 DEATH_DELAY 步就自动重开一次（实测一个循环 558 步）。
  // 断言必须在**刚重开**的那一刻取状态：死亡延时期间 st.x 还停在死亡点。
  // 计划原版在固定 14400 步之后取样，而那个窗口实测正好落在死亡延时里
  // （alive=false、deadTimer=0.45、x=13.76145=死亡点），于是 near(st.x, 0, 12) 必然红——
  // 那不是 respawn() 漏字段，是取样时机不对（逐字段体检见下：刚重开时状态全干净）。
  // 改成按重开次数取样，断言反而更严：每次重开的当刻都要逐字段干净。
  var respawns = 0, steps = 0, guard = 240 * 60 * 3, dirty = [];
  while (respawns < 20 && steps < guard) {
    var before = st.attempt;
    while (st.attempt === before && steps < guard) { GD_Physics.step(st, false); steps++; }
    if (st.attempt === before) break;              // 没等到重开：不该发生，报在下面
    respawns++;
    // 逐字段对照 create()：重开后的状态必须干净（漏清一个字段就记下来）
    var bad = [];
    if (st.x !== 0) bad.push('x=' + st.x);
    if (st.y !== 0) bad.push('y=' + st.y);
    if (st.vy !== 0) bad.push('vy=' + st.vy);
    if (st.rot !== 0) bad.push('rot=' + st.rot);
    if (st.percent !== 0) bad.push('percent=' + st.percent);
    if (st.time !== 0) bad.push('time=' + st.time);
    if (st.deadTimer !== 0) bad.push('deadTimer=' + st.deadTimer);
    if (!st.alive) bad.push('alive=false');
    if (st.finished) bad.push('finished=true');
    if (!st.onGround) bad.push('onGround=false');
    if (st.mode !== seg0.mode) bad.push('mode=' + st.mode);
    if (st.speedKey !== seg0.speed) bad.push('speedKey=' + st.speedKey);
    if (Object.keys(st.used).length !== 0) bad.push('used=' + Object.keys(st.used).length);
    if (bad.length) dirty.push('第 ' + respawns + ' 次重开: ' + bad.join(','));
  }
  GD_ASSERT.ok(respawns >= 20, '应至少重开 20 次，实得 ' + respawns + ' 次（' + steps + ' 步）');
  GD_ASSERT.ok(st.attempt >= 21, 'attempt 应随重开累加（起于 1），实为 ' + st.attempt);
  GD_ASSERT.ok(dirty.length === 0, '重开后状态不干净: ' + dirty.join(' | '));
});

// spec §5 的架构约束：physics.js 不得引用渲染/输入/音频/HUD。
// 这条不是洁癖——它保证物理能在 harness.html 里不加载任何渲染代码就被驱动到任意时刻。
GD_ASSERT.test('D1 physics.js 不依赖渲染层', function () {
  var src = GD_ASSERT.SOURCES['physics.js'];
  GD_ASSERT.ok(src !== undefined, '需要 harness 预取的源码字符串');
  ['GD_Render', 'GD_Hud', 'GD_Audio', 'GD_Input', 'document.', 'window.addEventListener',
   'requestAnimationFrame', 'canvas'].forEach(function (bad) {
    GD_ASSERT.ok(src.indexOf(bad) < 0, 'physics.js 不应出现 ' + bad);
  });
});

// handoff 缺陷清单第 5 条：方块落地判定里的 `st.vy <= 0` 此前**零覆盖**
// （实测把它去掉，16 条断言照样全绿）。这个条件是"上升中撞墙 = 死"的唯一保证：
// 去掉它，玩家上升中撞到方块侧面会被当成落地，吸到方块顶上——撞墙就不算撞墙了。
// 本用例把这个条件钉住。
// （注意：本用例的场景里玩家**照样会死**，只是死之前被吸到了柱顶——
// 所以光断"死了"抓不住这个变异，必须连位置与 vy 一起断，见下面的注释。）
GD_ASSERT.test('T5d 上升中撞墙应致死（落地判定的 vy<=0 护栏）', function () {
  var C = GD_Physics.CONST, dt = C.DT;
  // 场景：玩家在 2 格柱旁**上升中**撞进柱子（x=6 的 y=0 与 y=1 两格）。
  // 起点取 y=0.9：正好落在"落地吸附容差"之内（top-0.33=0.67 < 0.9），
  // 所以只要落地判定里的 vy<=0 被去掉，玩家就会被吸到柱顶（y=1）而不是撞死。
  // 正确实现下玩家是**撞死**的：缩小核心框（0.3×0.3，中心在玩家腰高 1.4）
  // 与柱顶那一格的核心框（中心 1.5）重叠 → 死。
  function riseInto(objs) {
    var st = GD_Physics.create(LV(objs));
    st.x = 6.5; st.y = 0.9; st.vy = 10; st.onGround = false;
    GD_Physics.step(st, false);
    return st;
  }
  var hit = riseInto([{ x: 6, y: 0, t: 'block' }, { x: 6, y: 1, t: 'block' }]);
  GD_ASSERT.ok(!hit.alive, '上升中撞进方块必须死亡，实得 alive=' + hit.alive + ' y=' + hit.y);
  // 关键在"没被吸到方块顶上"：落地分支一旦触发，st.y 会被改成 top(=1) 且 vy 清零。
  // 只断"死了"抓不住这个变异——去掉 vy<=0 之后玩家**照样死**（死在柱顶那一格），
  // 区别只在死之前被吸到了 y=1、vy=0。所以位置与 vy 必须一起钉。
  GD_ASSERT.near(hit.y, 0.9 + 10 * dt - 0.5 * C.G * dt * dt, 1e-9,
    '撞死时的 y 应保持撞上去那一刻的值（没被吸到柱顶 1），实为 ' + hit.y);
  GD_ASSERT.ok(hit.vy > 0, '撞死时 vy 仍应为正（落地分支会把 vy 清零），实为 ' + hit.vy);
  // 对照组：同样的起点，关卡里没有方块 → 不该死，而且要继续上升。
  var ctl = riseInto([]);
  GD_ASSERT.ok(ctl.alive, '没有方块时不该死');
  GD_ASSERT.ok(ctl.y > 0.9, '没有方块时应继续上升，实得 y=' + ctl.y);

  // 反面：下落中踩到方块顶必须仍然是"落地"（不是撞墙）。
  // 玩家从 y=1.2、vy=-8 落到 1 格方块顶上：脚越过顶面之后落地分支接管，
  // st.y 被吸到 1、vy 清零、onGround 变真。
  var fall = GD_Physics.create(LV([{ x: 6, y: 0, t: 'block' }]));
  fall.x = 6.5; fall.y = 1.2; fall.vy = -8; fall.onGround = false;
  var n = 0;
  while (!fall.onGround && n++ < 240) GD_Physics.step(fall, false);
  GD_ASSERT.ok(fall.alive, '下落中踩到方块顶不该死');
  GD_ASSERT.near(fall.y, 1, 1e-9, '应被吸到方块顶 y=1，实为 ' + fall.y);
  GD_ASSERT.near(fall.vy, 0, 1e-9, '落地后 vy 应为 0，实为 ' + fall.vy);
});
