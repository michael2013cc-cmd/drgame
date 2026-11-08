// 渲染层 / HUD / 输入 / 音频 / 装配的自动化覆盖。
//
// 为什么要有这个文件：harness 以前只加载 assert/level/physics/测试文件，
// render/hud/input/audio/main 只是被 fetch 当**源码文本**预取（用来满足 SOURCES 的键数 ≥ 6 门禁），
// 于是这四层**零执行覆盖**。实测下面四条变异全都 21/21 全绿：
//   ① HUD 忽略 camY（"Attempt"牌子飘在半空）
//   ② 相机死区上界改成 100（相机永不跟随）
//   ③ render.js 漏改一个 wy 调用点（地面线不过相机）
//   ④ 音频调度器改成相对累加（产生漂移）
// 这里用一个"记录型 2D 上下文桩"驱动**真实的** render.js / hud.js / input.js / audio.js / main.js，
// 把上面四条变异变成红。
//
// 纯 JS、零依赖：浏览器 harness 与 Node 快速回路（run-tests.mjs）都能跑。
// 断言框架是**同步**的（GD_ASSERT.run() 直接调 fn()），所以这里不用 Promise。

// ---------------------------------------------------------------- 记录型 2D 上下文桩

// 把每一次绘制调用记成一条 {op, args, local}。
// local = true 表示这条记录发生在 translate 之后（玩家图标的局部坐标），
// 那部分坐标本来就不该随相机变，两次绘制必须逐字节相同。
function recCtx() {
  var ops = [];
  var txDepth = 0, stack = [];
  var ctx = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '',
    textAlign: 'left', globalAlpha: 1, imageSmoothingEnabled: true,
    ops: ops,
    reset: function () { ops.length = 0; txDepth = 0; stack.length = 0; }
  };
  function rec(op, args) { ops.push({ op: op, args: args, local: txDepth > 0 }); }
  ctx.fillRect = function (x, y, w, h) { rec('fillRect', [x, y, w, h]); };
  ctx.strokeRect = function (x, y, w, h) { rec('strokeRect', [x, y, w, h]); };
  ctx.clearRect = function (x, y, w, h) { rec('clearRect', [x, y, w, h]); };
  ctx.roundRect = function (x, y, w, h, r) { rec('roundRect', [x, y, w, h, r]); };
  ctx.fillText = function (t, x, y) { rec('fillText', [t, x, y]); };
  ctx.arc = function (x, y, r, a1, a2) { rec('arc', [x, y, r, a1, a2]); };
  ctx.ellipse = function (x, y, rx, ry, rot, a1, a2) { rec('ellipse', [x, y, rx, ry, rot, a1, a2]); };
  ctx.beginPath = function () { rec('beginPath', []); };
  ctx.closePath = function () { rec('closePath', []); };
  ctx.fill = function () { rec('fill', []); };
  ctx.stroke = function () { rec('stroke', []); };
  ctx.moveTo = function (x, y) { rec('moveTo', [x, y]); };
  ctx.lineTo = function (x, y) { rec('lineTo', [x, y]); };
  ctx.translate = function (x, y) { rec('translate', [x, y]); txDepth++; };
  ctx.rotate = function (a) { rec('rotate', [a]); };
  ctx.save = function () { stack.push(txDepth); rec('save', []); };
  ctx.restore = function () { rec('restore', []); txDepth = stack.length ? stack.pop() : 0; };
  ctx.setTransform = function (a, b, c, d, e, f) { rec('setTransform', [a, b, c, d, e, f]); };
  ctx.createLinearGradient = function (x0, y0, x1, y1) {
    rec('createLinearGradient', [x0, y0, x1, y1]);
    return { addColorStop: function () {} };
  };
  ctx.measureText = function () { return { width: 0 }; };
  return ctx;
}

