window.GD_Audio = (function () {
  var BPM = 154, SPB = 60 / BPM;      // 0.3896 s，等于一次跳跃的滞空
  var ctx = null, started = false, nextNote = 0, step16 = 0, timer = null;

  // spec §9：四小节（64 个 16 分音符）一循环。四小节不能一模一样，否则循环会显得机械；
  // 但每拍的底鼓/军鼓落点保持不动，玩家才踩得住拍子。第 3 小节底鼓加密、第 4 小节军鼓加花。
  var KICK = [].concat(
    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0],
    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0],
    [1,0,0,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0]
  );
  var SNARE = [].concat(
    [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
    [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
    [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
    [0,0,0,0, 1,0,0,0, 0,0,1,0, 1,0,1,1]
  );
  var HAT = [].concat(
    [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]
  );
  var BASS = [].concat(
    [55,0,0,55, 0,49,0,0, 43,0,0,43, 0,41,0,0],   // A1→G1→F1→E1 下行
    [55,0,0,55, 0,49,0,0, 43,0,0,43, 0,41,0,0],
    [55,0,55,0, 0,49,0,49, 43,0,43,0, 0,41,0,41], // 第 3 小节：贝斯跟着加密
    [41,0,0,43, 0,49,0,0, 55,0,0,55, 0,49,0,0]    // 第 4 小节：走回主音
  );

  // spec §9 的"段落切换移调"：violet（飞船段）整体 +5 个半音，比方块段更紧张。
  // +5 是自选音程——spec 只要求"移调"、没给音程，改 MOOD_SEMIS 即可换。
  // 音频层不 import 关卡数据，所以调性由 main.js 用 setMood(theme) 告知。
  // 移调只作用于贝斯：鼓点是噪声/低频冲击，移调会削弱冲击力。
  // 换段时立即换调，已经预排进 WebAudio 的 1–2 个 16 分音符仍用旧调——
  // 听感是过门处换调，允许；不为此加"下一小节再换"的复杂度。
  var MOOD_SEMIS = { blue: 0, violet: 5 };
  var semis = 0;
  function setMood(theme) { semis = MOOD_SEMIS[theme] || 0; }
  function bassFreq(f) { return f * Math.pow(2, semis / 12); }

  function env(node, t, dur, peak) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g); g.connect(ctx.destination);
    return g;
  }
  function hit(t, freq, dur, peak, type) {
    var o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.4), t + dur);
    env(o, t, dur, peak); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(t, dur, peak) {
    var len = Math.ceil(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var s = ctx.createBufferSource(); s.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    s.connect(f); env(f, t, dur, peak); s.start(t);
  }

  // 调度器只排"还没过期"的音符。
  // 为什么：Chrome 把后台标签页的 setInterval 压到约 1 Hz，回调再跑时 nextNote
  // 可能落后几十秒（实测后台 30 s 后第一次回调要补 606 个音符，其中 601 个时间点在过去）。
  // WebAudio 的 start(t) 在 t <= currentTime 时等于"立刻响"，于是这一批过期音会在
  // 同一瞬间炸响、几百个节点同时启动——听起来是"炸响一声"，机器上是几百个节点。
  // 所以过期的音**只走相位**（step16++），不建节点。
  // 相位必须照旧前进：节拍网格锚在启动时的 ctx.currentTime 上，
  // 丢音不等于丢拍子——否则整首曲子的强弱规律会从头再来一遍。
  function schedule() {
    var now = ctx.currentTime;
    // 落后太多时（后台标签页）不要一格一格补：直接跳到"现在"，
    // 但 step16 必须按跳过的格数同步前进，否则乐曲的强弱规律会错位。
    if (nextNote < now) {
      var skipped = Math.ceil((now - nextNote) / (SPB / 4));
      nextNote += skipped * (SPB / 4);
      step16 += skipped;
    }
    while (nextNote < now + 0.15) {
      var i = step16 % 64, t = nextNote;
      if (t >= now) {                      // 过期音不排（见上面的注释）
        if (KICK[i]) hit(t, 120, 0.13, 0.55);
        if (SNARE[i]) noise(t, 0.11, 0.22);
        if (HAT[i]) noise(t, 0.03, i % 2 ? 0.05 : 0.09);
        if (BASS[i]) {
          var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(bassFreq(BASS[i]), t);
          var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
          o.connect(lp); env(lp, t, SPB * 0.45, 0.16); o.start(t); o.stop(t + SPB * 0.5);
        }
      }
      nextNote += SPB / 4; step16++;
    }
  }

  function wake() {
    // 正常路径（main.js 在 input.get() 为真之后才 start）走到这里时 ctx 已经是 running；
    // 没有手势时 resume() 返回的 Promise 会一直 pending，等第一次点击/按键自己兑现。
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // 音频层自己兜住"第一次手势"。main.js 的 input.get() 只有"当前按着"，
  // 短于一帧的点按会漏掉；一旦漏掉、玩家又不再按，start() 就永远不会被调用——
  // 失败模式是整局没有音乐，不是"晚一点有音乐"。所以监听在脚本加载时就挂上。
  function firstGesture() {
    if (!started) start(); else wake();
  }
  var armed = false;
  function arm() {
    if (armed) return;
    armed = true;
    window.addEventListener('pointerdown', firstGesture, { once: true });
    window.addEventListener('keydown', firstGesture, { once: true });
  }
  function disarm() {
    if (!armed) return;
    armed = false;
    window.removeEventListener('pointerdown', firstGesture);
    window.removeEventListener('keydown', firstGesture);
  }

  function start() {
    if (started) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }   // 失败则静音继续，不阻塞游戏（spec §11.1）
    nextNote = ctx.currentTime + 0.05;
    // step16 必须归零：它记的是"乐曲走到了第几个 16 分音符"。
    // 不归零的话，stop() 之后重新 start 会从上一句的中间接着响——
    // 而关卡每次死亡重开都是从 attempt 1 重来的，玩家听到的应该是同一段乐曲的开头。
    step16 = 0;
    timer = setInterval(schedule, 25);
    started = true;
    wake();
    arm();      // stop() 之后重新 start 时把兜底监听补回来
  }
  function stop() {
    if (timer) clearInterval(timer);
    if (ctx) ctx.close();
    started = false; ctx = null;
    disarm();   // 别让反复 start/stop 攒下空监听
  }

  arm();        // 页面一加载就武装第一次手势，不依赖 main.js 是否调用 start()
  return { start: start, stop: stop, setMood: setMood, SPB: SPB, isOn: function () { return started; } };
})();
