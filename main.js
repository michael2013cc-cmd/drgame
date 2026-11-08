window.GD_Main = (function () {
  var DT = GD_Physics.CONST.DT, MAX_FRAME = 0.05;   // 切后台钳制（spec §11.2）

  function boot(canvas) {
    var r = GD_Render.create(canvas);
    GD_Render.resize(canvas);
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

    window.addEventListener('resize', function () { GD_Render.resize(canvas); });

    return st;
  }

  var st = null;
  function install(canvas) {
    var errs = GD_Level.validate(GD_Level.crossbeat);
    if (errs.length) { throw new Error('关卡数据非法:\n' + errs.join('\n')); }   // spec §11.4
    st = boot(canvas);
    window.__GD_TEST__ = {                                        // spec §12
      step: function (n) { for (var i = 0; i < n; i++) GD_Physics.step(st, true); return st; },
      feed: function (seq) {
        var idx = 0, held = false, guard = 0;
        return new Promise(function (res) {
          function tick() {
            while (idx < seq.length && st.time >= seq[idx].at) { held = seq[idx].down === true; idx++; }
            GD_Physics.step(st, held);
            // 死亡期间 st.time 不推进，必须用帧数兜底，否则 Promise 永不 resolve
            guard++;
            if (idx >= seq.length || st.finished || guard > 240 * 45) { res(st); return; }
            requestAnimationFrame(tick);
          }
          tick();
        });
      },
      measure: function () { return GD_Physics.measureJump(1); },
      state: function () { return { x: st.x, y: st.y, mode: st.mode, speed: st.speedKey, alive: st.alive, percent: st.percent }; }
    };
  }
  return { install: install };
})();
