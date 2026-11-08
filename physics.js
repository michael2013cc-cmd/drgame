window.GD_Physics = (function () {
  'use strict';

  var CONST = {
    BLOCK_PX: 30,
    DT: 1 / 240,
    G: 115.0,                 // 格/秒²，方块与飞船共用（原版同一硬编码常数）
    JUMP_V0: 22.36,           // 格/秒
    FALL_CAP: 30.0,           // 格/秒，15 px/帧
    ROT_SPEED: 270,           // 度/秒，空中恒速
    ROT_SNAP: 20,             // 落地吸附到最近 90° 的插值速率
    LAND_TOL: 0.33,           // 格，10 units
    SOLID_HB: 0.3,            // 与实心块共用的缩小框边长
    SPIKE_HW: 0.55,           // 尖刺致死框宽（自调参项，spec §13.1）
    SPIKE_HH: 0.55,           // 尖刺致死框高（自调参项，spec §13.1）
    DEATH_DELAY: 1.0,
    SPEEDS: { 0.5: 8.372, 1: 10.386, 2: 12.914, 3: 15.600, 4: 19.200 },
    SHIP: { UP_A: 46.0, DOWN_A: 55.2, CAP_UP: 16.0, CAP_DOWN: -19.2, CAP_DOWN_HELD: -12.8 },
    PAD: { pad_pink: 21.08, pad_yellow: 32.28 },
    RING: { ring_pink: 15.78, ring_yellow: 23.40 },
    // 命中框尺寸：以前散在 collide() 里当字面量，想调框宽就得同时改好几处，
    // 漏一处就会出现"看着撞上了却不判死"或"没撞上却判死"。收进表里，
    // 测试也能直接读同一份数字，不必在测试里另抄一遍。
    HIT: {
      PAD_H: 0.35,                          // 跳板顶面厚度
      RING_X0: -0.6, RING_X1: 1.6,          // 跳环触发框相对环心的横向范围
      RING_Y0: -0.6, RING_Y1: 1.6,          // 跳环触发框相对环心的纵向范围
      GATE_W: 1.4, GATE_H: 2.6              // 传送门/速度门触发框
    }
  };

  // 关卡常数表被导出去给 render/hud/tests 读，必须冻死：实测把 CONST.G 改成 1
  // 会让 measureJump 的顶点从 2.17 变成 151.7，而物理照样"能跑"。
  // 冻结是浅层的，四个子表各自也要冻。strict mode 下写入会抛，非严格调用方静默失败，
  // 都比静默污染物理好。
  Object.freeze(CONST);
  Object.freeze(CONST.SPEEDS);
  Object.freeze(CONST.SHIP);
  Object.freeze(CONST.PAD);
  Object.freeze(CONST.RING);
  Object.freeze(CONST.HIT);

  var GROUND = 0;   // 地面线 y=0，向上为正

  function create(level) {
    return {
      level: level || { segments: [{ from: 0, to: 1000, mode: 'cube', speed: 1 }], objects: [], meta: { endBlock: 1000 } },
      x: 0, y: 0, vy: 0, rot: 0,
      mode: 'cube', speedKey: 1,
      alive: true, finished: false, deadTimer: 0, attempt: 1,
      time: 0, onGround: true, percent: 0,
      used: {}          // 一次性触发物（跳环）已用标记，键为对象下标
    };
  }

  function vxOf(st) { return CONST.SPEEDS[st.speedKey] || CONST.SPEEDS[1]; }

  function die(st) {
    if (!st.alive) return;
    st.alive = false;
    st.deadTimer = CONST.DEATH_DELAY;
  }

  function respawn(st) {
    st.x = 0; st.y = 0; st.vy = 0; st.rot = 0;
    st.alive = true; st.finished = false; st.deadTimer = 0;
    st.attempt += 1; st.time = 0; st.onGround = true; st.percent = 0;
    var seg = st.level.segments[0];
    st.mode = seg.mode;
    st.speedKey = seg.speed;
    st.used = {};
  }

  // 玩家 AABB：中心 x、底边 y，1×1 格
  function playerBox(st) {
    return { x0: st.x - 0.5, x1: st.x + 0.5, y0: st.y, y1: st.y + 1 };
  }
  function overlap(a, b) {
    return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  }
  function boxOf(o) {
    if (o.t === 'block') return { x0: o.x, x1: o.x + 1, y0: o.y, y1: o.y + 1 };
    if (o.t === 'spike') {
      var c = CONST.SPIKE_HW / 2;
      return { x0: o.x + 0.5 - c, x1: o.x + 0.5 + c, y0: o.y, y1: o.y + CONST.SPIKE_HH };
    }
    return { x0: o.x, x1: o.x + 1, y0: o.y, y1: o.y + 1 };
  }

  // 只遍历 x 附近的对象；关卡 ~200 个对象，线性扫描足够（不建索引，YAGNI）
  function nearby(st) {
    var out = [], objs = st.level.objects;
    for (var i = 0; i < objs.length; i++) {
      if (objs[i].x > st.x - 3 && objs[i].x < st.x + 3) out.push({ i: i, o: objs[i] });
    }
    return out;
  }

  function step(st, held) {
    if (!st.alive) {
      st.deadTimer -= CONST.DT;
      // 判定用"离整步最近"而不是 `<= 0`：DEATH_DELAY = 1.0 恰好是 240 个 1/240，
      // 但 1/240 在二进制里除不尽，连减 240 次还剩 +2.3e-15，
      // 于是重开永远慢一步（实测死在第 241 步，x 白吃掉 0.043 格的判定预算）。
      if (st.deadTimer <= CONST.DT * 0.5) respawn(st);
      return;
    }
    if (st.finished) return;

    var dt = CONST.DT;
    st.time += dt;
    st.x += vxOf(st) * dt;

    if (st.mode === 'cube') stepCube(st, held, dt);
    else stepShip(st, held, dt);

    collide(st, held);

    if (st.alive) {
      var end = st.level.meta ? st.level.meta.endBlock : 1000;
      st.percent = Math.min(100, Math.max(0, st.x / end * 100));
      if (st.x >= end) st.finished = true;
    }
  }

  function stepCube(st, held, dt) {
    if (st.onGround) {
      if (held) { st.vy = CONST.JUMP_V0; st.onGround = false; }
      else {
        var gy = groundY(st);
        // 支撑面掉到脚下以下 = 走出了台沿，必须放成自由落体，不能拿 gy 硬吸附。
        // 旧写法一步把 y 从 1 拉到 0（实测 x=5.5246 那步，两格台同样是 2→0 一步到底），
        // 于是"走下台阶"既不掉落也就永远勾不出空中态，coyote 无从验证。
        if (gy < st.y) st.onGround = false;
        else st.y = gy;
      }
    }
    if (!st.onGround) {
      // velocity-Verlet：对恒定加速度解析精确，不要改成半隐式欧拉
      st.y += st.vy * dt - 0.5 * CONST.G * dt * dt;
      st.vy -= CONST.G * dt;
      if (st.vy < -CONST.FALL_CAP) st.vy = -CONST.FALL_CAP;
      st.rot += CONST.ROT_SPEED * dt;
    } else {
      var target = Math.round(st.rot / 90) * 90;
      st.rot += (target - st.rot) * Math.min(1, CONST.ROT_SNAP * dt);
    }
  }

  function stepShip(st, held, dt) {
    var S = CONST.SHIP;
    var a = held ? S.UP_A : -S.DOWN_A;
    st.y += st.vy * dt + 0.5 * a * dt * dt;
    st.vy += a * dt;
    if (st.vy > S.CAP_UP) st.vy = S.CAP_UP;
    var downCap = held ? S.CAP_DOWN_HELD : S.CAP_DOWN;
    if (st.vy < downCap) st.vy = downCap;
    if (st.y < GROUND) { st.y = GROUND; if (st.vy < 0) st.vy = 0; }
    var target = Math.atan2(st.vy, vxOf(st)) * 180 / Math.PI;
    st.rot += (target - st.rot) * Math.min(1, 9 * dt);   // 约 0.11 s 追上
  }

  // 玩家脚下可站立的面（地面或方块顶），考虑容差
  function groundY(st) {
    var best = GROUND, list = nearby(st);
    for (var k = 0; k < list.length; k++) {
      var o = list[k].o;
      if (o.t !== 'block') continue;
      if (st.x < o.x - 0.52 || st.x > o.x + 1.52) continue;
      var top = o.y + 1;
      if (top <= st.y + CONST.LAND_TOL && top > best) best = top;
    }
    return best;
  }

  // held 必须传进来：跳环是"按下才触发"的，少了这个形参严格模式下会抛
  // ReferenceError（实测关卡里只要有 ring，玩家一进其 3 格邻域整个模拟就炸）。
  function collide(st, held) {
    var list = nearby(st), pb = playerBox(st), i, o;

    for (i = 0; i < list.length; i++) {
      o = list[i].o;
      if (o.t === 'spike') {
        if (overlap(pb, boxOf(o))) { die(st); return; }
      } else if (o.t === 'block') {
        if (!overlap(pb, boxOf(o))) continue;
        var top = o.y + 1;
        // 从上方压下来 = 落地；否则是撞墙 = 致死（用缩小框判定，spec §4.2）
        if (st.y >= top - CONST.LAND_TOL && st.vy <= 0) {
          st.y = top; st.vy = 0; st.onGround = true;
        } else {
          var hb = CONST.SOLID_HB / 2;
          var solid = { x0: o.x + 0.5 - hb, x1: o.x + 0.5 + hb, y0: o.y + 0.5 - hb, y1: o.y + 0.5 + hb };
          var core = { x0: st.x - hb, x1: st.x + hb, y0: st.y + 0.5 - hb, y1: st.y + 0.5 + hb };
          if (overlap(core, solid)) { die(st); return; }
        }
      } else if (o.t === 'pad_pink' || o.t === 'pad_yellow') {
        // 一次接触只给一次冲量：vy<=0 才触发。
        // 只按"重叠"判时，弹射之后玩家的脚还留在 0.35 厚的板体里好几帧
        // （实测 y 从 0 涨到 0.347 共 5 帧），每帧都被重置回 21.08，
        // 等于从板体上沿 y≈0.347 起跳，顶点变成 2.279 而不是 spec §4.3 的 1.933（+17.9%）。
        // **这是与 spec §4.3「跳板为接触即触发」的一处语义偏离**：上升中掠过跳板不触发。
        // GD 里跳板是钉在方块底部的实体，玩家踩不到板子下面；本项目的跳板是独立的
        // 0.35 格薄片，"从下面穿过"这种情形得自己定方向。关卡里两处跳板都在地面上，
        // 实测不影响可通性；要不要改成真正的"每次接触一次冲量"，留给 Task 13 人工试玩定夺。
        // 现状由 tests/physics.test.js 的 P1 三条场景断言钉住，spec §13 也有记录。
        if (overlap(pb, { x0: o.x, x1: o.x + 1, y0: o.y, y1: o.y + CONST.HIT.PAD_H }) && st.vy <= 0) {
          st.vy = CONST.PAD[o.t]; st.onGround = false;
        }
      } else if (o.t === 'ring_pink' || o.t === 'ring_yellow') {
        if (st.used[list[i].i]) continue;
        if (held && overlap({ x0: st.x - 0.5, x1: st.x + 0.5, y0: st.y, y1: st.y + 1 },
                            { x0: o.x + CONST.HIT.RING_X0, x1: o.x + CONST.HIT.RING_X1,
                              y0: o.y + CONST.HIT.RING_Y0, y1: o.y + CONST.HIT.RING_Y1 })) {
          st.vy = CONST.RING[o.t]; st.onGround = false; st.used[list[i].i] = true;
        }
      } else if (o.t === 'portal_ship' || o.t === 'portal_cube') {
        if (overlap(pb, { x0: o.x, x1: o.x + CONST.HIT.GATE_W, y0: o.y, y1: o.y + CONST.HIT.GATE_H })) {
          st.mode = o.t === 'portal_ship' ? 'ship' : 'cube';
          if (st.mode === 'cube') { st.onGround = st.y <= GROUND + CONST.LAND_TOL; st.rot = Math.round(st.rot / 90) * 90; }
        }
      } else if (o.t === 'speed_2x' || o.t === 'speed_1x' || o.t === 'speed_3x' || o.t === 'speed_4x') {
        if (overlap(pb, { x0: o.x, x1: o.x + CONST.HIT.GATE_W, y0: o.y, y1: o.y + CONST.HIT.GATE_H })) {
          st.speedKey = { speed_2x: 2, speed_1x: 1, speed_3x: 3, speed_4x: 4 }[o.t];
        }
      }
    }

    if (st.mode === 'cube') {
      var gy = groundY(st);
      if (st.y <= gy && st.vy <= 0) { st.y = gy; st.vy = 0; st.onGround = true; }
      else if (st.y > gy) { st.onGround = false; }
      if (st.y <= GROUND) { st.y = GROUND; }
    }
  }

  // 供测试用：平地起跳的实测。起点在起跳那一步之前，否则滞空与跳距各少算一步 dt。
  function measureJump(speedKey) {
    var st = create({
      segments: [{ from: 0, to: 1e9, mode: 'cube', speed: 1 }],
      objects: [],
      meta: { endBlock: 1e9 }
    });
    st.speedKey = speedKey || 1;
    var x0 = st.x, t0 = st.time, apex = st.y, n = 0;
    step(st, true);            // 触发起跳，这一步要计入滞空与跳距
    while (st.alive && st.y > 0 && n < 2000) {
      step(st, false);
      if (st.y > apex) apex = st.y;
      n++;
    }
    if (n >= 2000) throw new Error('measureJump: 2000 步内未落地，测量被截断');
    return { airtime: st.time - t0, apex: apex, span: st.x - x0 };
  }

  return { CONST: CONST, create: create, step: step, measureJump: measureJump, respawn: respawn };
})();
