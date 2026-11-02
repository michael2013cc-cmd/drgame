window.GD_ASSERT = (function () {
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }

  function approx(actual, expected, tolPct, label) {
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
      catch (e) { fail++; log.push('FAIL ' + t.name + ' — ' + e.message); }
    }
    window.__RESULTS__ = { pass: pass, fail: fail, log: log };
    window.__READY__ = true;
    document.title = fail === 0 ? 'PASS ' + pass : 'FAIL ' + fail;
    return window.__RESULTS__;
  }

  return { test: test, approx: approx, ok: ok, near: near, run: run };
})();
