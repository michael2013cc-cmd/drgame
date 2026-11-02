GD_ASSERT.test('S1 脚手架可用', function () {
  GD_ASSERT.ok(typeof GD_ASSERT.approx === 'function', 'approx 存在');
  GD_ASSERT.approx(2.173, 2.17, 0.02, 'approx 自身精度');
});

GD_ASSERT.test('S2 断言失败能被捕获', function () {
  var caught = false;
  try {
    // 内部再跑一次必然失败的近似，确认它会抛
    GD_ASSERT.approx(1.0, 2.0, 0.02, '故意失败');
  } catch (e) { caught = /期望/.test(e.message); }
  GD_ASSERT.ok(caught, 'approx 失败时应抛出带"期望"的错误');
});