// 一条绘制记录的"纵向参量"：能代表它落在画面哪一行的那些数。
// 矩形取上沿与下沿（两个沿都要比：地面色带的上沿跟着相机走、下沿钉在画布底）。
function verticals(op) {
  var a = op.args, out = [];
  switch (op.op) {
    case 'fillRect': case 'strokeRect': case 'clearRect': case 'roundRect':
      out.push(a[1], a[1] + a[3]); break;
    case 'fillText': out.push(a[2]); break;
    case 'arc': out.push(a[1] - a[2], a[1] + a[2]); break;
    case 'ellipse': out.push(a[1] - a[3], a[1] + a[3]); break;
    case 'moveTo': case 'lineTo': case 'translate': out.push(a[1]); break;
    case 'createLinearGradient': out.push(a[1], a[3]); break;
  }
  return out;
}

function fakeCanvas(ctx) {
  return {
    width: 427, height: 240, style: {},
    getContext: function () { return ctx; }
  };
}

// 事件源桩：input.js 的注入口要靠它驱动。
function stubTarget() {
  var handlers = {};
  return {
    addEventListener: function (type, fn) {
      (handlers[type] || (handlers[type] = [])).push(fn);
    },
    removeEventListener: function (type, fn) {
      var a = handlers[type]; if (!a) return;
      var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    },
    dispatch: function (type, ev) {
      var a = handlers[type] || [];
      var e = ev || { type: type, preventDefault: function () {} };
      for (var i = 0; i < a.length; i++) a[i].call(this, e);
    }
  };
}

function findOp(ops, pred) {
  for (var i = 0; i < ops.length; i++) if (pred(ops[i])) return i;
  return -1;
}

// ---------------------------------------------------------------- R1 只画不改状态

GD_ASSERT.test('R1 渲染与 HUD 只画不改状态', function () {
  var ctx = recCtx();
  var st = GD_Physics.create(GD_Level.crossbeat);
  st.x = 130; st.y = 3; st.mode = 'ship'; st.speedKey = 2;
  var r = GD_Render.create(fakeCanvas(ctx));

  var before = JSON.stringify(st);
  GD_Render.draw(r, st, 1 / 60);
  GD_ASSERT.ok(JSON.stringify(st) === before, 'render.draw 不得改物理状态');

  before = JSON.stringify(st);
  GD_Hud.draw(ctx, st, 60, r.camY);
  GD_ASSERT.ok(JSON.stringify(st) === before, 'hud.draw 不得改物理状态');
});

// ---------------------------------------------------------------- R2 相机敏感度

// 屏幕固定的东西：整屏清屏与整屏底色。其余的都必须跟着相机走。
function isScreenFixed(op) {
  if (op.op === 'clearRect') return true;
  if (op.op === 'fillRect' && op.args[0] === 0 && op.args[1] === 0 &&
      op.args[2] === GD_Render.LW && op.args[3] === GD_Render.LH) return true;
  return false;
}

