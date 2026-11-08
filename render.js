window.GD_Render = (function () {
  'use strict';

  var LW = 427, LH = 240, BLK = 30;
  var GROUND_Y = LH - 2.2 * BLK;          // spec §8：地面线离底 2.2 格
  var ANCHOR_X = LW / 2 - 60;             // 玩家锚点

  // 地面线以上的可见格高：地面线画在 y=174，它上面一共 174px = 5.8 格。
  // （别写成 (LH - GROUND_Y)/BLK——那是地面线**以下**的 2.2 格，方向反了。）
  var VIS_TOP = GROUND_Y / BLK;           // 5.8

  // 纵向相机的死区：玩家相对相机（st.y - camY）落在 [CAM_LO, CAM_HI] 里时相机不动。
  // 下界 1.0：玩家不能一直贴着地面线；上界 VIS_TOP-1.2：头顶离画布顶还留一点余量。
  // 直接令相机等于玩家 y 的话，方块段每跳一下画面就抖一下——所以用死区。
  var CAM_LO = 1.0;
  var CAM_HI = VIS_TOP - 1.2;             // 4.6

  // 背景纵向视差：背景是"远"，纵向只跟 0.3 倍；跟得太实会糊住前景该有的层次
  var BG_PARALLAX_Y = 0.3;

  var THEME = {
    blue:   { far: '#0e4c95', mid: '#1157a8', near: '#0a4184', ground: '#062a52', deep: '#041f3c', line: '#7fe4ff', fill: '#05213d' },
    violet: { far: '#3b1470', mid: '#4c1d95', near: '#2b0d57', ground: '#1b0840', deep: '#120530', line: '#c4a6ff', fill: '#150433' }
  };

  function create(canvas) {
    var ctx = canvas.getContext('2d');
    // wasAlive 必须是实例字段而非模块级变量，否则多实例/重开测试会串状态
    // camY（纵向相机）同理：它是"这个渲染实例正在看哪一段"，两个实例各看各的
    var r = { canvas: canvas, ctx: ctx, parts: [], debris: [], wasAlive: true, camY: 0 };
    // resize 做成**实例方法**而不是模块级函数：它改的是"这个实例的画布"的后备存储与缩放比。
    // 做成模块级函数就得多收一遍 canvas 参数，传错实例时会把别的画布的缩放改掉——
    // 而这个错误在画面上根本看不出来（两个画布长得一模一样）。
    r.resize = function () {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var availW = Math.max(320, window.innerWidth - 16);
      var availH = Math.max(180, window.innerHeight - 16);
      var k = Math.max(1, Math.floor(Math.min(availW / LW, availH / LH)));
      r.canvas.style.width = (LW * k) + 'px';
      r.canvas.style.height = (LH * k) + 'px';
      r.canvas.width = Math.round(LW * k * dpr);
      r.canvas.height = Math.round(LH * k * dpr);
      // 改 canvas.width/height 会把 2D 上下文的全部状态清掉（变换矩阵也在内），
      // 所以 setTransform 必须在尺寸设好**之后**再设一次。
      r.ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
      r.ctx.imageSmoothingEnabled = false;
      return k;
    };
    return r;
  }

  function themeOf(st) {
    var segs = st.level.segments || [];
    for (var i = 0; i < segs.length; i++) if (st.x >= segs[i].from && st.x < segs[i].to) return THEME[segs[i].theme] || THEME.blue;
    return THEME.blue;
  }

  function rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function wx(st, blockX) { return (blockX - st.x) * BLK + ANCHOR_X; }

  // 纵向定位一律过相机：相机上滚 camY 格，地面线就跟着往画面下方退 camY 格，
  // 世界高度 y 画在屏幕 (GROUND_Y - (y - camY) * BLK)。
  function wy(r, blockY) { return GROUND_Y - (blockY - r.camY) * BLK; }

  // 纵向相机（死区跟随）。
  // 为什么必须有：关卡的飞船段通道设计到 y=10，而画布地面线以上只有 5.8 格——
  // 通道的天花板本来就在画面外，固定相机会让玩家**整个飞出画面**，玩家根本看不见自己在哪。
  // （封顶之前更糟：飞船段没有天花板，玩家能飞到 y=46，现在封顶了最高也只有 8.45。）
  // 死区而不是直接跟随：直接跟随的话方块段每跳一下画面就抖一下。
  function updateCamera(r, st) {
    var rel = st.y - r.camY;
    if (rel > CAM_HI) {
      r.camY = st.y - CAM_HI;              // 玩家太高 → 相机上滚，把玩家压回死区上界
    } else if (rel < CAM_LO) {
      var want = st.y - CAM_LO;
      // 不许把相机推到地面线以下：地面线以下是地面色带，再往下没有内容可看，
      // 而且方块段（y 只在 0…2.7）必须**完全不滚**，否则每跳一下画面就抖。
      r.camY = want > 0 ? want : 0;
    }
  }

  function background(ctx, r, st) {
    var C = themeOf(st);
    rect(ctx, 0, 0, LW, LH, C.far);
    var dy = r.camY * BLK * BG_PARALLAX_Y;   // 相机上滚 → 背景往下挪（只跟 0.3 倍）
    var off = (st.x * BLK * 0.35) % 260;
    ctx.fillStyle = C.mid;
    for (var i = -1; i < 4; i++) for (var j = 0; j < 3; j++) ctx.fillRect(i * 260 - off - 60, 10 + j * 78 + dy, 190, 58);
    off = (st.x * BLK * 0.6) % 200;
    ctx.fillStyle = C.near;
    for (var k = -1; k < 4; k++) ctx.fillRect(k * 200 - off, 120 + dy, 130, 50);
    return C;
  }

  function ground(ctx, r, st, C) {
    var gy = wy(r, 0);                      // 地面线的屏幕位置：随相机走
    rect(ctx, 0, gy, LW, LH - gy, C.ground);
    var off = (st.x * BLK) % 60;
    ctx.fillStyle = C.deep;
    for (var k = -1; k < 9; k++) ctx.fillRect(k * 60 - off, gy + 8, 44, LH - gy);
    rect(ctx, 0, gy - 1, LW, 2, C.line);
  }

  function block(ctx, r, st, x, y, C) {
    var px = wx(st, x), py = wy(r, y + 1);
    rect(ctx, px, py, BLK, BLK, C.fill);
    rect(ctx, px, py, BLK, 2, C.line);
    rect(ctx, px, py, 2, BLK, C.line);
    ctx.strokeStyle = '#eaf7ff'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, BLK - 2, BLK - 2);
  }

  function spike(ctx, r, st, x, y) {
    var px = wx(st, x), py = wy(r, y);
    ctx.strokeStyle = '#eaf7ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + BLK, py); ctx.lineTo(px + BLK / 2, py - BLK); ctx.closePath();
    // 内部近黑渐变（spec §8）：平涂实色在深色背景上看不出立体感，
    // "白描边 + 内部近黑渐变"才是原版的观感。渐变轴跟着世界走（两端都用 wy 定位）。
    var g = ctx.createLinearGradient(px, py - BLK, px, py);
    g.addColorStop(0, '#0b1a28');
    g.addColorStop(1, '#01060c');
    ctx.fillStyle = g;
    ctx.fill(); ctx.stroke();
  }

  // 通高门柱。
  // 物理层的触发框是 [o.y, o.y + CONST.HIT.GATE_H]，GATE_H = 256 格，也就是**通高**：
  // 玩家在门柱所在的那一列里，任何高度都能吃到这扇门（Task 7 把门框从 2.6 格改成通高）。
  // 如果这里还画 2.6 格高的小椭圆，画面上会看得见玩家"从一根矮门柱旁边飞过去"，
  // 判定却生效了——**画出来的东西必须和判定框是同一个东西**，否则玩家没法判断自己有没有进门。
  // 所以门柱从门底一直画到画布顶：底边取 o.y（与触发框底边同一个 y），顶边取 0。
  // 门柱宽度取 1.4 格，与 CONST.HIT.GATE_W 一致。
  function portal(ctx, r, st, x, y, color, glyph) {
    var px = wx(st, x), w = 1.4 * BLK;
    var bottom = wy(r, y);                  // 门柱底边 = 触发框底边 = 门的 y
    var glyphY = bottom - 2.5 * BLK;       // 符号离底 2.5 格：必须落在画面里，不能画到门外

    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(px, 0, w, bottom);         // 门柱本体：门底 → 画布顶（y=0）
    ctx.fillStyle = color;
    ctx.fillRect(px, 0, 3, bottom);         // 左门框
    ctx.fillRect(px + w - 3, 0, 3, bottom); // 右门框
    ctx.fillRect(px, bottom - 3, w, 3);     // 门槛：与触发框底边对齐
    // 符号外面套一个椭圆环，保留原版"传送门是个圈"的读法
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(px + w / 2, glyphY - 3, 0.5 * BLK, 0.42 * BLK, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
    ctx.fillText(glyph, px + w / 2, glyphY);
    ctx.textAlign = 'left';
  }

  function objects(ctx, r, st, C) {
    var objs = st.level.objects;
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      var sx = wx(st, o.x);
      if (sx < -BLK * 2 || sx > LW + BLK * 2) continue;
      if (o.t === 'block') block(ctx, r, st, o.x, o.y, C);
      else if (o.t === 'spike') spike(ctx, r, st, o.x, o.y);
      else if (o.t === 'pad_pink' || o.t === 'pad_yellow') {
        rect(ctx, sx, wy(r, o.y) - 5, BLK, 5, o.t === 'pad_pink' ? '#ff5fa8' : '#ffd23f');
      }
      else if (o.t === 'ring_pink' || o.t === 'ring_yellow') {
        ctx.strokeStyle = o.t === 'ring_pink' ? '#ff5fa8' : '#ffd23f'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(sx + BLK / 2, wy(r, o.y + 0.5), BLK * 0.45, 0, Math.PI * 2); ctx.stroke();
      }
      else if (o.t === 'portal_ship') portal(ctx, r, st, o.x, o.y, '#ff8a3d', '▲▼');
      else if (o.t === 'portal_cube') portal(ctx, r, st, o.x, o.y, '#3dd6ff', '■');
      else if (o.t.indexOf('speed_') === 0) portal(ctx, r, st, o.x, o.y, '#7cff5f', '»');
      else if (o.t === 'finish') {
        rect(ctx, sx, wy(r, 0) - 180, 4, 180, '#ffe14d');
        rect(ctx, sx + 4, wy(r, 0) - 180, 26, 14, '#ffe14d');
      }
    }
  }

  // 方块图标（spec §8）：1 格见方，黑外框 + 绿主体 + 两只方眼 + 一条横嘴。
  // 坐标是"以图标中心为原点"的局部坐标，描边在最后画，才不会被主体盖住。
  function cubeIcon(ctx, s) {
    rect(ctx, -s / 2, -s / 2, s, s, '#0b1b2a');
    rect(ctx, -s / 2 + 3, -s / 2 + 3, s - 6, s - 6, '#4cd137');
    rect(ctx, -s / 2 + 7, -s / 2 + 7, 6, 6, '#0b1b2a');
    rect(ctx, s / 2 - 13, -s / 2 + 7, 6, 6, '#0b1b2a');
    rect(ctx, -s / 2 + 8, s / 2 - 13, s - 16, 5, '#0b1b2a');
    ctx.strokeStyle = '#eaf7ff'; ctx.lineWidth = 2; ctx.strokeRect(-s / 2, -s / 2, s, s);
  }

  // 飞船图标：1 格见方、朝上的三角形。
  // spec §8 只规定了方块模式的图标，没规定飞船长什么样；但飞船段占关卡的 1/3（x=118–254），
  // 用方块画飞船一眼就是错的（原版里飞船是三角形），所以这里自选画法：
  // 与方块图标同一套配色（黑外框 + 绿主体 + 白描边 + 深色眼睛），只是外形换成三角形。
  // 三角形跟着 st.rot 一起转，飞船的仰角就自然体现在倾角上，不用额外算。
  function shipIcon(ctx, s) {
    ctx.fillStyle = '#0b1b2a';
    ctx.beginPath();
    ctx.moveTo(-s / 2, s / 2); ctx.lineTo(s / 2, s / 2); ctx.lineTo(0, -s / 2); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#eaf7ff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#4cd137';                    // 内芯：往外框里收 4px，留出黑边
    ctx.beginPath();
    ctx.moveTo(-s / 2 + 4, s / 2 - 4); ctx.lineTo(s / 2 - 4, s / 2 - 4); ctx.lineTo(0, -s / 2 + 4); ctx.closePath();
    ctx.fill();
    rect(ctx, -3, -4, 6, 6, '#0b1b2a');          // 一只眼
  }

  function player(ctx, r, st) {
    var px = wx(st, st.x), py = wy(r, st.y + 1);
    ctx.save();
    ctx.translate(px + BLK / 2, py + BLK / 2);
    ctx.rotate(st.rot * Math.PI / 180);
    if (st.mode === 'ship') shipIcon(ctx, BLK); else cubeIcon(ctx, BLK);
    ctx.restore();
  }

  function emitTrail(r, st) {
    if (!st.alive) return;
    r.parts.push({ x: st.x - 0.35, y: st.y + 0.15, a: 1, c: '#7fe4ff', s: 5 });
    if (r.parts.length > 200) r.parts.splice(0, r.parts.length - 200);
  }

  function emitDebris(r, st) {
    for (var i = 0; i < 22; i++) {
      r.debris.push({
        x: st.x, y: st.y + 0.5,
        vx: (Math.random() - 0.5) * 14, vy: Math.random() * 16,
        a: 1, c: i % 2 ? '#4cd137' : '#7fe4ff', s: 3 + Math.random() * 4
      });
    }
  }

  function particles(ctx, r, st, dt) {
    var i, p;
    for (i = r.parts.length - 1; i >= 0; i--) {
      p = r.parts[i]; p.a -= dt * 2.0;
      if (p.a <= 0) { r.parts.splice(i, 1); continue; }
      ctx.globalAlpha = p.a * 0.5; rect(ctx, wx(st, p.x), wy(r, p.y) - p.s, p.s, p.s, p.c);
    }
    for (i = r.debris.length - 1; i >= 0; i--) {
      p = r.debris[i]; p.a -= dt * 1.6; p.vy -= 60 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.a <= 0) { r.debris.splice(i, 1); continue; }
      ctx.globalAlpha = p.a; rect(ctx, wx(st, p.x), wy(r, p.y), p.s, p.s, p.c);
    }
    ctx.globalAlpha = 1;
  }

  function draw(r, st, dt) {
    var ctx = r.ctx;
    if (r.wasAlive && !st.alive) emitDebris(r, st);
    r.wasAlive = st.alive;
    emitTrail(r, st);
    updateCamera(r, st);
    ctx.clearRect(0, 0, LW, LH);
    var C = background(ctx, r, st);
    objects(ctx, r, st, C);
    ground(ctx, r, st, C);
    particles(ctx, r, st, dt);
    if (st.alive) player(ctx, r, st);
  }

  return { create: create, draw: draw, LW: LW, LH: LH, BLK: BLK, GROUND_Y: GROUND_Y };
})();
