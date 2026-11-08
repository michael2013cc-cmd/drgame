window.GD_Hud = (function () {
  var LW = 427, LH = 240, BLK = 30;
  // 地面线的屏幕高度，与 render.js 的 GROUND_Y 同一个式子（240 - 2.2*30 = 174）。
  // 这里不直接读 GD_Render.GROUND_Y：hud.js 要能脱离 render.js 单独加载
  // （harness 与静态校验里都不保证 render.js 先于 hud.js 执行）。
  var GROUND_Y = LH - 2.2 * BLK;

  // camY = 纵向相机已经上滚了多少格，由调用方传渲染实例的 r.camY（默认 0 表示相机在原点）。
  // 默认 0 是为了能单独画；但**传渲染句柄 r 进来时别忘了一起传 r.camY**，否则相机会被当成 0。
  function draw(ctx, st, fps, camY) {
    camY = camY || 0;
    ctx = ctx.ctx !== undefined ? ctx.ctx : ctx;      // 兼容传 render 句柄
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillText(Math.round(fps) + ' FPS', 3, 10);   // FPS 是屏幕固定的，不跟世界走

    // Attempt 跟随世界滚动。y 也必须过相机（即 render.js 的 wy(3)）：
    // 只按屏幕坐标钉死的话，飞船把相机拉高之后这行字会留在半空、和世界脱节。
    var ax = (2 - st.x) * 30 + 213;
    var ay = GROUND_Y - (3 - camY) * BLK;
    if (ax > -80 && ax < LW) ctx.fillText('Attempt ' + st.attempt, ax, ay);

    // 进度条是屏幕固定的，所以不过相机。
    // 圆角（spec §8「底部居中半透明圆角进度条」）：用 roundRect 而不是
    // fillRect+strokeRect，直角条和原版观感差得一眼能看出来。
    var bw = 340, bx = (LW - bw) / 2, by = LH - 14;
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, 7, 3.5); ctx.fill();
    ctx.fillStyle = '#4cd137';
    ctx.beginPath(); ctx.roundRect(bx, by, bw * st.percent / 100, 7, 3.5); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(bx + 0.5, by + 0.5, bw - 1, 6, 3); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText(Math.floor(st.percent) + '%', LW / 2, by - 3);
    ctx.textAlign = 'left';

    if (st.finished) {
      ctx.fillStyle = '#ffe14d'; ctx.font = '16px monospace'; ctx.textAlign = 'center';
      ctx.fillText('100%', LW / 2, LH / 2); ctx.textAlign = 'left';
    } else if (!st.alive) {
      ctx.fillStyle = 'rgba(255,90,90,.9)'; ctx.font = '13px monospace'; ctx.textAlign = 'center';
      ctx.fillText('DEAD', LW / 2, LH / 2); ctx.textAlign = 'left';
    }
  }

  return { draw: draw };
})();