GD_ASSERT.test('R2 纵向相机：跟着世界的画面必须正好差 1 格', function () {
  var ctx = recCtx();
  var canvas = fakeCanvas(ctx);
  var st = GD_Physics.create(GD_Level.crossbeat);
  // y=3 让玩家相对相机落在死区 [1.0, 4.6] 里，两次绘制都不会被 updateCamera 改动，
  // 于是 camY 完全由测试控制（否则死区会把 camY 拉走，测的就不是"差 1 格"了）。
  st.x = 130; st.y = 3; st.mode = 'ship'; st.speedKey = 2;

  var r0 = GD_Render.create(canvas);
  ctx.reset();
  GD_Render.draw(r0, st, 1 / 60);
  var t0 = ctx.ops.slice();

  var r1 = GD_Render.create(canvas);
  r1.camY = 1;
  ctx.reset();
  GD_Render.draw(r1, st, 1 / 60);
  var t1 = ctx.ops.slice();

  GD_ASSERT.ok(t0.length > 20, '这一帧应该画了不少东西，实测 ' + t0.length + ' 条记录');
  if (t0.length !== t1.length) {
    throw new Error('两次绘制的记录条数不同：' + t0.length + ' vs ' + t1.length);
  }

  var problems = [], parallax = [], world = [];
  for (var i = 0; i < t0.length; i++) {
    var oa = t0[i], ob = t1[i];
    if (oa.op !== ob.op) { problems.push('#' + i + ' 操作类型不同：' + oa.op + ' vs ' + ob.op); continue; }
    if (oa.local || ob.local) {
      // translate 之后的局部坐标（玩家图标的笔画）：两次必须完全一样
      for (var k = 0; k < oa.args.length; k++) {
        if (oa.args[k] !== ob.args[k]) {
          problems.push('#' + i + ' ' + oa.op + ' 的局部坐标变了：' + oa.args[k] + ' → ' + ob.args[k]);
          break;
        }
      }
      continue;
    }
    var va = verticals(oa), vb = verticals(ob);
    if (va.length === 0) continue;                       // 没有纵向参量的操作（beginPath 之类）不比
    if (va.length !== vb.length) { problems.push('#' + i + ' ' + oa.op + ' 的纵向参量数不同'); continue; }
    // 位移分类：世界物体正好 1 格（30px），背景视差 0.3 格（9px）。
    // 别的数值 = 有 wy 调用点漏改 r，或者多乘/少乘了相机系数。
    var isWorld = false, isParallax = false, odd = [];
    for (var j = 0; j < va.length; j++) {
      var d = vb[j] - va[j];
      if (Math.abs(d) <= 1e-9) continue;
      if (Math.abs(d - GD_Render.BLK) < 1e-6) isWorld = true;
      else if (Math.abs(d - GD_Render.BLK * 0.3) < 1e-6) isParallax = true;
      else odd.push(d);
    }
    if (odd.length) {
      problems.push('#' + i + ' ' + oa.op + ' 的纵向位移是 [' + odd.join(',') + ']，只能是 0 / 9 / 30');
      continue;
    }
    if (isWorld && isParallax) {
      problems.push('#' + i + ' ' + oa.op + ' 同时有 1 格和 0.3 格两种位移');
      continue;
    }
    if (isParallax) { parallax.push(i); continue; }
    if (isWorld) { world.push(i); continue; }
    // 完全没动：只能是屏幕固定的东西。
    // 别的（方块、尖刺、门、地面线、粒子、玩家）少了一个 wy(r, …) 就会落到这里。
    if (!isScreenFixed(oa)) {
      problems.push('#' + i + ' ' + oa.op + ' 完全没动，但它本该跟着相机走：args=' + JSON.stringify(oa.args));
    }
  }

  GD_ASSERT.ok(parallax.length > 0, '这一帧必须有背景视差（0.3 格）的绘制，实测 ' + parallax.length + ' 条');
  GD_ASSERT.ok(world.length > 0, '这一帧必须有跟着世界走（1 格）的绘制，实测 ' + world.length + ' 条');
  // 背景先画、物体后画：视差位移不许出现在世界位移之后。
  if (parallax.length && world.length) {
    GD_ASSERT.ok(parallax[parallax.length - 1] < world[0],
      '背景视差（0.3 格）出现在世界物体（1 格）之后：#' + world[0] + ' / #' + parallax[parallax.length - 1]);
  }
  GD_ASSERT.ok(problems.length === 0, '相机敏感度不对：\n  ' + problems.slice(0, 8).join('\n  '));
});

// ---------------------------------------------------------------- R3 相机死区跟随

GD_ASSERT.test('R3 纵向相机死区跟随（玩家太高时相机必须上滚）', function () {
  var ctx = recCtx();
  var st = GD_Physics.create(GD_Level.crossbeat);
  st.x = 130; st.y = 8; st.mode = 'ship'; st.speedKey = 2;
  var r = GD_Render.create(fakeCanvas(ctx));
  GD_Render.draw(r, st, 1 / 60);

  // 死区上界由 render.js 的常数现算（VIS_TOP - 1.2），不写死 4.6。
  var CAM_HI = GD_Render.GROUND_Y / GD_Render.BLK - 1.2;
  GD_ASSERT.ok(r.camY > 0,
    '玩家在 y=8 时相机必须上滚（死区上界 ' + CAM_HI.toFixed(2) + '），实测 camY=' + r.camY);
  GD_ASSERT.near(st.y - r.camY, CAM_HI, 1e-6, '相机应把玩家压在死区上界');
});

