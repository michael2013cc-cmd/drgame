window.GD_Input = (function () {
  // 输入状态按**来源**分开记，不是一个布尔量。
  // 为什么：玩家完全可能同时按住鼠标和空格（另一只手的手指、或者鼠标+键盘一起）。
  // 任何一个来源松开都不该把整体状态清掉——旧的单个 held 布尔量里
  // keyup 与 pointerup 都无条件写 false，于是"按着鼠标 + 按空格 + 松开空格"
  // 会让整局失去输入（实测 held 直接变 false），飞船段表现为"明明按着却往下掉"。
  //
  // create(target, env)：
  // env 缺省是 { win: window, doc: document }。留这个口子的理由：
  // 上面这条"多来源同时按住"的语义必须能被自动化测试驱动，而真实 DOM 事件
  // 在无头环境里造不出来；注入事件源之后，测试跑的是**同一份**生产代码，
  // 不是照着抄一遍的仿制品（仿制品会跟实现一起漂移，测了等于没测）。
  function create(target, env) {
    env = env || { win: window, doc: document };
    var win = env.win, doc = env.doc;
    var src = { key: false, pointer: false, touch: false };
    function held() { return src.key || src.pointer || src.touch; }
    function clearAll() { src.key = false; src.pointer = false; src.touch = false; }

    target.addEventListener('pointerdown', function (e) { e.preventDefault(); src.pointer = true; });
    win.addEventListener('pointerup', function () { src.pointer = false; });
    win.addEventListener('pointercancel', function () { src.pointer = false; });
    win.addEventListener('keydown', function (e) {
      if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); src.key = true; }
    });
    win.addEventListener('keyup', function (e) {
      if (e.code === 'Space' || e.key === ' ') src.key = false;
    });
    // 失焦时三个来源全清：切走窗口时浏览器未必派发 pointerup/keyup，
    // 只清一个来源会留下"幽灵按住"，回来之后飞船一直上升。
    win.addEventListener('blur', function () { clearAll(); });
    doc.addEventListener('touchstart', function (e) { e.preventDefault(); src.touch = true; }, { passive: false });
    doc.addEventListener('touchend', function () { src.touch = false; }, { passive: true });
    // touchcancel 也要清：手指在屏幕上被系统打断时不会派发 touchend，
    // 不清的话 touch 来源会永远按着（和旧实现同样的幽灵按住，只是换了来源）。
    doc.addEventListener('touchcancel', function () { src.touch = false; }, { passive: true });
    return { get: held };
  }
  return { create: create };
})();
