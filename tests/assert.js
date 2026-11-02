window.GD_ASSERT = (function () {
  var tests = [];
  var EXPECTED_COUNT = null;
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function expect_tests(n) { EXPECTED_COUNT = n; }

  function approx(actual, expected, tolPct, label) {
    if (expected === 0) throw new Error((label || 'approx') + ': 期望值为 0，approx 用相对误差无意义，改用 near()');
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
      log.push('FAIL 用例注册数: 期望 ' + EXPECTED_COUNT + ' 条，实得 ' + tests.length +
        ' 条（有用例文件抛异常、为空或没加载）');
    }
    window.__RESULTS__ = { pass: pass, fail: fail, registered: tests.length, log: log };
    window.__READY__ = true;
    document.title = fail === 0 ? 'PASS ' + pass : 'FAIL ' + fail;
    return window.__RESULTS__;
  }

  return { test: test, approx: approx, ok: ok, near: near, expect_tests: expect_tests, run: run };
})();