// ---------------------------------------------------------------- R4 玩家全程在画面内

GD_ASSERT.test('R4 整关回放时玩家全程在画面里', function () {
  var ctx = recCtx();
  var r = GD_Render.create(fakeCanvas(ctx));
  var st = GD_Physics.create(GD_Level.crossbeat);
  var seq = GD_Replay.crossbeat, si = 0, held = false;
  var out = [], frames = 0;

  for (var n = 0; n < 240 * 40 && !st.finished; n++) {
    while (si < seq.length && seq[si].t <= st.time) { held = seq[si].d; si++; }
    GD_Physics.step(st, held);
    ctx.reset();
    GD_Render.draw(r, st, 1 / 60);
    frames++;
    if (!st.alive) continue;                     // 死了不画玩家
    var ti = findOp(ctx.ops, function (o) { return o.op === 'translate'; });
    if (ti < 0) { out.push('第 ' + frames + ' 帧没有画玩家'); break; }
    var px = ctx.ops[ti].args[0], py = ctx.ops[ti].args[1], half = GD_Render.BLK / 2;
    if (px - half < 0 || px + half > GD_Render.LW || py - half < 0 || py + half > GD_Render.LH) {
      out.push('第 ' + frames + ' 帧玩家出画：屏幕 (' + px.toFixed(2) + ',' + py.toFixed(2) +
               ') 世界 y=' + st.y.toFixed(2) + ' camY=' + r.camY.toFixed(2));
      break;
    }
  }
  GD_ASSERT.ok(out.length === 0, out.join(' | '));
  GD_ASSERT.ok(st.finished, '回放应通关（实测 percent=' + st.percent.toFixed(1) + '）');
  GD_ASSERT.ok(frames > 7000, '应跑完整关（实测 ' + frames + ' 帧）');
});

// ---------------------------------------------------------------- R5 HUD 过相机 + GROUND_Y 一致

GD_ASSERT.test('R5 HUD：Attempt 牌子跟着相机走，地面线与 render.js 是同一个', function () {
  var ctx = recCtx();
  var st = GD_Physics.create(GD_Level.crossbeat);
  st.x = 2; st.y = 0; st.attempt = 3; st.percent = 42;

  ctx.reset(); GD_Hud.draw(ctx, st, 60, 0);
  var h0 = ctx.ops.slice();
  ctx.reset(); GD_Hud.draw(ctx, st, 60, 1);
  var h1 = ctx.ops.slice();

  var isAttempt = function (o) { return o.op === 'fillText' && String(o.args[0]).indexOf('Attempt') === 0; };
  var i0 = findOp(h0, isAttempt), i1 = findOp(h1, isAttempt);
  GD_ASSERT.ok(i0 >= 0 && i1 >= 0, 'HUD 必须画 Attempt 牌子');

  // 牌子是世界锚定的：相机上滚 1 格，它就正好下移 1 格（30px）。
  GD_ASSERT.near(h1[i1].args[2] - h0[i0].args[2], GD_Render.BLK, 1e-9,
    'Attempt 牌子必须跟着相机走（相机上滚 1 格 → 牌子下移 1 格）');
  // hud.js 自己算了一份 GROUND_Y（不能直接读 GD_Render.GROUND_Y：hud.js 要能脱离 render.js 加载），
  // 这里用 Attempt 牌子的屏幕高度把两份 GROUND_Y 钉在一起。
  GD_ASSERT.near(h0[i0].args[2], GD_Render.GROUND_Y - 3 * GD_Render.BLK, 1e-9,
    'HUD 的 GROUND_Y 必须与 render.js 的 GROUND_Y 相同（hud.js 是自己算的那一份）');

  // 其余的（FPS / 进度条 / 百分比）都是屏幕固定的，一次都不许动。
  var moved = [];
  for (var i = 0; i < h0.length; i++) {
    if (i === i0) continue;
    var va = verticals(h0[i]), vb = verticals(h1[i]);
    for (var j = 0; j < va.length; j++) {
      if (Math.abs(vb[j] - va[j]) > 1e-9) moved.push('#' + i + ' ' + h0[i].op + ' 动了 ' + (vb[j] - va[j]).toFixed(3));
    }
  }
  GD_ASSERT.ok(moved.length === 0, '只有 Attempt 牌子该跟着相机走，其余是屏幕固定的：' + moved.join(' | '));
});

