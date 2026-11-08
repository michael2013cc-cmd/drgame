window.GD_ASSERT = (function () {
  var tests = [];
  var EXPECTED_COUNT = null;
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function expect_tests(n) { EXPECTED_COUNT = n; }

  // 近似比较前必须先确认两个值都是有限数。
  // 以前不查：|NaN - 32| > tol 恒为 false，于是 approx(NaN, 32, ...) 悄悄放过。
  // 后果实测过：把某段的 speed 写成 '2x' → L2 算出的时长变成 NaN → L2 仍绿，
  // 而 validate() 又放行了那个关卡 → L1 也绿。一条写错的速度键名能同时骗过两条断言。
  function finite(actual, expected, label) {
    if (typeof actual !== 'number' || !isFinite(actual)) {
      throw new Error((label || 'approx') + ': 实得非有限值 ' + actual + '（期望 ' + expected + '）');
    }
    if (typeof expected !== 'number' || !isFinite(expected)) {
      throw new Error((label || 'approx') + ': 期望值非有限 ' + expected);
    }
  }

  function approx(actual, expected, tolPct, label) {
    if (expected === 0) throw new Error((label || 'approx') + ': 期望值为 0，approx 用相对误差无意义，改用 near()');
    finite(actual, expected, label);
    var err = Math.abs(actual - expected) / Math.abs(expected);
    if (err > tolPct) {
      throw new Error((label || 'approx') + ': 期望 ' + expected +
        ' 实得 ' + actual + ' 偏差 ' + (err * 100).toFixed(2) + '% > ' + (tolPct * 100) + '%');
    }
  }
  function ok(cond, label) {
    if (!cond) throw new Error('断言失败: ' + (label || 'ok'));
  }
  function near(actual, expected, abs, label) {
    // 同 approx：NaN 参与比较恒为 false，不查的话 near(NaN, 0, 0.001) 永远通过
    finite(actual, expected, label);
    if (Math.abs(actual - expected) > abs) {
      throw new Error((label || 'near') + ': 期望 ' + expected + ' 实得 ' + actual +
        ' 差 ' + Math.abs(actual - expected).toFixed(6) + ' > ' + abs);
    }
  }

  function run() {
    var pass = 0, fail = 0, log = [];
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
      try { t.fn(); pass++; log.push('PASS ' + t.name); }
      catch (e) { fail++; log.push('FAIL ' + t.name + ' — ' + String(e && e.message || e)); }
    }
    if (EXPECTED_COUNT !== null && tests.length !== EXPECTED_COUNT) {
      fail++;
      // 少注册和多注册的原因完全不同，提示语要分开说：
      // 少了 = 有用例文件在注册期抛异常或没加载；多了 = 门禁数字本身该跟着改。
      var why = tests.length < EXPECTED_COUNT
        ? '（有用例文件抛异常、为空或没加载）'
        : '（多注册了用例：expect_tests 的门禁数字该一起改）';
      log.push('FAIL 用例注册数: 期望 ' + EXPECTED_COUNT + ' 条，实得 ' + tests.length + ' 条' + why);
    }
    window.__RESULTS__ = { pass: pass, fail: fail, registered: tests.length, log: log };
    window.__READY__ = true;
    document.title = fail === 0 ? 'PASS ' + pass : 'FAIL ' + fail;
    return window.__RESULTS__;
  }

  return { test: test, approx: approx, ok: ok, near: near, expect_tests: expect_tests, run: run };
})();

// 源码预取：D1 要静态检查 physics.js 里有没有渲染/输入/音频层的引用，
// 而 harness 里跑的是**已经执行过**的脚本，拿不到源码文本。
// fetch 拿回来的是同一份文件的原文，所以 D1 断的就是磁盘上那份代码。
// fetch 对 404 是 resolve 不是 reject，所以缺文件不会报错、只会少一个键——
// 下面这 6 个文件现在**都存在**了，但 SOURCES 的键数必须凑够 6，
// harness 的轮询条件（等预取完成再 run）才成立。少一个键 → 轮询超时 → 用例不跑。
GD_ASSERT.SOURCES = {};
(function () {
  var files = ['../physics.js', '../level.js', '../render.js', '../hud.js', '../input.js', '../audio.js'];
  files.forEach(function (f) {
    fetch(f).then(function (r) { return r.text(); })
      .then(function (t) { GD_ASSERT.SOURCES[f.replace('../', '')] = t; });
  });
})();
