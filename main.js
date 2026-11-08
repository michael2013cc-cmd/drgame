window.GD_Main = (function () {
  var DT = GD_Physics.CONST.DT, MAX_FRAME = 0.05;   // 切后台钳制（spec §11.2）

  // 回放时一帧推几个物理步。
  // 为什么不是 1：整关回放要 7695 个物理步，一步一帧就是 7695 帧 ≈ 128 秒墙钟。
  // 8 步/帧 ≈ 962 帧 ≈ 16 秒。
  var FEED_STEPS_PER_FRAME = 8;

  // 回放驱动器：每次 frame() 推一帧（FEED_STEPS_PER_FRAME 个物理步）。
  // 为什么拆成"可一帧一帧手动驱动"：自动化断言是同步的，而 feed() 返回 Promise——
  // 无头环境里没法 await 一个同步断言。拆成驱动器之后，测试用同一个驱动器
  // 同步跑完整关，浏览器端再由 requestAnimationFrame 驱动同一份逻辑。
  function replayDriver(st, seq) {
    var idx = 0, held = false, guard = 0, done = false, died = null;
    function frame() {
      if (done) return false;
      for (var s = 0; s < FEED_STEPS_PER_FRAME; s++) {
        while (idx < seq.length && st.time >= seq[idx].at) { held = seq[idx].down === true; idx++; }
        GD_Physics.step(st, held);
        if (!st.alive) { died = { x: st.x, y: st.y, attempt: st.attempt }; break; }
      }
      // 死亡期间 st.time 不推进，必须用帧数兜底，否则永远不会结束。
      // 但玩家已经死了就没必要再死等（原来是等满 240*45 帧 ≈ 3 分钟）：立刻收工并带走死亡信息。
      // 注意**不以"按键序列用完"作为结束条件**：序列用完只说明没有输入了，
      // 玩家还在关里跑（实测通关序列的最后一个事件在 30.0 s，而关卡到 32.06 s 才结束，
      // 早收工会停在 94%）。结束条件只有三个：死了、通关了、帧数兜底。
      guard++;
      if (died || st.finished || guard > 240 * 45) { done = true; return false; }
      return true;
    }
    function result() { return { state: st, died: died, frames: guard }; }
    return { frame: frame, result: result, done: function () { return done; } };
  }

  // 浏览器端入口：把驱动器包成 Promise。
  function feed(st, seq) {
    var drv = replayDriver(st, seq);
    return new Promise(function (res) {
      function tick() {
        if (!drv.frame()) { res(drv.result()); return; }
        requestAnimationFrame(tick);
      }
      tick();
    });
  }

  function boot(canvas) {
    var r = GD_Render.create(canvas);
    r.resize();
    var st = GD_Physics.create(GD_Level.crossbeat);
    var input = GD_Input.create(canvas);
    var acc = 0, last = performance.now(), fps = 60, fpsAcc = 0, fpsN = 0, booted = false;
    var segIdx = -1;                    // 当前段落号；换段时把调性告诉音频层（spec §9）

    function frame(now) {
      var raw = (now - last) / 1000; last = now;
      var dt = Math.min(raw, MAX_FRAME);
      fpsAcc += raw; fpsN++;
      if (fpsAcc >= 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
      acc += dt;
      var steps = 0;
      while (acc >= DT && steps < Math.round(MAX_FRAME / DT)) { GD_Physics.step(st, input.get()); acc -= DT; steps++; }
      if (steps === Math.round(MAX_FRAME / DT)) acc = 0;      // 抛掉追不上的积压

      // 音乐调性跟关卡段落走：段落有自己的 theme，音频层不认识关卡数据，所以由这里告知。
      var segs = st.level.segments, si = 0;
      while (si < segs.length && !(st.x >= segs[si].from && st.x < segs[si].to)) si++;
      if (si !== segIdx) { segIdx = si; GD_Audio.setMood(segs[si] && segs[si].theme); }

      GD_Render.draw(r, st, dt);                         // dt 要用渲染帧的真实秒数，粒子才按真实速度渐隐
      GD_Hud.draw(r.ctx, st, fps, r.camY);               // camY 让 HUD 里跟着世界走的部分过相机
      // 音频必须由用户手势触发：浏览器只允许在手势之后让 AudioContext 跑起来。
      // 不能用 st.x>0——方块模式开局第一帧 x 就 >0，等于没有手势就建 ctx，整局静音。
      if (!booted && input.get()) { GD_Audio.start(); booted = true; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    window.addEventListener('resize', function () { r.resize(); });

    return st;
  }

  var st = null;
  function install(canvas) {
    var errs = GD_Level.validate(GD_Level.crossbeat);
    if (errs.length) { throw new Error('关卡数据非法:\n' + errs.join('\n')); }   // spec §11.4
    st = boot(canvas);
    window.__GD_TEST__ = {                                        // spec §12
      step: function (n) { for (var i = 0; i < n; i++) GD_Physics.step(st, true); return st; },
      feed: function (seq) { return feed(st, seq); },
      measure: function () { return GD_Physics.measureJump(1); },
      state: function () { return { x: st.x, y: st.y, mode: st.mode, speed: st.speedKey, alive: st.alive, percent: st.percent }; }
    };
  }
  return { install: install, feed: feed, replayDriver: replayDriver };
})();