// ---------------------------------------------------------------- I1 输入按来源分离

GD_ASSERT.test('I1 输入按来源分离：鼠标 + 空格可以同时按住', function () {
  var tgt = stubTarget(), win = stubTarget(), doc = stubTarget();
  var input = GD_Input.create(tgt, { win: win, doc: doc });
  var space = { code: 'Space', key: ' ', preventDefault: function () {} };
  var noop = { preventDefault: function () {} };

  // 鼠标按住 → 再按空格 → 松开空格：鼠标还按着，必须仍然按住
  tgt.dispatch('pointerdown', noop);
  GD_ASSERT.ok(input.get(), '按下鼠标应按住');
  win.dispatch('keydown', space);
  GD_ASSERT.ok(input.get(), '鼠标 + 空格同时按住');
  win.dispatch('keyup', space);
  GD_ASSERT.ok(input.get(), '松开空格后鼠标还按着，必须仍然按住');
  win.dispatch('pointerup');
  GD_ASSERT.ok(!input.get(), '两个来源都松开后必须松开');

  // 反过来：空格按住 → 按鼠标 → 松开鼠标：空格还按着，必须仍然按住
  win.dispatch('keydown', space);
  GD_ASSERT.ok(input.get(), '按下空格应按住');
  tgt.dispatch('pointerdown', noop);
  GD_ASSERT.ok(input.get(), '空格 + 鼠标同时按住');
  win.dispatch('pointerup');
  GD_ASSERT.ok(input.get(), '松开鼠标后空格还按着，必须仍然按住');
  win.dispatch('keyup', space);
  GD_ASSERT.ok(!input.get(), '两个来源都松开后必须松开');

  // 触摸是第三个独立来源
  doc.dispatch('touchstart', noop);
  GD_ASSERT.ok(input.get(), '按下触摸应按住');
  win.dispatch('keydown', space);
  win.dispatch('keyup', space);
  GD_ASSERT.ok(input.get(), '松开空格后触摸还按着，必须仍然按住');
  doc.dispatch('touchend');
  GD_ASSERT.ok(!input.get(), '触摸松开后必须松开');

  // blur：三个来源全清（切走窗口时浏览器未必派发 pointerup/keyup）
  tgt.dispatch('pointerdown', noop);
  win.dispatch('keydown', space);
  doc.dispatch('touchstart', noop);
  win.dispatch('blur');
  GD_ASSERT.ok(!input.get(), 'blur 之后必须全部松开');

  // 多实例互不影响：状态必须是实例字段，不能是模块级变量
  var t2 = stubTarget(), w2 = stubTarget(), d2 = stubTarget();
  var other = GD_Input.create(t2, { win: w2, doc: d2 });
  tgt.dispatch('pointerdown', noop);
  GD_ASSERT.ok(input.get(), '第一个实例应按住');
  GD_ASSERT.ok(!other.get(), '第二个实例不该被第一个实例影响');
  tgt.dispatch('pointerup');
});

// ---------------------------------------------------------------- A1 音频不把音符排到过去

function fakeAudioCtx(clock, starts) {
  function param(v) {
    return {
      value: v,
      setValueAtTime: function () {}, linearRampToValueAtTime: function () {},
      exponentialRampToValueAtTime: function () {}
    };
  }
  var c = {
    currentTime: 0, sampleRate: 1000, state: 'running', destination: {},
    close: function () {}, resume: function () {}
  };
  c.createGain = function () { return { gain: param(0), connect: function () { return this; } }; };
  c.createOscillator = function () {
    return {
      type: 'sine', frequency: param(440), connect: function () { return this; },
      start: function (t) { starts.push(t); }, stop: function () {}
    };
  };
  c.createBiquadFilter = function () {
    return { type: 'lowpass', frequency: param(350), connect: function () { return this; } };
  };
  c.createBuffer = function (ch, len) {
    return { getChannelData: function () { return new Float32Array(len); } };
  };
  c.createBufferSource = function () {
    return { buffer: null, connect: function () { return this; }, start: function (t) { starts.push(t); } };
  };
  return c;
}

GD_ASSERT.test('A1 音频调度器不把音符排到过去（后台节流），且丢音不丢相位', function () {
  var savedAC = window.AudioContext, savedSI = window.setInterval, savedCI = window.clearInterval;
  var starts = [], cb = null, ctx = null;
  try {
    window.AudioContext = function () { ctx = fakeAudioCtx(0, starts); return ctx; };
    // 接管定时器：后台节流就是"回调隔很久才跑一次"，用手动触发来模拟。
    window.setInterval = function (fn) { cb = fn; return 1; };
    window.clearInterval = function () { cb = null; };

    var step = GD_Audio.SPB / 4;                 // 一个 16 分音符的时长
    var origin = null, byResidue = {}, residueBad = [];

    // 把一批 start() 归到格点上，并检查同一余数（k%64）的格点排的音数始终一致。
    function take() {
      var local = {};
      for (var i = 0; i < starts.length; i++) {
        var k = Math.round((starts[i] - origin) / step);
        local[k] = (local[k] || 0) + 1;
      }
      starts.length = 0;
      for (var kk in local) {
        var k = Number(kk), r = ((k % 64) + 64) % 64;
        if (byResidue[r] === undefined) byResidue[r] = local[k];
        else if (byResidue[r] !== local[k]) {
          residueBad.push('格点 ' + k + '（余 ' + r + '）排了 ' + local[k] + ' 个音，同余数的其它格点是 ' + byResidue[r] + ' 个');
        }
      }
    }

    GD_Audio.start();
    GD_ASSERT.ok(cb !== null, 'start() 之后应当有调度定时器');

    // 正常跑 6.5 秒（每 25 ms 一次回调，和真实定时器一样），攒出整段 64 格的乐曲型态。
    ctx.currentTime += 0.025;
    cb();
    origin = Math.min.apply(null, starts);
    take();
    for (var f = 1; f < 260; f++) { ctx.currentTime += 0.025; cb(); take(); }
    GD_ASSERT.ok(residueBad.length === 0, '乐曲型态必须每 64 格重复一次：' + residueBad.join(' | '));

    // 模拟后台标签页：setInterval 被压到约 1 Hz，回调再跑时 nextNote 已落后几十秒。
    // 时刻刻意取 30.37 s（不是整拍），这样"重新锚定相位"的实现也会被下面的格点检查抓住。
    ctx.currentTime = 30.37;
    starts.length = 0;
    cb();
    var past = 0, offGrid = [], here = {};
    for (var i = 0; i < starts.length; i++) {
      var t = starts[i];
      if (t < ctx.currentTime) past++;
      var kk2 = (t - origin) / step;
      if (Math.abs(kk2 - Math.round(kk2)) > 1e-6) offGrid.push(t.toFixed(4));
      var k2 = Math.round(kk2);
      here[k2] = (here[k2] || 0) + 1;
    }
    GD_ASSERT.ok(past === 0, '后台 30 s 后第一次回调不该排出过期音符，实测 ' + past +
      ' 个（共排 ' + starts.length + ' 个）');
    GD_ASSERT.ok(offGrid.length === 0, '音符时刻必须仍在 1/4 拍网格上，实测偏离: ' + offGrid.join(','));
    var phaseBad = [];
    for (var hk in here) {
      var h = Number(hk), r2 = ((h % 64) + 64) % 64;
      if (byResidue[r2] === undefined) phaseBad.push('格点 ' + h + ' 没有参考');
      else if (byResidue[r2] !== here[h]) {
        phaseBad.push('格点 ' + h + ' 排了 ' + here[h] + ' 个音，同余数的参考是 ' + byResidue[r2] + ' 个');
      }
    }
    GD_ASSERT.ok(phaseBad.length === 0, '丢音不能丢相位：' + phaseBad.join(' | '));

    // 短一点的节流（约 1 秒）：换一个实例重来，模拟"另一局刚开"。
    GD_Audio.stop();
    GD_Audio.start();
    ctx.currentTime += 0.025;
    cb();
    var origin2 = Math.min.apply(null, starts);
    starts.length = 0;
    ctx.currentTime = 1.0;
    cb();
    var past2 = 0, offGrid2 = [];
    for (var j = 0; j < starts.length; j++) {
      var t2 = starts[j];
      if (t2 < ctx.currentTime) past2++;
      var k3 = (t2 - origin2) / step;
      if (Math.abs(k3 - Math.round(k3)) > 1e-6) offGrid2.push(t2.toFixed(4));
    }
    GD_ASSERT.ok(past2 === 0, '后台 1 s 后第一次回调不该排出过期音符，实测 ' + past2 +
      ' 个（共排 ' + starts.length + ' 个）');
    GD_ASSERT.ok(offGrid2.length === 0, '音符时刻必须仍在 1/4 拍网格上，实测偏离: ' + offGrid2.join(','));
  } finally {
    try { GD_Audio.stop(); } catch (e) { /* 停不掉也要把 window 上的假对象还回去 */ }
    window.AudioContext = savedAC;
    window.setInterval = savedSI;
    window.clearInterval = savedCI;
  }
});

// ---------------------------------------------------------------- M1 装配：回放驱动器

GD_ASSERT.test('M1 装配：回放一帧多推几步，玩家死了立刻收工', function () {
  var seq = [];
  for (var i = 0; i < GD_Replay.crossbeat.length; i++) {
    seq.push({ at: GD_Replay.crossbeat[i].t, down: GD_Replay.crossbeat[i].d });
  }
  var st = GD_Physics.create(GD_Level.crossbeat);
  var drv = GD_Main.replayDriver(st, seq);
  var frames = 0;
  while (drv.frame()) frames++;
  var res = drv.result();
  GD_ASSERT.ok(res.state.finished, '回放应通关，实测 percent=' + res.state.percent.toFixed(1));
  GD_ASSERT.ok(res.died === null, '回放不该死人');
  // 一帧 8 步：7695 个物理步只要 ~962 帧，比一步一帧的 7695 帧少一个数量级。
  GD_ASSERT.ok(frames > 700 && frames < 1200, '一帧多推几步后帧数应远少于物理步数，实测 ' + frames + ' 帧');

  // 死了要立刻收工（原来是等满 240*45 帧 ≈ 3 分钟）。
  var st2 = GD_Physics.create(GD_Level.crossbeat);
  var drv2 = GD_Main.replayDriver(st2, [{ at: 0, down: false }, { at: 1000, down: false }]);
  var frames2 = 0;
  while (drv2.frame()) frames2++;
  var res2 = drv2.result();
  GD_ASSERT.ok(res2.died !== null, '不按任何键必然撞刺，驱动器必须报出死亡');
  GD_ASSERT.ok(res2.died.x > 0 && res2.died.x < 30, '死亡点应在第一根尖刺附近，实测 x=' + res2.died.x.toFixed(2));
  GD_ASSERT.ok(frames2 < 240, '死亡后应立刻收工，不该等满帧数上限，实测 ' + frames2 + ' 帧');
});
