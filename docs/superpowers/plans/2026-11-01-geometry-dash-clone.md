# Geometry Dash 同人复刻（Crossbeat）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出一个双击即玩的网页横版节奏跳跃游戏，物理常数对齐 Geometry Dash 2.2，含方块与飞船两种模式和一个 32 秒的原创关卡。

**Architecture:** 六个单向依赖的模块——`level.js`（纯数据）→ `physics.js`（唯一状态持有者，velocity-Verlet 定步长积分，不引用任何浏览器 API）→ `render.js`/`hud.js`（只读快照绘制），`input.js`/`audio.js` 提供外部时钟与输入，`main.js` 装配并暴露测试钩子。

**Tech Stack:** 原生 Canvas 2D + WebAudio + 传统 `<script>`（无 ES module、无构建、无依赖）。测试在真实浏览器中执行，用 Python 起静态服务 + browser-use 驱动。

**Spec:** [docs/superpowers/specs/2026-11-01-geometry-dash-clone-design.md](../specs/2026-11-01-geometry-dash-clone-design.md)

**交接快照（2026-11-08 停手处）**：[../HANDOFF-2026-11-08.md](../HANDOFF-2026-11-08.md) —— 恢复执行的确切步骤、硬规则、已实测事实、延后缺陷清单都在那里。接手的人先读它再读本计划。

---

## 环境事实（不要重复踩）

> **2026-11-08 接手时更新（原机的环境事实已不适用，以本段为准）**
>
> - 仓库路径已从 `C:/Users/user/Documents/Qoder/2026-11-01/4498b9c7` 迁到 `C:/Users/user/Documents/My Games/drgame`（含空格，命令行里记得加引号）。本计划里所有命令路径都已同步。
> - **本机现在有 Node 24.14.0**（原机没有）。仓库**仍然保持零依赖**：不要 `npm install`、不要加 `package.json`、不要写 `npm test`。Node 只用来跑一个**仓库外**的只读快速回路，**权威判定仍是真实浏览器**。
> - **Chrome 在 DSH 的文件沙箱里起不来**：crashpad/Mojo 的命名管道被拦（`OpenProcess: 存取被拒` 后自杀）。跑浏览器测试需要 `danger-full-access`。每次用**全新 `user-data-dir`** 起 headless Chrome，缓存天然为空，因此下文「测试执行流程」里 `?v=` / `ignoreCache` 那套在本机不必再操心。
> - Git 身份走全局 git config，提交命令里**不再**带 `-c user.name=... -c user.email=...`。
> - 远端 `origin` 的凭据对本仓库**无写权限**（403）。当前阶段只在本地开发与提交，推送先不做。
>
> 原机（Qoder 那台）的环境事实，保留在此以备对照：

- **原机无 Node**：`node` 不在 PATH，`C:\Program Files\nodejs` 不存在，Qoder 安装目录内无 `node.exe`。任何 `node xxx` 命令都会失败。
- **`mcp__node-repl__node_repl` 不是 Node**：实测无 `require`、无 `process`、无文件系统。只适合算数，不能跑测试。
- **可用**：Python 3.11/3.14、Chrome、Edge、browser-use MCP（`navigate_page` / `evaluate_script` / `take_screenshot`）。
- 所有测试通过 `tests/harness.html` 在浏览器里跑，结果读回 `window.__RESULTS__`。

## 关键实现决策：为什么必须用 velocity-Verlet

三种积分在 dt=1/240、v0=22.36、g=115 下的**实测**顶点（浏览器里跑出来的，不是推算的）：

| 积分 | 顶点 | 对 2.17 的偏差 | T1 的 2% 相对容差 |
|---|---|---|---|
| velocity-Verlet `y += vy*dt - 0.5*g*dt*dt; vy -= g*dt` | 2.173668 | +0.17% | 绿 |
| 半隐式欧拉·先减速度 `vy -= g*dt; y += vy*dt` | 2.127420 | 1.96% | **也是绿** ← 计划原稿以为会红 |
| 半隐式欧拉·先加位置 `y += vy*dt; vy -= g*dt` | 2.220587 | 2.33% | 红，但只红线 0.33% |

Verlet 对恒定加速度**解析精确**：解析顶点 v0²/(2g) = 2.173781，实测差 0.00011 格（0.005%）；两种欧拉各差约 0.046 格。滞空与跳距同理（Verlet 实测 滞空 0.3917 s、@1x 跳距 4.0679 格，对 0.389 / 4.04 各偏 +0.69% / +0.69%，全在 2% 内；早先记录的 0.3875 / 4.0246 是 `measureJump` 把测量起点取在起跳步之后、滞空与跳距各少算一步 dt 的产物，已按自查记录 11 修正）。

**由此得出两条必须执行的结论：**

1. **不要"顺手简化"成半隐式欧拉**——手感会变，且关卡是按解析轨迹设计的。
2. **光靠 2% 相对容差拦不住它**：容差下限 2.17 × 0.98 = 2.1266，欧拉·先减速度落在 2.1274，以 0.0008 格溜过去。所以 T1 额外钉了一条绝对精度的"积分器指纹"断言（期望值由 `CONST` 现算的 `v0²/(2g)`：`near(m.apex, JUMP_V0*JUMP_V0/(2*G), 0.002)`，见自查记录 11——不写死数字，免得合法的常数重调误报），见 Task 2 Step 1。回归时不要把它当冗余额外检查删掉。

---

## 文件结构

| 文件 | 职责 | 依赖 |
|---|---|---|
| `level.js` | `GD_Level.crossbeat` 纯数据 + `GD_Level.validate()` | 无 |
| `physics.js` | `GD_Physics`：状态创建、单步推进、判定、模式切换 | 无（level 由参数注入） |
| `render.js` | `GD_Render`：视差背景、物体、图标、粒子 | 无（读快照） |
| `hud.js` | `GD_Hud`：FPS、Attempt、进度条、死亡提示 | 无 |
| `input.js` | `GD_Input`：空格/指针/触摸 → 布尔 `held` | 无 |
| `audio.js` | `GD_Audio`：154 BPM WebAudio 合成循环 | 无 |
| `main.js` | 装配 + rAF 定步长循环 + `window.__GD_TEST__` | 上述全部 |
| `index.html` | 游玩入口，`<script src>` 依次加载 | — |
| `tests/assert.js` | `GD_ASSERT`：测试注册、`approx`/`ok`、结果汇总 | 无 |
| `tests/harness.html` | 测试页，加载被测脚本并跑 `GD_ASSERT.run()` | — |
| `tests/physics.test.js` | T1 T2 T4 T5 T6 | GD_Physics, GD_ASSERT |
| `tests/replay.test.js` | T3 通关机器人 | GD_Physics, GD_Level, GD_ASSERT |
| `tests/replay.js` | 按键序列 fixture | 无 |

> 注：spec §14 写的是"6 个 js"，实际是 7 个——`main.js`（装配与定步长循环）在 spec 的模块图里存在但没进文件清单。这是清单遗漏，不是范围扩大。

**每个文件的提交节奏**：写完一个任务就提交一次。不要攒。

---

## 测试执行流程（每个任务都用它）

**Step A — 起静态服务**（只需一次，跨任务复用；后台运行）

```bash
cd "C:/Users/user/Documents/My Games/drgame" && python -m http.server 8765 --bind 127.0.0.1
```

用 Bash 工具的 `run_in_background: true`。预期：进程存活，无输出即正常。

跨会话时这个后台进程会没（实测重开会话后 `navigate_page` 直接报 `ERR_CONNECTION_REFUSED`）：看到连接被拒就重跑 Step A，不要以为是用例挂了。

**Step B — 打开测试页**

MCP 调用 `mcp__browser-use__navigate_page`，`url = http://127.0.0.1:8765/tests/harness.html`。

**每次都要加一个全新的查询串**（`?v=task3`、`?v=task4`……）。`python -m http.server` 会回 304，浏览器命中缓存时读到的是**上一版的 `harness.html`**，实测过一次：门禁数字没更新，凭空多出一条 `FAIL 用例注册数`，看着像实现的 bug 其实是缓存。改完文件再跑，若 `registered` 或 `loadErrors` 和磁盘上的内容不一致，先怀疑缓存，别怀疑代码。

**查询串只管到 `harness.html` 自己，管不到它 `<script src>` 进去的子资源。**改过 `physics.js`/`level.js`/`*.test.js` 之后，光换 `?v=` 仍会拿到上一版物理：实测把 `stepCube` 的台沿吸附改成自由落体后，换新 `?v=` 的页面里走下台沿依旧是一步 `1→0`，`ignoreCache: true` 重新加载才见新行为。所以**本轮改动涉及子资源时，必须用 `navigate_page {type: "reload", ignoreCache: true}`**（或给子资源也带上查询串），否则测的是旧代码，红绿都不可信。

**Step C — 读回结果**

MCP 调用 `mcp__browser-use__evaluate_script`，脚本：

```js
() => ({ ready: window.__READY__ === true, r: window.__RESULTS__ })
```

预期 `ready: true`、`r.fail` 为 `0`、`r.registered` 等于该任务 Step 4 声明的用例总数、`r.runErrors` 为 `[]`。`r.loadErrors` 里应当**只有**该任务尚未创建的那几个文件的 404；出现任何不在预期名单里的条目，或 `runErrors` 非空，都说明有用例文件在加载期抛了异常，必须查清再继续——不要把它当噪音放过。

若 `ready` 为 false，说明有脚本抛异常——用 `list_console_messages` 取错误。

---

## Task 1: 测试脚手架

**Files:**
- Create: `tests/assert.js`
- Create: `tests/harness.html`
- Create: `tests/smoke.test.js`

- [ ] **Step 1: 写断言收集器**

`tests/assert.js`：

```js
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
```

三处设计说明，后面每个任务都依赖它们：

- `expect_tests(N)` 是**注册数门禁**。用例文件在注册期抛异常时，其后的 `GD_ASSERT.test()` 全部丢失，但已注册的照常通过、`fail` 仍是 0——即"假绿"。门禁把"应有 N 条、实得 M 条"变成机器可判定的 FAIL。变量刻意叫 `EXPECTED_COUNT` 而非 `expected`：`approx` 的形参已经叫 `expected`（期望**值**），同名会是个读错的坑。
- `approx` 的零期望守卫。`Math.abs(actual - 0)` 做分母，`approx(0, 0, tol)` 会静默通过、`approx(5, 0, tol)` 会抛出"偏差 Infinity%"这种无意义信息。期望为 0 的断言必须用 `near()`（绝对误差），这里让它大声失败。
- `String(e && e.message || e)`：`throw 'oops'` 这类非 Error 抛出的 `e.message` 是 `undefined`，日志会变成无法归因的 `FAIL xxx — undefined`。

- [ ] **Step 2: 写测试页**

`tests/harness.html`：

```html
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"><title>GD tests</title>
<script>
  // 必须挂在 <head>：下面 7 个 <script src> 是 parser-blocking 的，
  // 尚未创建的那几个的 404 error 事件在解析到文档末尾的内联脚本之前就已发完，
  // 监听器挂晚了就永远抓不到（实测 loadErrors 恒为 []）。
  window.addEventListener('error', function (e) {
    // 两类 error 事件长得一样但意思完全相反，必须分桶：
    //   资源 404 → e.target.src 有值，e.message 是 undefined
    //   运行时未捕获异常 → e.message 有值，e.target 不是元素
    // 混在一个数组里就没法断言"只发生了预期的那些 404"。
    if (e.target && e.target.src) {
      (window.__LOAD_ERRORS__ || (window.__LOAD_ERRORS__ = [])).push(e.target.src);
    } else {
      (window.__RUN_ERRORS__ || (window.__RUN_ERRORS__ = [])).push(String(e.message || e));
    }
  }, true);
</script>
</head>
<body style="font:12px monospace;background:#111;color:#ddd;margin:0;padding:12px">
<pre id="out">running...</pre>
<script src="assert.js"></script>
<script src="../level.js"></script>
<script src="../physics.js"></script>
<script src="smoke.test.js"></script>
<script src="physics.test.js"></script>
<script src="replay.js"></script>
<script src="replay.test.js"></script>
<script>
  // 每加一个任务就把这个数字改成"到本任务为止应有的用例总数"（计划里每个任务的
  // Step 4 都写了预期 pass 数）。数字对不上 = 有用例文件抛异常或没注册上。
  GD_ASSERT.expect_tests(2);
  var res = GD_ASSERT.run();
  res.loadErrors = window.__LOAD_ERRORS__ || [];
  res.runErrors = window.__RUN_ERRORS__ || [];
  document.getElementById('out').textContent = JSON.stringify(res, null, 1);
</script>
</body>
</html>
```

注意：`level.js`、`physics.js`、`physics.test.js`、`replay.js`、`replay.test.js` 在本任务还不存在，浏览器会报 404。传统 `<script src>` 404 不会中断后续脚本执行，所以本任务能先跑通。

- [ ] **Step 3: 写一个必然通过的冒烟测试**

`tests/smoke.test.js`：

```js
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
```

- [ ] **Step 4: 起服务并跑测试**

按上面「测试执行流程」Step A/B/C。

预期返回：

```json
{ "ready": true, "r": { "pass": 2, "fail": 0, "registered": 2, "log": ["PASS S1 脚手架可用", "PASS S2 断言失败能被捕获"], "loadErrors": ["http://127.0.0.1:8765/level.js", "http://127.0.0.1:8765/physics.js", "http://127.0.0.1:8765/tests/physics.test.js", "http://127.0.0.1:8765/tests/replay.js", "http://127.0.0.1:8765/tests/replay.test.js"], "runErrors": [] } }
```

`loadErrors` 里会有 5 条 404（level.js / physics.js / physics.test.js / replay.js / replay.test.js），**这是本任务的预期状态**，从 Task 2 起逐条减少。若 `loadErrors` 是空数组，说明 `<head>` 里的监听器又挂晚了或被移走——这是个静默失效的坑，必须修好再继续。

`registered` 必须等于 `expect_tests` 声明的 2，`runErrors` 必须为 `[]`。这两个门禁是本任务的全部硬价值：`pass: 2, fail: 0` 单独看毫无意义，因为用例文件在注册期抛异常时其后的 `test()` 全部丢失、`fail` 依然是 0。任何"只少了几个用例、其余全绿"的情况都会在这里变成 `fail: 1` + `FAIL 用例注册数` 日志。

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git add tests && git commit -m "test: 浏览器内测试脚手架

本机无 Node，测试改为静态服务 + browser-use 驱动 harness.html。"
```

---

## Task 2: 物理核心与跳跃常数（T1）

**Files:**
- Create: `physics.js`
- Create: `tests/physics.test.js`
- Modify: `tests/harness.html`（`expect_tests` 改成 3）

- [ ] **Step 1: 写失败的测试 T1**

`tests/physics.test.js`：

```js
GD_ASSERT.test('T1 方块跳跃常数', function () {
  var m = GD_Physics.measureJump(1);
  GD_ASSERT.approx(m.airtime, 0.389, 0.02, '滞空秒');
  GD_ASSERT.approx(m.apex, 2.17, 0.02, '顶点格');
  GD_ASSERT.approx(m.span, 4.04, 0.02, '@1x 跳距格');
  // 积分器指纹：上面三条的 2% 相对容差**拦不住**半隐式欧拉。
  // 实测（dt=1/240, v0=22.36, g=115）三种积分的顶点：
  //   velocity-Verlet    2.173668  （对 2.17 偏差 0.17%，对解析值 v0²/(2g)（由 CONST 现算）偏差 0.005%）
  //   欧拉·先减速度     2.127420  （对 2.17 偏差 1.96% → 落在 2% 容差内，会被放过）
  //   欧拉·先加位置     2.220587  （偏差 2.33%，只是勉强红）
  // 容差下限 2.17×0.98 = 2.1266，欧拉·先减速度 距它只差 0.0008 格。
  // 所以必须再钉一条绝对精度：Verlet 距解析顶点 0.00011，两种欧拉各差约 0.046，
  // 0.002 的绝对容差把两者都关在外面，且不会因浮点噪声误红。
  GD_ASSERT.near(m.apex,
    GD_Physics.CONST.JUMP_V0 * GD_Physics.CONST.JUMP_V0 / (2 * GD_Physics.CONST.G),
    0.002, 'Verlet 积分指纹');
});
```

同一步里把 `tests/harness.html` 的 `GD_ASSERT.expect_tests(2)` 改成 `expect_tests(3)`。
**每个新增用例的任务都要做这件事**——门禁的数字不跟着涨，就会在本任务立刻报 `FAIL 用例注册数`。

- [ ] **Step 2: 跑测试确认失败**

预期：`ready: true`，`pass: 2, fail: 1, registered: 3`，`runErrors: []`，log 含 `FAIL T1 方块跳跃常数 — GD_Physics is not defined`。

注意 `runErrors` 此时**仍是** `[]`：`GD_Physics is not defined` 是在 `run()` 的 `try/catch` 里被吃掉的用例内异常，不是未捕获的全局异常，所以不会进 `__RUN_ERRORS__`。`__RUN_ERRORS__` 只收加载期（脚本顶层）抛出的异常。

- [ ] **Step 3: 写 physics.js**

`physics.js`：

```js
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
      // 传送门/速度门的触发框从门的底边（o.y）往上延伸 **GATE_H** 格——通高，不按门型特判。
      // 高度是**自调参项**（原版是否通高没有可核实的依据，见 spec §13），按可推导的上界取值：
      // 飞船爬升被 CONST.SHIP.CAP_UP 钳在 16 格/s；玩家在切船门 x=111.5 时还贴着地面（y≈0），
      // 到回方块门 x=252.5 最多有 (252.5−111.5)/10.386 = 13.6 s（按最慢的 1x 算）
      // → 最多爬 217 格。256 盖得住（余量约 39 格）；24 盖不住——
      // 实测从 x=111.5 起按住不放，x=252.4 时 y=177.83，两扇门（框 [0.5,24.5]）都够不着，
      // 玩家以飞船 2x 直接飞过整个收尾段通关。
      // 注意这仍然只是**上界**：关卡的飞船段没有封顶，玩家理论上还能飞到 y≥256.5 错过门，
      // 那个洞记在 spec §13（要靠关卡封顶解决，不是靠门框）。
      // 框的底边仍是门的 y：地面上的玩家（框 [0,1]）能吃到 y=0.5 的门
      // （框 [0.5,256.5]，1 > 0.5 成立）；不要把底边也改成 0——
      // 那会让悬在半空的门被地面上的玩家触发，语义就错了。
      GATE_W: 1.4, GATE_H: 256
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
    var list = nearby(st), pb, i, o;

    for (i = 0; i < list.length; i++) {
      // 玩家框每轮重算：循环里会改 st.y（落到方块顶时 st.y = top），
      // 沿用进循环前算的那一个框会让同一帧里出现两套玩家框——
      // 尖刺/跳板/传送门拿旧框判，而跳环分支又现算了一个新框，
      // 于是"落地"和"撞墙"可能落在不同的框上。
      pb = playerBox(st);
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
        if (held && overlap(pb,
                            { x0: o.x + CONST.HIT.RING_X0, x1: o.x + CONST.HIT.RING_X1,
                              y0: o.y + CONST.HIT.RING_Y0, y1: o.y + CONST.HIT.RING_Y1 })) {
          st.vy = CONST.RING[o.t]; st.onGround = false; st.used[list[i].i] = true;
        }
      } else if (o.t === 'portal_ship' || o.t === 'portal_cube') {
        if (overlap(pb, { x0: o.x, x1: o.x + CONST.HIT.GATE_W, y0: o.y, y1: o.y + CONST.HIT.GATE_H })) {
          st.mode = o.t === 'portal_ship' ? 'ship' : 'cube';
          if (st.mode === 'cube') {
            st.onGround = st.y <= GROUND + CONST.LAND_TOL;
            // 判为站在地面上时必须同时清零 vy："在地面 ⇒ vy == 0"是不变式，
            // 飞船残余的 vy 带进方块模式会让方块多飞一下（handoff 缺陷清单第 1 条）。
            // 在地面之外（onGround 为假）**保留** vy：切换只换操作方式，不该凭空吃掉
            // 玩家上升的动量（动量连续性）。空中保留并不消除"多飞一下"——
            // 那是方块模式本来就有的跳跃弧线，留 Task 13 手感校准。
            if (st.onGround) st.vy = 0;
            st.rot = Math.round(st.rot / 90) * 90;
          }
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
```

- [ ] **Step 4: 跑测试确认通过**

预期：`pass: 3, fail: 0, registered: 3, runErrors: []`（S1、S2、T1）。`loadErrors` 只剩 level.js / replay.js / replay.test.js 三条 404。

**如果 T1 红了**：先看偏差方向和大小。顶点偏低约 2.3% → 说明积分被改回了半隐式欧拉；顶点偏差但滞空正常 → 说明 `G` 或 `JUMP_V0` 被改动。不要靠放宽容差解决。

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git add physics.js tests && git commit -m "feat: 方块物理与跳跃常数

velocity-Verlet 积分，恒定加速度下解析精确（顶点距解析值 0.005%）。
T1 除三条 2% 相对容差外，另钉一条绝对精度的积分器指纹断言——实测
半隐式欧拉·先减速度只差 0.0008 格就能骗过 2% 容差，光靠相对误差不设防。"
```

---

## Task 3: 水平速度表（T2）

**Files:**
- Modify: `tests/physics.test.js`（追加）
- Modify: `tests/harness.html`（`expect_tests` 改成 5）

- [ ] **Step 1: 写失败的测试**

追加到 `tests/physics.test.js`：

```js
GD_ASSERT.test('T2 五档门速与速度门切换', function () {
  var want = { 0.5: 8.372, 1: 10.386, 2: 12.914, 3: 15.600, 4: 19.200 };
  // 五档全收集完再断言：run() 一条用例只在第一个抛出处中止，
  // 逐档直接 assert 的话一次只能看到一档坏了，其余三档要等修完再跑才暴露。
  var bad = [];
  for (var k in want) {
    if (!Object.prototype.hasOwnProperty.call(want, k)) continue;
    // 关卡必须带非空 segments：Task 2 修掉 respawn 的静默回退之后，
    // 缺 segments 的关卡在死亡重开时会抛错，而不是悄悄变成 cube 1x。
    var st = GD_Physics.create({
      segments: [{ from: 0, to: 1e9, mode: 'cube', speed: 1 }],
      objects: [],
      meta: { endBlock: 1e9 }
    });
    st.speedKey = parseFloat(k);
    for (var i = 0; i < 240; i++) GD_Physics.step(st, false);
    var err = Math.abs(st.x - want[k]) / want[k];
    if (err > 0.02) {
      bad.push(k + 'x 期望 ' + want[k] + ' 实得 ' + st.x + '（偏 ' + (err * 100).toFixed(2) + '%）');
    }
  }
  GD_ASSERT.ok(bad.length === 0, '门速表: ' + bad.join(' | '));

  // 上面是直接写 st.speedKey，绕过了 collide 里的 speed_* 分支——那个分支此前零覆盖。
  // 必须补：vxOf 的 `|| SPEEDS[1]` 回退会把认不出的速度门静默当成 1x，
  // 实测写错一个键名（speed_05x）后 st.x 精确等于 1x 那一行的 10.386，测试照样绿。
  var pst = GD_Physics.create({
    segments: [{ from: 0, to: 1e9, mode: 'cube', speed: 1 }],
    objects: [{ x: 5, y: 0, t: 'speed_2x' }],
    meta: { endBlock: 1e9 }
  });
  for (var j = 0; j < 240; j++) GD_Physics.step(pst, false);   // 前 5 格走 1x，之后过门
  GD_ASSERT.ok(pst.speedKey === 2, '过 speed_2x 门后 speedKey 应为 2，实得 ' + pst.speedKey);
  var xBefore = pst.x;
  for (var m = 0; m < 240; m++) GD_Physics.step(pst, false);
  GD_ASSERT.approx(pst.x - xBefore, 12.914, 0.02, '过门后 1 秒水平位移');
});

GD_ASSERT.test('T2b 2x 门的真实倍率是 1.243 而非 2', function () {
  var m1 = GD_Physics.measureJump(1), m2 = GD_Physics.measureJump(2);
  GD_ASSERT.approx(m2.span / m1.span, 1.243, 0.03, '跳距倍率');
  // 滞空与水平速度**完全无关**：竖直轨迹只有 v0 和 g，落地步数一模一样。
  // spec §4.1 说原版 0.389 → 0.398 微变，那是原版按帧子步的产物；我们的定步长
  // 实现是解析相等，所以这里钉成精确相等，不要写成 1.023 那种"看着像"的比值。
  GD_ASSERT.near(m2.airtime, m1.airtime, 1e-9, '滞空不随速度变');
});
```

- [ ] **Step 2: 跑测试**

先把 `tests/harness.html` 的 `GD_ASSERT.expect_tests(3)` 改成 `expect_tests(5)`（本任务新增 T2、T2b 两条）。

预期：**直接通过**，`pass: 5, fail: 0, registered: 5, runErrors: []`（`SPEEDS` 表在 Task 2 已写入）。这一步的意义是把"门上的数字是名义标签不是真实倍率"这个反直觉事实钉进回归测试——将来谁把它改成 `speed * multiplier` 就会红。

若 `T2b` 的 `跳距倍率` 红：说明 `SPEEDS` 被改成了线性倍率（2x 真变成 2 倍）。对照 spec §4.1 表格恢复。
若 `滞空不随速度变` 红：说明竖直积分被接到了水平速度上（原版和我们的实现都不该这样），同样是回看 `stepCube` 而不是放宽容差。

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git add tests && git commit -m "test: 速度表回归，锁定 2x 门实为 1.243 倍"
```

---

## Task 4: 判定、尖刺与死亡重开（T5）

**Files:**
- Modify: `tests/physics.test.js`（追加）
- Modify: `tests/harness.html`（`expect_tests` 改成 8）
- Modify: `physics.js`（两处判定：死亡重开的整步取整、走下台沿改自由落体）

- [ ] **Step 1: 写失败的测试**

追加到 `tests/physics.test.js`（本任务新增 T5a/T5b/T5c 三条；Step 3 是**替换** T5b 不是再加一条，所以总数停在 8）：

```js
// 本任务三条用例都要重开（T5a 直接撞死，T5b/T5c 也可能死），
// 所以关卡必须带非空 segments：Task 2 已把 respawn 的静默回退拆掉，
// 缺 segments 会在重开时抛 TypeError，而不是悄悄退回 cube 1x。
var LV = function (objs) {
  return {
    segments: [{ from: 0, to: 1000, mode: 'cube', speed: 1 }],
    objects: objs,
    meta: { endBlock: 1000 }
  };
};

GD_ASSERT.test('T5a 撞尖刺死亡并从 0% 重开', function () {
  var st = GD_Physics.create(LV([{ x: 8, y: 0, t: 'spike' }]));
  var steps = 0;
  while (st.alive && steps < 240 * 5) { GD_Physics.step(st, false); steps++; }
  var deathX = st.x;
  GD_ASSERT.ok(!st.alive, '应已死亡，跑到第 ' + steps + ' 步 x=' + deathX + ' 仍活着');
  // 只断言 !alive 的话任何一次误判早死都能绿灯，所以把死亡瞬间的 x 钉住：实测 7.7462，
  // 即玩家前沿 x1=st.x+0.5 首次进入致死框 x∈[8.225, 8.775]（SPIKE_HB 0.55）那一步。
  GD_ASSERT.near(deathX, 7.75, 0.15, '尖刺致死点 x（实测 7.7462，第 ' + steps + ' 步）');
  // 反证：同一关卡把刺拆掉，同样步数还活着——证明这次死亡来自这根刺而不是别的判定。
  var ctl = GD_Physics.create(LV([]));
  for (var c = 0; c < steps; c++) GD_Physics.step(ctl, false);
  GD_ASSERT.ok(ctl.alive, '去掉尖刺后第 ' + steps + ' 步应仍活着，实得 x=' + ctl.x);
  // 等待步数由常数导出：写死 240 只在 DEATH_DELAY=1.0 时成立，改成 0.5 就 120 步重开，
  // 剩下 120 步是活跑（x 白走 5.19 格），正确的实现反而被跑红。
  var wait = Math.round(GD_Physics.CONST.DEATH_DELAY / GD_Physics.CONST.DT);
  for (var i = 0; i < wait; i++) GD_Physics.step(st, false);
  GD_ASSERT.ok(st.alive, 'DEATH_DELAY（' + wait + ' 步）后应自动重开');
  GD_ASSERT.near(st.x, 0, 0.05, '重开位置');
  // percent/time 不由 x 推出来，respawn 漏清就是"从死点继续"，x=0 也照样绿灯
  GD_ASSERT.ok(st.percent === 0, '重开后 percent 应为 0，实为 ' + st.percent);
  GD_ASSERT.ok(st.time === 0, '重开后 time 应为 0，实为 ' + st.time);
  GD_ASSERT.ok(st.attempt === 2, 'attempt 应为 2，实为 ' + st.attempt);
});

GD_ASSERT.test('T5b 跳过 2 格墙，撞 3 格墙死亡', function () {
  function trial(wallH) {
    var objs = [];
    for (var i = 0; i < wallH; i++) objs.push({ x: 6, y: i, t: 'block' });
    var st = GD_Physics.create(LV(objs));
    // 在墙前约一跳之远起跳：跳距 4.07 格，从 x≈2 起跳正好落在 x=6 的墙顶
    for (var s = 0; s < 240 * 2; s++) GD_Physics.step(st, st.x < 2.0 && !st.jumped ? (st.jumped = true, true) : false);
    return st.alive;
  }
  GD_ASSERT.ok(trial(2) === true, '2 格墙应能跳过');
  GD_ASSERT.ok(trial(3) === false, '3 格墙应撞死');
});

GD_ASSERT.test('T5c 无 coyote time，长按落地自动连跳', function () {
  var st = GD_Physics.create(LV([]));
  GD_Physics.step(st, true);
  var minY = 99, bounced = 0, prevGround = true;
  for (var i = 0; i < 240 * 3; i++) {
    GD_Physics.step(st, true);
    if (st.onGround && !prevGround) bounced++;
    prevGround = st.onGround;
    if (st.y < minY) minY = st.y;
  }
  GD_ASSERT.near(minY, 0, 0.001, '不应穿地');
  // 实测 7 次；6 是给合法常数微调留的余量，原来的 2 低到"只弹两次也算连跳"
  GD_ASSERT.ok(bounced >= 6, '长按应自动连跳，实际连跳 ' + bounced + ' 次');

  // coyote 探针必须走台沿：平地长按那个循环永远不离开地面，多长的宽限期都勾不出来。
  // 台沿此前也勾不出来——旧 stepCube 在失去支撑那一步把 y 从台面直接吸附到 0，全程
  // onGround 为真（实测 x=5.5246 一步 1→0，两格台是 2→0），现在放成自由落体才验得了。
  // 对照组实测：给 12 步（0.05 s）宽限期则 vy 回升 12 次、顶点回到 21.88，用例能跑红。
  var objs = [];
  for (var b = 1; b <= 4; b++) objs.push({ x: b, y: 0, t: 'block' });
  var cs = GD_Physics.create(LV(objs));
  cs.x = 1.5; cs.y = 1; cs.onGround = true;          // 站在台面（顶 y=1）上
  var kk = 0;
  while (cs.onGround && kk < 300) { GD_Physics.step(cs, false); kk++; }
  GD_ASSERT.ok(!cs.onGround, '走下台沿应进入自由落体，实测 ' + kk + ' 步后 y=' + cs.y);
  GD_ASSERT.near(cs.y, 0.999, 0.01, '失去地面那步仍在台面上方（实测 0.999；旧吸附写法这里是 0）');
  GD_ASSERT.near(cs.vy, -0.479, 0.01, '落体从静止起步，一步重力的增量（实测 -0.479）');
  var reJump = 0, prevVy = cs.vy;
  for (var h = 0; h < 12; h++) {                     // 离地后 0.05 s 宽限期窗口
    GD_Physics.step(cs, true);
    if (cs.vy >= prevVy) reJump++;                   // 有宽限期就会在这里把 vy 重置回 JUMP_V0
    prevVy = cs.vy;
  }
  GD_ASSERT.ok(!cs.onGround, '宽限期窗口内应仍在下落，实得 y=' + cs.y + ' 第 ' + kk + ' 步离地');
  GD_ASSERT.ok(reJump === 0, '离地后长按 0.05 s 不该补到起跳，vy 回升 ' + reJump + ' 次');
  // 浮空冻结（onGround 假但 vy 不再积分）能同时躲过上面两条，所以把落地也钉住。
  // 期望步数由解析式现算、不从实测反推：台面顶 y=1，静止落下 1 格要 √(2·1/g)，
  // 离地那步 + 宽限期 12 步已用掉 13 步，实测余 19 步、总滞空 32 步。
  var analytic = Math.round(Math.sqrt(2 * 1 / GD_Physics.CONST.G) / GD_Physics.CONST.DT);
  var fall = 0;
  while (!cs.onGround && fall < 60) { GD_Physics.step(cs, false); fall++; }
  GD_ASSERT.ok(cs.onGround, '松手后应落回地面，窗口后再走 ' + fall + ' 步仍 y=' + cs.y);
  GD_ASSERT.near(1 + 12 + fall, analytic, 2, '离地到落地的总滞空步数（解析 ' + analytic + '，实测 32）');
  // 上升段不另开探针：长按连跳那个循环已经在钉 bounced，空中若多发一次起跳计数就会翻。
});
```

- [ ] **Step 2: 跑测试确认失败或通过**

预期 **T5a 和 T5b 都会红**，各暴露一个真问题，都不是"测试写错了"：

- `T5a` 红在"DEATH_DELAY 后应自动重开"：`DEATH_DELAY = 1.0` 恰好等于 240 个 `1/240`，但 1/240 二进制除不尽，连减 240 次还剩 **+2.3e-15**，`deadTimer <= 0` 永远差一步，重开稳定发生在第 241 步。修法是 `physics.js` 的死亡分支改成按"离整步最近"判定（`<= CONST.DT * 0.5`），Task 2 Step 3 的代码块已同步；不要让测试多等一步来回避——那会把"重开晚 0.5 秒"这类真回归也一并放宽。测试侧则把等待步数写成 `round(DEATH_DELAY / DT)`（当前 = 240），别写死字面量：实测把 `DEATH_DELAY` 改成 0.5 时 120 步就重开，剩下 120 步是活跑、x 白走 5.19 格，`near(st.x, 0, 0.05)` 会把正确的实现跑红。另外钉住死亡瞬间的 x（实测 7.7462 = 玩家前沿 `st.x+0.5` 首次进入致死框 `x∈[8.225, 8.775]` 的那一步）和重开后的 `percent === 0 / time === 0`，只断言 `!alive` 时任何误判早死都能绿灯。
- `T5b` 红在"2 格墙应能跳过"：`6 - span ≈ 1.93` 起跳会让人**落在墙上**而不是跳过墙——下落途中 `LAND_TOL` 先把第 1 格的顶当成可站面把人吸进去，随即被缩小框判死。Step 3 给出实测可通过的起跳阈值区间 `x∈[2.5, 5.45]`（阈值从 1.00 扫到 5.95、步长 0.05，连续无空洞），`6 - span/2 ≈ 3.966` 正落在区间中点；阈值不等于触发起跳的 x，实测触发于 `x=3.9813`，差一个步长量化。

`T5c` 的长按部分应直接通过（自动连跳在 Task 2 就实现了），实测 `bounced: 7, minY: 0`，下限因此收到 `>= 6`。它的 coyote 部分**第一次跑会红**，红的原因是 `physics.js` 而不是测试：站在 y=1 台面（block `y=0`、x=1..4）无输入走到 `x=5.5246` 那一步，`stepCube` 把 y 一步吸附到 0、`onGround` 始终为真，空中态 0 步（两格台同样一步吸到底）。"走下台阶不掉落"既不符合原版手感，也让"无 coyote time"根本没有可验的空中态。修法是支撑面掉到脚下以下时置 `onGround = false`、交给下面的重力积分做自由落体（Task 2 Step 3 代码块已同步），实测失去地面那步 `y=0.999, vy=-0.479`，一格台 31 步、两格台 44 步后落地。负控：离地后 12 步内外部把 `vy` 重置回 `JUMP_V0`（等价于 `stepCube` 多一条宽限期分支）实测 `reJump: 12`、窗口内 `maxVy: 21.88`，断言立刻红；干净跑 `reJump: 0`、`maxVy: -0.958`。

- [ ] **Step 3: 修起跳时机，并把"跳过/撞死"钉成可证伪的断言**

```js
GD_ASSERT.test('T5b 跳过 2 格墙，撞 3 格墙死亡', function () {
  var span = GD_Physics.measureJump(1).span;      // 用实测跳距，不硬编码
  // 起跳点取"距墙半跳"而不是"距墙一整跳"。一整跳起跳会让人**落在墙上**而不是跳过墙：
  // 实测 6-span≈1.93 起跳时，下落途中 x=5.50 处 LAND_TOL 先把第 1 格的顶（y=1）
  // 当成可站面，把玩家吸到 y=1，等于钻进第 2 格内部，随后被缩小框判死。
  // 半跳起跳让顶点正好在墙前沿（顶点 2.17 > 墙高 2）。把起跳阈值从 1.00 扫到 5.95
  // （步长 0.05）实测可通过区间连续无空洞 x∈[2.5, 5.45]，6-span/2≈3.966 落在正中（中点 3.975）；
  // 阈值不是触发起跳的 x——起跳发生在第一个 x≥阈值的模拟步，实测 x=3.9813，差一个步长量化。
  var takeoffX = 6 - span / 2;
  function trial(wallH) {
    var objs = [];
    for (var i = 0; i < wallH; i++) objs.push({ x: 6, y: i, t: 'block' });
    var st = GD_Physics.create(LV(objs));
    var jumped = false;
    for (var s = 0; s < 240 * 2 && st.alive; s++) {
      var want = !jumped && st.x >= takeoffX && st.onGround;
      if (want) jumped = true;
      GD_Physics.step(st, want);
    }
    return { alive: st.alive, x: st.x, y: st.y };
  }
  var over = trial(2);
  GD_ASSERT.ok(over.alive, '2 格墙应能跳过');
  // 活着不等于翻过了墙：480 步内实测跑到 x=20.77，必须确已越过 x=6 的墙柱才算跳过
  GD_ASSERT.ok(over.x > 8, '2 格墙应跳过后跑到墙后，实得 x=' + over.x + '（实测 20.77）');
  var hit = trial(3);
  GD_ASSERT.ok(!hit.alive, '3 格墙应撞死');
  // 且要死在墙柱里：实测 x=6.2316、y=2.1454（顶到第 3 格的侧面），死在别处就是判定的锅
  GD_ASSERT.ok(hit.x > 6 && hit.x < 7,
    '3 格墙应死在 x∈(6,7) 的墙柱内，实得 x=' + hit.x + ' y=' + hit.y + '（实测 6.2316 / 2.1454）');
});
```

（Step 1 定义的文件内共享 `LV()` 帮助函数继续用；本步是**替换**整条 T5b，不是再加一条，所以注册数停在 8。）

- [ ] **Step 4: 跑测试确认通过**

预期：`pass: 8, fail: 0, registered: 8, runErrors: []`（S1 S2 T1 T2 T2b T5a T5b T5c）。

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git add tests && git commit -m "test: 尖刺致死、墙体判定与死亡重开回归"
```

---

## Task 5: 关卡数据 Crossbeat

**Files:**
- Create: `level.js`
- Modify: `tests/physics.test.js`（追加校验测试）
- Modify: `tests/harness.html`（`expect_tests` 改成 11）

- [ ] **Step 1: 写校验测试**

追加到 `tests/physics.test.js`（并把 `expect_tests` 改为 11，本任务新增 L1/L2/L3 三条）：

```js
GD_ASSERT.test('L1 关卡数据自洽', function () {
  var errs = GD_Level.validate(GD_Level.crossbeat);
  GD_ASSERT.ok(errs.length === 0, '校验错误: ' + errs.join(' | '));
});

GD_ASSERT.test('L2 段落时长合计 32.0 秒', function () {
  var lv = GD_Level.crossbeat, t = 0, S = GD_Physics.CONST.SPEEDS;
  for (var i = 0; i < lv.segments.length; i++) {
    var sg = lv.segments[i];
    t += (sg.to - sg.from) / S[sg.speed];
  }
  GD_ASSERT.approx(t, 32.0, 0.02, '总时长秒');
});

GD_ASSERT.test('L3 对象不越界、尖刺两两不重叠、门框不压障碍、回方块门必定触发', function () {
  var lv = GD_Level.crossbeat, objs = lv.objects, end = lv.meta.endBlock;
  for (var i = 0; i < objs.length; i++) {
    GD_ASSERT.ok(objs[i].x >= 0 && objs[i].x <= end, '对象越界: ' + objs[i].t + '@' + objs[i].x);
  }
  var hazards = objs.filter(function (o) { return o.t === 'spike'; });
  for (var a = 0; a < hazards.length; a++) {
    for (var b = 0; b < hazards.length; b++) {
      if (a !== b && Math.abs(hazards[a].x - hazards[b].x) < 0.9 && hazards[a].y === hazards[b].y) {
        throw new Error('尖刺重叠 @' + hazards[a].x);
      }
    }
  }
  // 传送门/速度门的触发框不能压住尖刺或方块：压住了玩家就会死在门旁边而不是被门传送。
  // 框的尺寸直接读 physics 的常量，不在测试里另抄一份（抄一份就会各自漂移）。
  var HIT = GD_Physics.CONST.HIT, C = GD_Physics.CONST;
  var gates = objs.filter(function (o) { return o.t.indexOf('portal_') === 0 || o.t.indexOf('speed_') === 0; });
  var solids = objs.filter(function (o) { return o.t === 'spike' || o.t === 'block'; });
  for (var g = 0; g < gates.length; g++) {
    var gb = { x0: gates[g].x, x1: gates[g].x + HIT.GATE_W, y0: gates[g].y, y1: gates[g].y + HIT.GATE_H };
    for (var s = 0; s < solids.length; s++) {
      var sb = solids[s].t === 'spike'
        ? { x0: solids[s].x + 0.5 - C.SPIKE_HW / 2, x1: solids[s].x + 0.5 + C.SPIKE_HW / 2,
            y0: solids[s].y, y1: solids[s].y + C.SPIKE_HH }
        : { x0: solids[s].x, x1: solids[s].x + 1, y0: solids[s].y, y1: solids[s].y + 1 };
      if (gb.x0 < sb.x1 && gb.x1 > sb.x0 && gb.y0 < sb.y1 && gb.y1 > sb.y0) {
        throw new Error('传送门触发框压住 ' + solids[s].t + '@' + solids[s].x + ',' + solids[s].y +
                       '（门 ' + gates[g].t + '@' + gates[g].x + ',' + gates[g].y + '）');
      }
    }
  }
  // 回方块的门与降速门必须真的能触发。
  // 玩家贴地时框是 [0,1]；门放在 y=1.0 时触发框是 [1, 1+GATE_H]，两者只在 y=1 处相接，
  // 而 overlap 用的是严格不等号 → 永远不重叠 → 门形同虚设：
  // 实测贴地跑过 x=253 仍是飞船模式，随后撞死在 x=264 的第一根尖刺。
  // 门贴地（y=0.5）后触发窗口是 y∈(-0.5, 0.5+GATE_H)，GATE_H=256 时是 (-0.5, 256.5)，
  // 松手落地的玩家必然命中。
  var g2 = GD_Physics.create(lv);
  g2.mode = 'ship'; g2.speedKey = 2; g2.x = 250; g2.y = 0; g2.vy = 0; g2.onGround = false;
  for (var s2 = 0; s2 < 240 * 3 && g2.x < 258; s2++) GD_Physics.step(g2, false);
  GD_ASSERT.ok(g2.mode === 'cube',
    '贴地跑过回方块门后应切成 cube，实为 ' + g2.mode + '（x=' + g2.x.toFixed(2) + '）');
  GD_ASSERT.ok(g2.speedKey === 1,
    '贴地跑过降速门后应回到 1x，实为 ' + g2.speedKey);
});
```

- [ ] **Step 2: 跑测试确认失败**

预期：`registered: 11, fail: 3, runErrors: []`，三条都报 `GD_Level is not defined`（用例内异常，被 `run()` 的 try/catch 吃掉，不进 `__RUN_ERRORS__`）。`loadErrors` 此时还剩 level.js / replay.js / replay.test.js 三条。

- [ ] **Step 3: 写 level.js**

`level.js`——段落与 spec §7 一一对应。对象坐标按"一次跳 = 4.02 格"的时间网格摆放，间距取拍数（154 BPM，一拍 0.3896 s，@1x 一拍走 4.046 格）：

window.GD_Level = (function () {
  var BPM = 154;

  function spikeRun(startX, count, y) {
    var a = [];
    for (var i = 0; i < count; i++) a.push({ x: startX + i, y: y || 0, t: 'spike' });
    return a;
  }
  // cube 段的柱子限高 2 格：单跳顶点 2.17，3 格柱实测 65 个起跳阈值 0 个能通过。
  // 长按能蹭过去不算合法路线——那是 LAND_TOL 把人吸上墙肩后再起跳的副作用。
  function pillar(x, h) {
    var a = [];
    for (var i = 0; i < h; i++) a.push({ x: x, y: i, t: 'block' });
    return a;
  }

  var objects = [].concat(
    // 开场 0–40：单尖刺 → 双尖刺，每 2 拍一个障碍（1 拍 = 4.046 格，8 格 = 1.98 拍）
    spikeRun(14, 1),
    spikeRun(22, 1),
    spikeRun(30, 2),

    // 推进 40–110：柱阵 + 环 + 跳板
    pillar(42, 2),
    spikeRun(48, 1),
    { x: 52, y: 2.0, t: 'ring_pink' },
    pillar(58, 2),
    spikeRun(64, 2),
    { x: 70, y: 0, t: 'pad_pink' },
    spikeRun(74, 1, 0), spikeRun(75, 1, 0),
    pillar(82, 2),
    { x: 88, y: 2.4, t: 'ring_yellow' },
    spikeRun(94, 2),
    pillar(100, 2),
    spikeRun(106, 1),

    // 切船 110–118：门都贴着地面（y=0.5），与地面线齐平
    { x: 112, y: 0.5, t: 'portal_ship' },
    { x: 116, y: 0.5, t: 'speed_2x' },

    // 飞行 118–254：上下柱阵通道。@2x 一拍走 12.914*0.3896 = 5.03 格
    // 通道净空 4 格，玩家 1 格，容错 3 格
    pillar(126, 4), { x: 126, y: 8, t: 'block' }, { x: 126, y: 9, t: 'block' }, { x: 126, y: 10, t: 'block' },
    { x: 134, y: 0, t: 'block' }, { x: 134, y: 1, t: 'block' }, { x: 134, y: 7, t: 'block' }, { x: 134, y: 8, t: 'block' },
    pillar(142, 5), { x: 142, y: 9, t: 'block' }, { x: 142, y: 10, t: 'block' },
    { x: 150, y: 0, t: 'block' }, { x: 150, y: 1, t: 'block' }, { x: 150, y: 2, t: 'block' }, { x: 150, y: 8, t: 'block' },
    pillar(158, 3), { x: 158, y: 9, t: 'block' },
    { x: 166, y: 0, t: 'block' }, { x: 166, y: 1, t: 'block' }, { x: 166, y: 7, t: 'block' }, { x: 166, y: 8, t: 'block' },
    pillar(174, 6), { x: 174, y: 10, t: 'block' },
    { x: 182, y: 0, t: 'block' }, { x: 182, y: 6, t: 'block' }, { x: 182, y: 7, t: 'block' },
    pillar(190, 4), { x: 190, y: 9, t: 'block' }, { x: 190, y: 10, t: 'block' },
    { x: 198, y: 0, t: 'block' }, { x: 198, y: 1, t: 'block' }, { x: 198, y: 8, t: 'block' },
    pillar(206, 5), { x: 206, y: 10, t: 'block' },
    { x: 214, y: 0, t: 'block' }, { x: 214, y: 1, t: 'block' }, { x: 214, y: 2, t: 'block' }, { x: 214, y: 7, t: 'block' },
    pillar(222, 3), { x: 222, y: 8, t: 'block' }, { x: 222, y: 9, t: 'block' },
    { x: 230, y: 0, t: 'block' }, { x: 230, y: 1, t: 'block' }, { x: 230, y: 9, t: 'block' },
    pillar(238, 4), { x: 238, y: 10, t: 'block' },

    // 回方块：切船门在 x=112、降速门在 x=116，两扇门都贴地（y=0.5）。
    // 触发点是玩家前沿（x+0.5）碰到门的 x，所以实际切换发生在 x≈111.5 / 115.5，
    // 段落的 118 / 254 只是主题分段点——两者不是一回事，别再写成"严格相等"。
    // 回方块这扇门同样必须贴地：触发框从 o.y 往上延伸，玩家贴地时框是 [0,1]，
    // 门放在 y=1.0 时 1 > 1 不成立，门永远不触发——实测贴地跑过 x=253 仍是飞船模式，
    // 随后撞死在 x=264 的第一根尖刺。
    // Task 7 把触发框改成了**通高**（GATE_H = 256 格，框是 [0.5, 256.5]）：
    // 通道内的玩家（y≲11）和出口前一小段内起飞的人都能命中。
    // 但这**不是**"飞到多高都不会错过"——飞船段没有封顶，玩家理论上能飞到 y≥256.5
    // 仍会错过这扇门（那个洞记在 spec §13，要靠关卡封顶解决，不是靠门框）。
    // 门的底边仍是 0.5——不能改成 0，否则悬在半空的门会被地面上的玩家触发，语义就错了。
    { x: 253, y: 0.5, t: 'portal_cube' },
    { x: 254, y: 0.5, t: 'speed_1x' },

    // 收尾 258–360：密集节奏段
    spikeRun(264, 1),
    spikeRun(272, 2),
    pillar(280, 2),
    spikeRun(286, 1), { x: 288, y: 2.0, t: 'ring_pink' },
    spikeRun(294, 2),
    { x: 300, y: 0, t: 'pad_pink' },
    spikeRun(304, 1), spikeRun(305, 1),
    pillar(312, 2),
    spikeRun(318, 2),
    pillar(324, 2),
    spikeRun(330, 1),
    { x: 334, y: 2.4, t: 'ring_yellow' },
    spikeRun(340, 2),   // 三连刺打不过：y>=0.55 的窗口只有 3.49 格，三刺要 3.55
    { x: 360, y: 0, t: 'finish' }   // 旗子与 endBlock 同点：越过 x=360 的瞬间判通关
  );

  var crossbeat = {
    meta: { name: 'Crossbeat', bpm: BPM, endBlock: 360 },
    segments: [
      { from: 0,   to: 110, mode: 'cube', speed: 1, theme: 'blue'   },   // 10.591 s
      { from: 110, to: 118, mode: 'cube', speed: 1, theme: 'blue'   },   //  0.770 s  切船过渡
      { from: 118, to: 254, mode: 'ship', speed: 2, theme: 'violet' },   // 10.531 s
      { from: 254, to: 360, mode: 'cube', speed: 1, theme: 'blue'   }    // 10.206 s
    ],
    // 合计 32.098 s，落在 L2 测试的 32.0 ± 2% 容差内
    objects: objects
  };

  var VALID_TYPES = ['spike', 'block', 'pad_pink', 'pad_yellow', 'ring_pink', 'ring_yellow',
                     'portal_ship', 'portal_cube', 'speed_1x', 'speed_2x', 'speed_3x', 'speed_4x', 'finish'];
  // 合法门速。写在这里而不是从 physics 读：level.js 是纯数据层，不能反向依赖物理层。
  var VALID_SPEEDS = [0.5, 1, 2, 3, 4];

  function validate(lv) {
    var errs = [];
    if (!lv.meta) errs.push('缺 meta');
    if (!Array.isArray(lv.objects)) errs.push('缺 objects 数组');
    if (!Array.isArray(lv.segments)) errs.push('缺 segments 数组');
    if (lv.meta && typeof lv.meta.endBlock !== 'number') errs.push('meta.endBlock 非数字');
    if (lv.objects) {
      for (var i = 0; i < lv.objects.length; i++) {
        var o = lv.objects[i];
        if (typeof o.x !== 'number' || typeof o.y !== 'number') errs.push('对象缺 x/y: #' + i);
        if (VALID_TYPES.indexOf(o.t) < 0) errs.push('未知类型: ' + o.t + ' #' + i);
        // 对象不能落在终点之后：那样它永远不会被玩家碰到，等于白放一个障碍
        if (lv.meta && typeof lv.meta.endBlock === 'number' && o.x > lv.meta.endBlock) {
          errs.push('对象越过终点: ' + o.t + '@' + o.x);
        }
      }
    }
    if (lv.segments) {
      for (var s = 0; s < lv.segments.length; s++) {
        var sg = lv.segments[s];
        if (['cube', 'ship'].indexOf(sg.mode) < 0) errs.push('非法 mode: ' + sg.mode);
        if (typeof sg.from !== 'number' || typeof sg.to !== 'number') errs.push('段落缺 from/to #' + s);
        else {
          if (sg.to <= sg.from) errs.push('段落 from>=to #' + s + ' (' + sg.from + '→' + sg.to + ')');
          if (VALID_SPEEDS.indexOf(sg.speed) < 0) errs.push('非法 speed: ' + sg.speed + ' #' + s);
        }
      }
      // 段落必须首尾相接且从 0 开始：Task 12 的 tOf() 按段落做分段积分，
      // 段落之间留缝会让"到达 x 的时刻"整体算偏。
      if (lv.segments.length && lv.segments[0].from !== 0) errs.push('第一个段落必须从 0 开始');
      for (var k = 1; k < lv.segments.length; k++) {
        if (lv.segments[k].from !== lv.segments[k - 1].to) {
          errs.push('段落不连续: #' + (k - 1) + ' 结束于 ' + lv.segments[k - 1].to +
                    '，#' + k + ' 从 ' + lv.segments[k].from + ' 开始');
        }
      }
    }
    return errs;
  }

  return { crossbeat: crossbeat, validate: validate, VALID_TYPES: VALID_TYPES };
})();
})();
```

- [ ] **Step 4: 跑测试确认通过**

预期：`pass: 11, fail: 0, registered: 11, runErrors: []`。`loadErrors` 只剩 replay.js / replay.test.js 两条。

若 `L2` 红：段落 `from/to/speed` 与上表注释不一致，按注释修。

**与 spec §7 的偏差（有意为之）**：§7 的表格把关卡切成 6 段，其中"切船 110–118""回方块 250–258"是描述性的过渡区间，没有独立的 mode/speed。这里压成 4 段（118 / 254），让**段落边界与主题切换点对齐**，方便 `replay.js` 的 `tOf()` 分段积分与物理实际走的轨迹对上。总时长 32.098 s，仍在 §7 的 32.0 s ±2% 内。

**注意：段落边界 ≠ 传送门触发点（2026-11-08 更正）**。传送门与速度门是在**玩家前沿（x+0.5）碰到门的 x** 时才生效，所以实际切换点是：

| 事件 | 门的位置 | 实际生效 x |
|---|---|---|
| 切船（cube→ship） | `portal_ship` x=112 | ≈111.5 |
| 提速（1x→2x） | `speed_2x` x=116 | ≈115.5 |
| 回方块（ship→cube） | `portal_cube` x=253 | ≈252.5 |
| 降速（2x→1x） | `speed_1x` x=254 | ≈253.5 |

段落断点 118 / 254 与它们差 0.5 格。旧文档写成"段落边界与传送门 x 坐标严格相等（118 与 254）"是**错的**——那句话连着 handoff 一起传了下来。`replay.js` 的 `tOf()` 因此改成**从关卡里的速度门推导档位**，不再抄一份手写的段表。

- [ ] **Step 5: Commit**

```bash
window.GD_Level = (function () {
  var BPM = 154;

  function spikeRun(startX, count, y) {
    var a = [];
    for (var i = 0; i < count; i++) a.push({ x: startX + i, y: y || 0, t: 'spike' });
    return a;
  }
  // cube 段的柱子限高 2 格：单跳顶点 2.17，3 格柱实测 65 个起跳阈值 0 个能通过。
  // 长按能蹭过去不算合法路线——那是 LAND_TOL 把人吸上墙肩后再起跳的副作用。
  function pillar(x, h) {
    var a = [];
    for (var i = 0; i < h; i++) a.push({ x: x, y: i, t: 'block' });
    return a;
  }

  var objects = [].concat(
    // 开场 0–40：单尖刺 → 双尖刺，每 2 拍一个障碍（1 拍 = 4.046 格，8 格 = 1.98 拍）
    spikeRun(14, 1),
    spikeRun(22, 1),
    spikeRun(30, 2),

    // 推进 40–110：柱阵 + 环 + 跳板
    pillar(42, 2),
    spikeRun(48, 1),
    { x: 52, y: 2.0, t: 'ring_pink' },
    pillar(58, 2),
    spikeRun(64, 2),
    { x: 70, y: 0, t: 'pad_pink' },
    spikeRun(74, 1, 0), spikeRun(75, 1, 0),
    pillar(82, 2),
    { x: 88, y: 2.4, t: 'ring_yellow' },
    spikeRun(94, 2),
    pillar(100, 2),
    spikeRun(106, 1),

    // 切船 110–118：门都贴着地面（y=0.5），与地面线齐平
    { x: 112, y: 0.5, t: 'portal_ship' },
    { x: 116, y: 0.5, t: 'speed_2x' },

    // 飞行 118–254：上下柱阵通道。@2x 一拍走 12.914*0.3896 = 5.03 格
    // 通道净空 4 格，玩家 1 格，容错 3 格
    pillar(126, 4), { x: 126, y: 8, t: 'block' }, { x: 126, y: 9, t: 'block' }, { x: 126, y: 10, t: 'block' },
    { x: 134, y: 0, t: 'block' }, { x: 134, y: 1, t: 'block' }, { x: 134, y: 7, t: 'block' }, { x: 134, y: 8, t: 'block' },
    pillar(142, 5), { x: 142, y: 9, t: 'block' }, { x: 142, y: 10, t: 'block' },
    { x: 150, y: 0, t: 'block' }, { x: 150, y: 1, t: 'block' }, { x: 150, y: 2, t: 'block' }, { x: 150, y: 8, t: 'block' },
    pillar(158, 3), { x: 158, y: 9, t: 'block' },
    { x: 166, y: 0, t: 'block' }, { x: 166, y: 1, t: 'block' }, { x: 166, y: 7, t: 'block' }, { x: 166, y: 8, t: 'block' },
    pillar(174, 6), { x: 174, y: 10, t: 'block' },
    { x: 182, y: 0, t: 'block' }, { x: 182, y: 6, t: 'block' }, { x: 182, y: 7, t: 'block' },
    pillar(190, 4), { x: 190, y: 9, t: 'block' }, { x: 190, y: 10, t: 'block' },
    { x: 198, y: 0, t: 'block' }, { x: 198, y: 1, t: 'block' }, { x: 198, y: 8, t: 'block' },
    pillar(206, 5), { x: 206, y: 10, t: 'block' },
    { x: 214, y: 0, t: 'block' }, { x: 214, y: 1, t: 'block' }, { x: 214, y: 2, t: 'block' }, { x: 214, y: 7, t: 'block' },
    pillar(222, 3), { x: 222, y: 8, t: 'block' }, { x: 222, y: 9, t: 'block' },
    { x: 230, y: 0, t: 'block' }, { x: 230, y: 1, t: 'block' }, { x: 230, y: 9, t: 'block' },
    pillar(238, 4), { x: 238, y: 10, t: 'block' },

    // 回方块：切船门在 x=112、降速门在 x=116，两扇门都贴地（y=0.5）。
    // 触发点是玩家前沿（x+0.5）碰到门的 x，所以实际切换发生在 x≈111.5 / 115.5，
    // 段落的 118 / 254 只是主题分段点——两者不是一回事，别再写成"严格相等"。
    // 回方块这扇门同样必须贴地：触发框从 o.y 往上延伸，玩家贴地时框是 [0,1]，
    // 门放在 y=1.0 时 1 > 1 不成立，门永远不触发——实测贴地跑过 x=253 仍是飞船模式，
    // 随后撞死在 x=264 的第一根尖刺。
    // Task 7 把触发框改成了**通高**（GATE_H = 256 格，框是 [0.5, 256.5]）：
    // 通道内的玩家（y≲11）和出口前一小段内起飞的人都能命中。
    // 但这**不是**"飞到多高都不会错过"——飞船段没有封顶，玩家理论上能飞到 y≥256.5
    // 仍会错过这扇门（那个洞记在 spec §13，要靠关卡封顶解决，不是靠门框）。
    // 门的底边仍是 0.5——不能改成 0，否则悬在半空的门会被地面上的玩家触发，语义就错了。
    { x: 253, y: 0.5, t: 'portal_cube' },
    { x: 254, y: 0.5, t: 'speed_1x' },

    // 收尾 258–360：密集节奏段
    spikeRun(264, 1),
    spikeRun(272, 2),
    pillar(280, 2),
    spikeRun(286, 1), { x: 288, y: 2.0, t: 'ring_pink' },
    spikeRun(294, 2),
    { x: 300, y: 0, t: 'pad_pink' },
    spikeRun(304, 1), spikeRun(305, 1),
    pillar(312, 2),
    spikeRun(318, 2),
    pillar(324, 2),
    spikeRun(330, 1),
    { x: 334, y: 2.4, t: 'ring_yellow' },
    spikeRun(340, 2),   // 三连刺打不过：y>=0.55 的窗口只有 3.49 格，三刺要 3.55
    { x: 360, y: 0, t: 'finish' }   // 旗子与 endBlock 同点：越过 x=360 的瞬间判通关
  );

  var crossbeat = {
    meta: { name: 'Crossbeat', bpm: BPM, endBlock: 360 },
    segments: [
      { from: 0,   to: 110, mode: 'cube', speed: 1, theme: 'blue'   },   // 10.591 s
      { from: 110, to: 118, mode: 'cube', speed: 1, theme: 'blue'   },   //  0.770 s  切船过渡
      { from: 118, to: 254, mode: 'ship', speed: 2, theme: 'violet' },   // 10.531 s
      { from: 254, to: 360, mode: 'cube', speed: 1, theme: 'blue'   }    // 10.206 s
    ],
    // 合计 32.098 s，落在 L2 测试的 32.0 ± 2% 容差内
    objects: objects
  };

  var VALID_TYPES = ['spike', 'block', 'pad_pink', 'pad_yellow', 'ring_pink', 'ring_yellow',
                     'portal_ship', 'portal_cube', 'speed_1x', 'speed_2x', 'speed_3x', 'speed_4x', 'finish'];
  // 合法门速。写在这里而不是从 physics 读：level.js 是纯数据层，不能反向依赖物理层。
  var VALID_SPEEDS = [0.5, 1, 2, 3, 4];

  function validate(lv) {
    var errs = [];
    if (!lv.meta) errs.push('缺 meta');
    if (!Array.isArray(lv.objects)) errs.push('缺 objects 数组');
    if (!Array.isArray(lv.segments)) errs.push('缺 segments 数组');
    if (lv.meta && typeof lv.meta.endBlock !== 'number') errs.push('meta.endBlock 非数字');
    if (lv.objects) {
      for (var i = 0; i < lv.objects.length; i++) {
        var o = lv.objects[i];
        if (typeof o.x !== 'number' || typeof o.y !== 'number') errs.push('对象缺 x/y: #' + i);
        if (VALID_TYPES.indexOf(o.t) < 0) errs.push('未知类型: ' + o.t + ' #' + i);
        // 对象不能落在终点之后：那样它永远不会被玩家碰到，等于白放一个障碍
        if (lv.meta && typeof lv.meta.endBlock === 'number' && o.x > lv.meta.endBlock) {
          errs.push('对象越过终点: ' + o.t + '@' + o.x);
        }
      }
    }
    if (lv.segments) {
      for (var s = 0; s < lv.segments.length; s++) {
        var sg = lv.segments[s];
        if (['cube', 'ship'].indexOf(sg.mode) < 0) errs.push('非法 mode: ' + sg.mode);
        if (typeof sg.from !== 'number' || typeof sg.to !== 'number') errs.push('段落缺 from/to #' + s);
        else {
          if (sg.to <= sg.from) errs.push('段落 from>=to #' + s + ' (' + sg.from + '→' + sg.to + ')');
          if (VALID_SPEEDS.indexOf(sg.speed) < 0) errs.push('非法 speed: ' + sg.speed + ' #' + s);
        }
      }
      // 段落必须首尾相接且从 0 开始：Task 12 的 tOf() 按段落做分段积分，
      // 段落之间留缝会让"到达 x 的时刻"整体算偏。
      if (lv.segments.length && lv.segments[0].from !== 0) errs.push('第一个段落必须从 0 开始');
      for (var k = 1; k < lv.segments.length; k++) {
        if (lv.segments[k].from !== lv.segments[k - 1].to) {
          errs.push('段落不连续: #' + (k - 1) + ' 结束于 ' + lv.segments[k - 1].to +
                    '，#' + k + ' 从 ' + lv.segments[k].from + ' 开始');
        }
      }
    }
    return errs;
  }

  return { crossbeat: crossbeat, validate: validate, VALID_TYPES: VALID_TYPES };
})();
```

---

## Task 6: 跳板与跳环（含 T2 已覆盖的常数）

**Files:**
- Modify: `physics.js`（跳板触发判定：一次接触只给一次冲量）
- Modify: `tests/physics.test.js`（追加）
- Modify: `tests/harness.html`（`expect_tests` 改成 13）

- [ ] **Step 1: 写测试**

追加 P1/P2 两条到 `tests/physics.test.js`，并把 `expect_tests` 改为 13：

```js
// P1/P2 复用上面 LV 助手（与文件里其它用例保持一致：关卡带非空 segments）。
GD_ASSERT.test('P1 跳板/跳环可达高度符合 spec §4.3', function () {
  var C = GD_Physics.CONST;
  // 常量先钉死。下面的高度是从 CONST 推出来的：CONST 漂了，高度断言会跟着漂，
  // 两边一起漂就没人发现了。所以"常量断言"和"高度指纹"分工不同，两个都要有——
  // 常量断言保证推的原料是 spec §4.3 的数，指纹保证物理实现本身是精确的。
  GD_ASSERT.near(C.PAD.pad_pink, 21.08, 0.001, 'spec §4.3 粉跳板速度');
  GD_ASSERT.near(C.PAD.pad_yellow, 32.28, 0.001, 'spec §4.3 黄跳板速度');
  GD_ASSERT.near(C.RING.ring_pink, 15.78, 0.001, 'spec §4.3 粉环速度');
  GD_ASSERT.near(C.RING.ring_yellow, 23.40, 0.001, 'spec §4.3 黄环速度');
  // 命中框尺寸同样是行为依据（板厚 0.35 格；环框 [o.x-0.6, o.x+1.6] × [o.y-0.6, o.y+1.6]），
  // 计划正文按这些数字推理过触发行为，改了它们却没有断言会红，一并钉住。
  GD_ASSERT.near(C.HIT.PAD_H, 0.35, 0.001, '跳板顶面厚度');
  GD_ASSERT.near(C.HIT.RING_X0, -0.6, 0.001, '跳环触发框左边界');
  GD_ASSERT.near(C.HIT.RING_X1, 1.6, 0.001, '跳环触发框右边界');
  GD_ASSERT.near(C.HIT.RING_Y0, -0.6, 0.001, '跳环触发框下边界');
  GD_ASSERT.near(C.HIT.RING_Y1, 1.6, 0.001, '跳环触发框上边界');

  // 跳板：贴地跑过去，接触即触发（不用按键）。
  function padApex(obj) {
    var st = GD_Physics.create(LV([obj]));
    var apex = 0, trigY = null, guard = 0;
    // 先跑到 obj.x - 0.2 格：玩家前沿是 x+0.5，跳板在 x+0.5 > obj.x 的那一步
    // （实测 x=4.5006）就弹射了，这一段留在第一阶段，弹射后的顶点由第二阶段记。
    while (st.x < obj.x - 0.2 && guard++ < 240 * 10) {
      var vyB = st.vy;
      GD_Physics.step(st, false);
      if (trigY === null && Math.abs(st.vy - C.PAD[obj.t]) < 1e-6) trigY = st.y;
    }
    var g2 = 0;
    while (st.alive && g2++ < 240 * 3) {
      GD_Physics.step(st, false);
      if (st.y > apex) apex = st.y;
      // 24 步 = 0.1 秒的稳定窗口：弹射后玩家至少飞 44 步（0.18 秒）才可能再落地，
      // 所以头 24 步里的 onGround=true 不能当作"结束"（否则会记到还没弹出去的高度）。
      if (st.onGround && g2 > 24) break;
    }
    return { apex: apex, trigY: trigY };
  }

  // 跳环：要在**环心高度**上按住才触发。
  function ringApex(obj) {
    var st = GD_Physics.create(LV([obj]));
    var guard = 0;
    while (st.x < obj.x - 0.2 && guard++ < 240 * 10) GD_Physics.step(st, false);
    // 环的触发框是 [o.y-0.6, o.y+1.6]（2.2 格高），玩家只有 1 格高：
    // 从地面起跳时脚边在 y≈0.83 就先碰到框的下沿，那一次的触发高度跟环心无关，
    // 测出来的顶点自然不是「环心 + 可达高度」。所以瞬移到环心高度（vy=0，正在下落）再按，
    // 触发点才落在环心上（实测 y=2.399，比环心低的那 0.001 格是放置后那一步的自由落体）。
    st.y = obj.y; st.vy = 0; st.onGround = false;
    var apex = 0, trigY = null, g2 = 0;
    while (st.alive && g2++ < 240 * 3) {
      var vyB = st.vy;
      GD_Physics.step(st, true);
      if (trigY === null && Math.abs(st.vy - C.RING[obj.t]) < 1e-6) trigY = st.y;
      if (st.y > apex) apex = st.y;
      if (st.onGround && g2 > 24) break;
    }
    return { apex: apex, trigY: trigY };
  }

  // spec §4.3：可达高度 h = v²/(2g)。表里的值（粉跳板 1.933、粉环 1.083、黄环 2.383）
  // 是解析值取整；环的高度用 obj.y（这枚环自己的 y）而不是写死的 2.4，
  // 将来把环挪到别的 y，期望值会跟着走，不会悄悄过期。
  var pad = { x: 5, y: 0, t: 'pad_pink' };
  var p = padApex(pad);
  GD_ASSERT.ok(p.trigY !== null, '粉跳板应当触发过');
  GD_ASSERT.approx(p.apex, 1.933, 0.005, '粉跳板高度');
  // 指纹：弹射点到顶点的抬升必须正好是 v²/(2g)（跳板的弹射点就是地面，trigY=0）。
  GD_ASSERT.near(p.apex - p.trigY,
    C.PAD.pad_pink * C.PAD.pad_pink / (2 * C.G), 0.002, '粉跳板高度指纹');

  var ringP = { x: 5, y: 2.4, t: 'ring_pink' };
  var rp = ringApex(ringP);
  GD_ASSERT.ok(rp.trigY !== null, '粉环应当触发过');
  GD_ASSERT.approx(rp.apex, 1.083 + ringP.y, 0.005, '粉环相对高度');
  GD_ASSERT.near(rp.apex - rp.trigY,
    C.RING.ring_pink * C.RING.ring_pink / (2 * C.G), 0.002, '粉环高度指纹');

  var ringY = { x: 5, y: 2.4, t: 'ring_yellow' };
  var ry = ringApex(ringY);
  GD_ASSERT.ok(ry.trigY !== null, '黄环应当触发过');
  GD_ASSERT.approx(ry.apex, 2.383 + ringY.y, 0.005, '黄环相对高度');
  GD_ASSERT.near(ry.apex - ry.trigY,
    C.RING.ring_yellow * C.RING.ring_yellow / (2 * C.G), 0.002, '黄环高度指纹');

  // 跳板的三种"接触"现状，显式钉住。
  // spec §4.3 写的是"跳板为接触即触发"，现在的实现是"一次接触只给一次冲量"，
  // 方向由 vy<=0 定：贴地跑过会弹、从高处砸下来会弹、**上升中掠过不弹**。
  // 第三条是与 spec §4.3 的一处语义偏离（GD 里跳板是钉在方块底部的实体，
  // 玩家踩不到板子下面；本项目的跳板是独立的 0.35 格薄片，"从下面穿过"要自己定方向）。
  // 钉在这里是为了让它显式、可被 review，而不是只活在散文里；改不改留给 Task 13 实玩定夺。
  function padScenario(withPad, x, y, vy) {
    var objs = withPad ? [{ x: 5, y: 0, t: 'pad_pink' }] : [];
    var st = GD_Physics.create(LV(objs));
    st.x = x; st.y = y; st.vy = vy; st.onGround = false;
    var apex = 0, fired = false, trigY = null, n = 0;
    while (n++ < 240) {
      GD_Physics.step(st, false);
      if (!fired && Math.abs(st.vy - C.PAD.pad_pink) < 1e-6) { fired = true; trigY = st.y; }
      if (st.y > apex) apex = st.y;
    }
    return { apex: apex, fired: fired, trigY: trigY };
  }
  // (1) 贴地跑过跳板 → 弹：就是上面 padApex 那条（顶点 1.932，触发点在地面 y=0）。
  // (2) 上升中掠过跳板 → 不弹：玩家在 x=4.55、y=0.05、vy=+16，
  //     脚在板体厚度里（0.05 < 0.35）、正在上升、前沿已经压到板子左边（4.55+0.5=5.05>5），
  //     三种"接触"条件全满足。旧实现（只按重叠判）这里会弹 3 次，现在 0 次。
  var rise = padScenario(true, 4.55, 0.05, 16);
  var riseCtl = padScenario(false, 4.55, 0.05, 16);
  GD_ASSERT.ok(!rise.fired, '上升中掠过跳板不该触发（spec §4.3 的语义偏离，见注释）');
  GD_ASSERT.near(rise.apex, riseCtl.apex, 1e-9, '上升中掠过跳板时轨迹与没有跳板时逐帧相同');
  // (3) 从高处砸到跳板上 → 弹：玩家在 x=5.2、y=1.0、vy=-15，脚落到板体厚度里就弹。
  //     起点放在 y=1.0 而不是更高，是为了让"下落途中的最高点"不盖过弹射后的顶点。
  var fall = padScenario(true, 5.2, 1.0, -15);
  GD_ASSERT.ok(fall.fired, '从高处砸到跳板上应当触发');
  GD_ASSERT.near(fall.apex - fall.trigY,
    C.PAD.pad_pink * C.PAD.pad_pink / (2 * C.G), 0.002, '砸下来弹射的高度指纹');

  // spec §4.3：跳环需玩家按下触发，跳板为接触即触发。
  // 同一个位置按一次 vs 不按一次：不按的时候环的速度不会被写进 vy。
  function ringVy(held) {
    var st = GD_Physics.create(LV([{ x: 5, y: 2.4, t: 'ring_pink' }]));
    st.x = 4.8; st.y = 2.4; st.vy = 0; st.onGround = false;
    GD_Physics.step(st, held);
    return st.vy;
  }
  GD_ASSERT.near(ringVy(true), C.RING.ring_pink, 1e-6, '按下时跳环触发');
  GD_ASSERT.ok(Math.abs(ringVy(false) - C.RING.ring_pink) > 1,
    '不按的时候跳环不该触发');
});

GD_ASSERT.test('P2 跳环只能触发一次', function () {
  var RING = GD_Physics.CONST.RING.ring_pink;
  var st = GD_Physics.create(LV([{ x: 5, y: 2.4, t: 'ring_pink' }]));
  var triggers = 0, lastVy = 0;
  var guard = 0;
  while (st.x < 4.5 && guard++ < 240 * 10) GD_Physics.step(st, false);
  for (var i = 0; i < 240; i++) {
    GD_Physics.step(st, true);
    // 触发标志 = 环的速度被写进 vy 的那一帧。
    // 不能拿「vy 突然变大」当标志：长按的普通起跳和落地同样是 vy 猛增
    // （实测 240 步里数出 5 次，而且压根数不到环那次——环触发时玩家正在上升，
    //  环把 vy 从 18.05 压到 15.78，是**变小**）。
    if (Math.abs(st.vy - RING) < 1e-6) triggers++;
    lastVy = st.vy;
  }
  // 玩家在环的触发框里待了约 50 帧（框宽 2.2 格，@1x 一帧 0.043 格），
  // 没有一次性标记就会每帧触发一次（实测 49 次）——这条断言是有牙齿的。
  GD_ASSERT.ok(triggers >= 1,
    '跳环应当触发过，实测 ' + triggers + ' 次（最后一次 vy=' + lastVy + '，期望 ' + RING + '）');
  GD_ASSERT.ok(triggers <= 1,
    '跳环触发 ' + triggers + ' 次，应 ≤ 1（最后一次 vy=' + lastVy + '）');

  // 对照组：同一个 240 步场景、同样一直按住，关卡里**没有环** —— 一次都不该触发。
  // 有这条才敢说上面那 1 次确实来自环，而不是别的什么往 vy 里写数的路径。
  var ctl = GD_Physics.create(LV([]));
  var ctlTriggers = 0, guard2 = 0;
  while (ctl.x < 4.5 && guard2++ < 240 * 10) GD_Physics.step(ctl, false);
  for (var j = 0; j < 240; j++) {
    GD_Physics.step(ctl, true);
    if (Math.abs(ctl.vy - RING) < 1e-6) ctlTriggers++;
  }
  GD_ASSERT.ok(ctlTriggers === 0, '没有环就不该有触发，实测 ' + ctlTriggers + ' 次');
});
```

- [ ] **Step 2: 跑测试**

  实测：粉跳板不是"偏低"，是**偏高 17.9%**——顶点 2.279368，期望 1.933（偏差 +0.346368）。
  原因是跳板只按"重叠"判定：弹射之后玩家的脚还留在 0.35 厚的板体里（实测 y 从 0 涨到 0.347 共 5 帧），
  这 5 帧每帧都把 vy 重置回 21.08，等于从板体上沿 y≈0.347 起跳，顶点 = 0.347 + 1.932 = 2.279。
  所以判定要加"不在上升"这一条，**不是**本节原先写的"本帧跨过"：
  贴地跑动时玩家的脚在 y=0，本来就在板体上沿（0.35）**之下**，
  "跨过"规则永远不成立（实测关卡两处跳板在贴地跑动下都是 **0 次触发**，顶点 0.000000；
  只有从高处下落、脚下穿过 y=0.35 时才触发——实测 x=4.9828、y=0.2752 触发 1 次）。

  高速下坠也不会漏触发：板体厚 0.35 格，下落末速钳位 30 格/秒 = 一帧 0.125 格，穿不过去。

  **已知语义偏离（诚实记录，不要当优点）**：spec §4.3 写的是"跳板为接触即触发"，
  现在的实现是"一次接触只给一次冲量"，方向由 `vy<=0` 定：
  贴地跑过会弹、从高处砸下来会弹、**上升中掠过不弹**（旧实现会弹 3 次）。
  GD 里跳板是钉在方块底部的实体，玩家踩不到板子下面；本项目的跳板是独立的 0.35 格薄片，
  "从下面穿过"这种情形原版不存在，方向得自己定。关卡里两处跳板都在地面上，实测不影响可通性
  （可通性扫描新旧零差异）；要不要改成真正的"每次接触一次冲量"，留给 Task 13 人工试玩定夺。
  spec §13 的诚实清单里也记了一条；P1 用三条场景断言把现状钉住。

  跳环**不用改实现**，但 P1 的**测量方式**要改：环的触发框是 [o.y-0.6, o.y+1.6]（2.2 格高），
  玩家只有 1 格高，从地面起跳时脚边在 y≈0.8318 就先碰到了框的下沿，
  那一次的触发高度与环心（2.4）无关，测出来的顶点是 1.914481 而不是 3.483
  （差 1.568519 = 环心 2.4 − 实际触发高度 0.8318）。
  所以把玩家放到环心高度（vy=0，正在下落）再按，触发点才落在环心上：
  实测顶点 3.481642（粉环）/ 4.779670（黄环）。

  P2 的**检测器**同样要改：原写法拿"vy 突然变大"当触发标志，
  而长按的普通起跳和落地同样是 vy 猛增（实测 240 步里数出 5 次，压根数不到环那次——
  环触发时玩家正在上升，环把 vy 从 18.0475 压到 15.78，是**变小**）。
  改成"环的速度被写进 vy 的那一帧"才算数：实测 1 次；
  去掉 `st.used` 一次性标记会数出 49 次（玩家在 2.2 格宽的触发框里待了约 50 帧）。
  P2 还补了对照组：同样 240 步、同样按住，关卡里没有环时触发数必须是 0。

```js
// 替换 pad 分支
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
```

- [ ] **Step 3: 跑测试确认通过**

预期：`pass: 13, fail: 0, registered: 13, runErrors: []`。

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git add physics.js tests && git commit -m "feat: 跳板与跳环触发，含单次触发约束"
```

---

## Task 7: 飞船模式（T4）

**Files:**
- Modify: `physics.js`（门的触发框通高 + 切回方块时清 `vy`）
- Modify: `level.js`（只改注释：把"残留缺口"那句改成现状）
- Modify: `tests/physics.test.js`（追加）
- Modify: `tests/harness.html`（`expect_tests` 改成 16）

- [ ] **Step 1: 写测试**

追加 T4/T4b/T4c 三条到 `tests/physics.test.js`，并把 `expect_tests` 改为 16。
下面的代码块是**磁盘上的最终形态**（Step 5 的断言已经并进 `T4c`）：

```js
GD_ASSERT.test('T4 飞船速度上限钳制', function () {
  function shipVy(held, seconds) {
    // 关卡必须带非空 segments：Task 2 拆掉了 respawn 的静默回退，
    // 缺 segments 时死亡重开会抛 TypeError，而不是悄悄退回 cube/1x。
    // 本用例测的是飞船模式，所以段落的 mode 写 ship、speed 与 create() 的初值一致。
    var st = GD_Physics.create({
      segments: [{ from: 0, to: 100000, mode: 'ship', speed: 1 }],
      objects: [],
      meta: { endBlock: 100000 }
    });
    st.mode = 'ship'; st.y = 50;
    // 起点必须高于 2 秒的下坠距离：飞船碰到地面会被钳成 y=0、vy=0
    // （stepShip 的 `if (st.y < GROUND)`），落在地上的飞船根本测不出 -19.2 的下限钳位
    // （实测从 y=5 起松手 2 秒，vy=0）。实测 2 秒最多下坠 35.25 格（y=50 → 14.749），
    // 50 格留足余量。
    for (var i = 0; i < 240 * seconds; i++) GD_Physics.step(st, held);
    return st.vy;
  }
  GD_ASSERT.approx(shipVy(true, 2), 16.0, 0.02, '按住 2 秒收敛到 +16.0');
  GD_ASSERT.approx(shipVy(false, 2), -19.2, 0.02, '松开 2 秒收敛到 -19.2');
});

GD_ASSERT.test('T4b 飞船水平速度与方块模式完全相同', function () {
  function run(mode) {
    // segments 只在死亡重开时才起作用，本用例不会死；固定写 ship/speed 2 是为了
    // 不给 run('cube') 那一路引入第二个变量（两路的差别只应该是 mode）。
    var st = GD_Physics.create({
      segments: [{ from: 0, to: 100000, mode: 'ship', speed: 2 }],
      objects: [],
      meta: { endBlock: 100000 }
    });
    st.mode = mode; st.speedKey = 2;
    for (var i = 0; i < 240; i++) GD_Physics.step(st, false);
    return st.x;
  }
  GD_ASSERT.near(run('ship'), run('cube'), 0.001, '同 1 秒水平位移');
});

GD_ASSERT.test('T4c 传送门切换模式', function () {
  var C = GD_Physics.CONST;
  // 门的触发框尺寸先钉死：GATE_H 决定"门有多高"，改了它不用别的测试就会红。
  // GATE_H = 256 是**通高**（框从门的底边 o.y 往上延伸 256 格），见 physics.js 的注释。
  GD_ASSERT.near(C.HIT.GATE_W, 1.4, 0.001, '门的触发框宽度');
  GD_ASSERT.near(C.HIT.GATE_H, 256, 0.001, '门的触发框高度（通高）');

  var st = GD_Physics.create({
    // 两个门都贴地（y=0.5）：飞船落到地面后框是 [0,1]，而门框从 o.y 往上，
    // y=1 的门框 [1, …] 与玩家框只在边界相接（overlap 用严格不等号）→ 永远不触发。
    // 这正是 035e7be 在关卡里修掉的"门形同虚设"（见 level.js 与 L3 用例的注释）。
    // 第二个门放在 x=60：原计划的 x=30 会在第一段循环（4 s ≈ x=41.5）里被越过，
    // 于是"过第一个门应为 ship"必然看到 cube——门要放在第一段跑完之后才够得到。
    objects: [{ x: 10, y: 0.5, t: 'portal_ship' }, { x: 60, y: 0.5, t: 'portal_cube' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'cube', speed: 1 }]
  });
  st.y = 1;
  for (var i = 0; i < 240 * 4 && st.alive; i++) { GD_Physics.step(st, false); st.y = Math.max(st.y, 0); }
  GD_ASSERT.ok(st.mode === 'ship', '过第一个门应为 ship，实为 ' + st.mode);
  for (var j = 0; j < 240 * 3 && st.alive; j++) GD_Physics.step(st, false);
  GD_ASSERT.ok(st.mode === 'cube', '过第二个门应回 cube，实为 ' + st.mode);

  // 高空飞过回方块门也必须切成 cube：门的触发框要覆盖整条航道
  var hi = GD_Physics.create({
    objects: [{ x: 10, y: 0.5, t: 'portal_cube' }],
    meta: { endBlock: 100000 },
    // 段落的 mode 写 ship：这两个子场景里玩家是在**飞船**模式下飞过回方块门，
    // 若写成 cube，玩家一旦死亡重开就会变成 cube，"高空飞过也应切成 cube"就假绿了。
    segments: [{ from: 0, to: 100, mode: 'ship', speed: 1 }]
  });
  hi.mode = 'ship'; hi.y = 9; hi.vy = 0;
  for (var k = 0; k < 240 * 3 && hi.alive && hi.mode === 'ship'; k++) {
    hi.y = 9; hi.vy = 0;            // 把飞船悬停在 y=9（远高于旧门框的 3.1），模拟"飞到高处再过门"
    GD_Physics.step(hi, false);
  }
  GD_ASSERT.ok(hi.mode === 'cube',
    '高空飞过回方块门也应切成 cube，实为 ' + hi.mode + '（y=' + hi.y.toFixed(2) + '）');

  // 悬在半空的门不能被贴地玩家吃到：触发框的底边就是门的底边（o.y），
  // 不能改成 0——那样"这一层高度的门"就变成"整根柱子都触发"，语义就错了。
  var air = GD_Physics.create({
    objects: [{ x: 10, y: 6, t: 'portal_ship' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'cube', speed: 1 }]
  });
  for (var a = 0; a < 240 * 3 && air.alive; a++) GD_Physics.step(air, false);
  GD_ASSERT.ok(air.mode === 'cube',
    '悬在半空的门不该被贴地玩家触发，实为 ' + air.mode + '（x=' + air.x.toFixed(2) + '）');

  // 速度门与传送门走同一条路径（不按门型特判）：高空飞过 speed_2x 门也必须变速。
  // 只钉 GATE_H 常量不够——把 speed 分支单独改回 2.6 高的变异会全绿通过。
  var spd = GD_Physics.create({
    objects: [{ x: 10, y: 0.5, t: 'speed_2x' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'ship', speed: 1 }]
  });
  spd.mode = 'ship'; spd.y = 5; spd.vy = 0;
  for (var sp = 0; sp < 240 * 3 && spd.alive; sp++) { spd.y = 5; spd.vy = 0; GD_Physics.step(spd, false); }
  GD_ASSERT.ok(spd.speedKey === 2, '高空飞过 speed_2x 门也应变速到 2x，实为 ' + spd.speedKey);

  // 切回方块的那一刻，"在地面 ⇒ vy==0"必须成立（handoff 缺陷清单第 1 条）
  var g = GD_Physics.create({
    objects: [{ x: 10, y: 0.5, t: 'portal_cube' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'ship', speed: 1 }]
  });
  g.mode = 'ship'; g.y = 0.2; g.vy = 16;    // 贴着地面、正要往上冲的飞船
  for (var k2 = 0; k2 < 240 * 3 && g.alive; k2++) {
    if (g.mode === 'ship') { g.y = 0.2; g.vy = 16; }   // 钉住这个状态直到进门
    GD_Physics.step(g, false);
    if (g.mode === 'cube') break;                       // 刚切回来的那一瞬间
  }
  GD_ASSERT.ok(g.mode === 'cube', '贴地过回方块门应切成 cube，实为 ' + g.mode);
  // 这条是**护栏**：当前恒真（onGround 会被 collide() 尾部的落地判定改回 false），
  // 拦不住真正的症状。留着是为了万一哪天真的"在地面却带着 vy"，标签能一眼看出
  // 这是有意保留的检查，而不是忘了删的废断言。
  GD_ASSERT.ok(!(g.onGround && g.vy !== 0),
    '切回方块后若在地面，vy 必须为 0（当前恒真，见上方注释：onGround 会被 collide() 尾部改回 false）实为 vy=' + g.vy + ' onGround=' + g.onGround);
  // 上面那条恒真，拦不住真正的症状——飞船残余的 vy 被带进方块模式，
  // 方块会再往上飞一截。改成直接钉住 vy：
  GD_ASSERT.near(g.vy, 0, 1e-9, '切回方块那一刻 vy 必须归零（修复前实测 15.77）');
  // 行为层面：切回方块后不该继续上升（修复前从 y=0.266 被顶到 1.3475，修复后落回地面）
  var ySwitch = g.y, peak = g.y;
  for (var m = 0; m < 240; m++) {
    GD_Physics.step(g, false);
    if (g.y > peak) peak = g.y;
  }
  GD_ASSERT.ok(peak <= ySwitch + 1e-9,
    '切回方块后不应被飞船残余速度顶上天，实测峰值 ' + peak.toFixed(4) +
    '（切回时 y=' + ySwitch.toFixed(4) + '）');

  // 空中切回方块必须**保留**上升速度：把 vy 无条件清零（连空中也清）会让
  // ship→cube 的转换变成"凭空掉下来"。这里只钉"不被清成 0"，不钉具体数值——
  // 手感数值留给 Task 13 校准，本条只钉"地面清 / 空中不清"这个分支区别。
  var air2 = GD_Physics.create({
    objects: [{ x: 10, y: 0.5, t: 'portal_cube' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'ship', speed: 1 }]
  });
  air2.mode = 'ship'; air2.y = 5; air2.vy = 16;
  for (var n2 = 0; n2 < 240 * 3 && air2.alive; n2++) {
    if (air2.mode === 'ship') { air2.y = 5; air2.vy = 16; }
    GD_Physics.step(air2, false);
    if (air2.mode === 'cube') break;
  }
  GD_ASSERT.ok(air2.mode === 'cube', '高空过回方块门应切成 cube，实为 ' + air2.mode);
  GD_ASSERT.ok(air2.vy > 0, '空中切回方块应保留上升速度（vy>0），实为 vy=' + air2.vy);

  // 门框必须盖得住"飞船段内能爬到的高度"：玩家从切船门起一直按住，
  // 理论上能爬到 (252.5−111.5)/10.386 × 16 ≈ 217 格（按最慢的 1x 算），
  // GATE_H = 256 盖得住。关卡只放两扇门（飞船段的柱阵会把玩家撞死，
  // 这里要的是"纯爬升上界"），门的 x 从真实关卡里读——关卡长度改了，这个界会跟着动。
  var lvGates = GD_Level.crossbeat.objects.filter(function (o) {
    return o.t === 'portal_ship' || o.t === 'portal_cube';
  });
  var shipGate = lvGates.filter(function (o) { return o.t === 'portal_ship'; })[0];
  var cubeGate = lvGates.filter(function (o) { return o.t === 'portal_cube'; })[0];
  var climb = GD_Physics.create({
    objects: [{ x: shipGate.x, y: shipGate.y, t: 'portal_ship' },
              { x: cubeGate.x, y: cubeGate.y, t: 'portal_cube' }],
    meta: { endBlock: 1e9 },
    segments: [{ from: 0, to: 1e9, mode: 'ship', speed: 1 }]
  });
  climb.mode = 'ship'; climb.speedKey = 1;      // 按最慢的 1x 算 = 爬升时间的上界
  climb.x = shipGate.x - 0.5; climb.y = 0; climb.vy = 0; climb.onGround = false;
  var maxY = 0;
  for (var cl = 0; cl < 240 * 40 && climb.alive && climb.x < cubeGate.x - 0.5; cl++) {
    GD_Physics.step(climb, true);               // 一直按住
    if (climb.y > maxY) maxY = climb.y;
  }
  GD_ASSERT.ok(maxY < C.HIT.GATE_H,
    '按住不放时飞船段内爬到的高度必须仍在门框内，实测 ' + maxY.toFixed(2) +
    '（门框上沿 ' + (cubeGate.y + C.HIT.GATE_H).toFixed(1) + '）');
});
```

计划初稿有三处与实测对不上，已按实测改（理由都写在代码注释里）：

1. **T4 的起点是 `st.y = 50` 而不是 5**：飞船碰到地面会被钳成 `y=0, vy=0`
   （`stepShip` 的 `if (st.y < GROUND)`），落在地上的飞船根本测不出 −19.2 的下限钳位——
   实测从 y=5 松手 2 秒，`vy = 0`。2 秒最多下坠 35.25 格（y=50 → 14.749），50 格留足余量。
2. **T4c 的第二个门从 x=30 挪到 x=60**：第一段循环跑 4 秒（1x ≈ x=41.5），
   x=30 的门在第一段里就被越过了，"过第一个门应为 ship"必然看到 cube。
3. **T4c 的两个门都贴地（y=0.5，第二个门原来写的是 y=1）**：飞船落到地面后框是 `[0,1]`，
   而门框从 `o.y` 往上，y=1 的门框 `[1, …]` 与玩家框只在边界相接（`overlap` 用严格不等号）→ 永远不触发。
   这正是 035e7be 在关卡里修掉的"门形同虚设"。

- [ ] **Step 2: 跑测试**

预期：`T4` 通过（Task 2 已实现 `stepShip`），`pass: 16, fail: 0, registered: 16, runErrors: []`。
`loadErrors` 只剩 `replay.js` / `replay.test.js` 两条 404（Task 12 之前属预期）。

**`T4c` 若报 `Cannot read properties of undefined (reading '0')`，不要给 `respawn()` 加回退默认值**——
那是 Task 2 自查记录第 11 条刚刚拆掉的静默坑（`segments` 缺失或拼错时悄悄退回 cube/1x，任何测试都不会红）。
正确做法是让**测试自己传的关卡**带上非空 `segments`（Step 3 已经补上）。

关卡合法性由 Task 5 的 `GD_Level.validate()` 在装载时把关（spec §11.4：校验只放在真实边界上），物理层内部不做防御。

- [ ] **Step 3: 补测试关卡的 segments**

把 T4 / T4b / T4c 里所有 `GD_Physics.create({ objects: ..., meta: ... })` 都补上 `segments`，字段值与该用例要测的模式一致
（`T4c` 里两个飞在门上的子场景用 `mode: 'ship'`：写成 `cube` 的话，玩家一旦死亡重开就会变成 cube，
"高空飞过回方块门也应切成 cube"就假绿了）。跑测试直到 `pass: 16`。

- [ ] **Step 4: 跑测试确认通过**

预期：`pass: 16, fail: 0, registered: 16, runErrors: []`。

- [ ] **Step 5: 关掉两个已排期的传送门缺陷**

这两个都属于"传送门切换"，放在本任务做，不要拖到 Task 13：

1. **传送门/速度门的触发框必须通高。** 现在的触发框是 `1.4 × 2.6` 格（`CONST.HIT.GATE_W/GATE_H`），
   而飞船段出口的净空带是 **y∈[4,9]**（15 列通道逐列算出来的）。玩家若在出口一直按住（y>3.1）就会**错过回方块门**：
   实测他仍以飞船模式撞死在 x=264 的第一根尖刺，或者干脆以 2x 飞过整个收尾段直接通关——后者等于把这一关最花心思的收尾白送。
   飞船段 118–254 的那 15 根柱子**根本没有天花板**（实测 y≥11 以上全程无碰撞），玩家可以飞到关卡的任何高度。

   **做法**：`CONST.HIT.GATE_H` 从 `2.6` 改成 **256**，触发框仍是
   `{ x0: o.x, x1: o.x + GATE_W, y0: o.y, y1: o.y + GATE_H }`——**从门的底边往上延伸**；
   `portal_ship` / `portal_cube` / `speed_*` 走同一条路径，**不按门型特判**。
   **高度不是拍脑袋来的**：飞船爬升被 `CONST.SHIP.CAP_UP` 钳在 16 格/s；玩家在切船门 x=111.5 时还贴着地面（y≈0），
   到回方块门 x=252.5 最多有 (252.5−111.5)/10.386 = 13.6 s（按最慢的 1x 算）→ 最多爬 **217 格**，256 盖得住（余量约 39 格）。
   **24 盖不住**：实测从 x=111.5 起按住不放，x=252.4 时 y=177.83，两扇门（框 `[0.5,24.5]`）都够不着，
   玩家以飞船 2x 直接飞过整个收尾段通关。
   `T4c` 里有一条断言把这个界钉住：**按住不放时飞船段内能爬到的高度必须仍在门框内**
   （实测 1x 最坏情况爬到 y=215.75，门框上沿 256.5，余量 40.75 格；关卡长度或飞船速度上限变了它会自己报警）。

   **这不是"飞到多高都不会错过"**：关卡的飞船段没有封顶，玩家理论上还能飞到 y≥256.5 错过门——
   那个洞记在 spec §13（要靠关卡封顶解决，不是靠门框）。
   **门的 `o.y` 仍然有意义**：框的**底边**就是门的底边，所以地面上的玩家（框 `[0,1]`）能吃到 y=0.5 的门
   （框 `[0.5, 256.5]`，`1 > 0.5` 成立）。**不要**把框的底边也改成 0——那会让悬在半空的门被地面玩家触发，语义就错了。
   `T4c` 里有一条断言专门钉这一条：`portal_ship` 放在 y=6 时，贴地玩家必须**不**被切成 ship。
   还有一条钉"**速度门同样通高**"（不按门型特判）：高空飞过 `speed_2x` 门必须变速到 2x——
   只钉 `GATE_H` 常量不够，把 speed 分支单独改回 2.6 高的变异会全绿通过。

   **留给 Task 9（渲染层）**：门变高之后不能还画成 2.6 格高的小椭圆门——`render.js` 的 `portal()`
   要把它画成一根**通高门柱**（从门底一直画到画面顶，或至少画满 `CONST.HIT.GATE_H` 格），
   否则画面上玩家看得见自己"飞过"了一根矮门柱，判定却生效了。

2. **`portal_cube` 置 `onGround = true` 时必须清 `vy`。** 现在 `st.onGround = st.y <= GROUND + CONST.LAND_TOL;`
   之后没清 `vy`，破坏了"在地面 ⇒ `vy == 0`"这条不变式——而自查记录第 15 条的台沿自由落体分支正依赖它：
   飞船残余的 `vy` 带进方块模式会多飞一下（handoff 缺陷清单第 1 条）。
   **做法**：置 `onGround = true` 的同时把 `vy` 清零；`onGround` 为假时**保留**船的 `vy`
   （切换只换操作方式，不该凭空吃掉玩家上升的动量；空中保留并不消除"多飞一下"，
   那是方块模式本来的跳跃弧线，留 Task 13 手感校准）。这条是**自定语义**，记进 spec §13。

   在 `T4c` 里补断言（**不新增用例，计数仍是 16**）。下面这段已经并进 Step 1 的 `T4c` 用例里，
   这里再列一遍是为了讲清楚它为什么这么写：

```js
  // 高空飞过回方块门也必须切成 cube：门的触发框要覆盖整条航道
  var hi = GD_Physics.create({
    objects: [{ x: 10, y: 0.5, t: 'portal_cube' }],
    meta: { endBlock: 100000 },
    // 段落的 mode 写 ship：这两个子场景里玩家是在**飞船**模式下飞过回方块门，
    // 若写成 cube，玩家一旦死亡重开就会变成 cube，"高空飞过也应切成 cube"就假绿了。
    segments: [{ from: 0, to: 100, mode: 'ship', speed: 1 }]
  });
  hi.mode = 'ship'; hi.y = 9; hi.vy = 0;
  for (var k = 0; k < 240 * 3 && hi.alive && hi.mode === 'ship'; k++) {
    hi.y = 9; hi.vy = 0;            // 把飞船悬停在 y=9（远高于旧门框的 3.1），模拟"飞到高处再过门"
    GD_Physics.step(hi, false);
  }
  GD_ASSERT.ok(hi.mode === 'cube',
    '高空飞过回方块门也应切成 cube，实为 ' + hi.mode + '（y=' + hi.y.toFixed(2) + '）');

  // 悬在半空的门不能被贴地玩家吃到：触发框的底边就是门的底边（o.y），
  // 不能改成 0——那样"这一层高度的门"就变成"整根柱子都触发"，语义就错了。
  var air = GD_Physics.create({
    objects: [{ x: 10, y: 6, t: 'portal_ship' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'cube', speed: 1 }]
  });
  for (var a = 0; a < 240 * 3 && air.alive; a++) GD_Physics.step(air, false);
  GD_ASSERT.ok(air.mode === 'cube',
    '悬在半空的门不该被贴地玩家触发，实为 ' + air.mode + '（x=' + air.x.toFixed(2) + '）');

  // 速度门与传送门走同一条路径（不按门型特判）：高空飞过 speed_2x 门也必须变速。
  // 只钉 GATE_H 常量不够——把 speed 分支单独改回 2.6 高的变异会全绿通过。
  var spd = GD_Physics.create({
    objects: [{ x: 10, y: 0.5, t: 'speed_2x' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'ship', speed: 1 }]
  });
  spd.mode = 'ship'; spd.y = 5; spd.vy = 0;
  for (var sp = 0; sp < 240 * 3 && spd.alive; sp++) { spd.y = 5; spd.vy = 0; GD_Physics.step(spd, false); }
  GD_ASSERT.ok(spd.speedKey === 2, '高空飞过 speed_2x 门也应变速到 2x，实为 ' + spd.speedKey);

  // 切回方块的那一刻，"在地面 ⇒ vy==0"必须成立（handoff 缺陷清单第 1 条）
  var g = GD_Physics.create({
    objects: [{ x: 10, y: 0.5, t: 'portal_cube' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'ship', speed: 1 }]
  });
  g.mode = 'ship'; g.y = 0.2; g.vy = 16;    // 贴着地面、正要往上冲的飞船
  for (var k2 = 0; k2 < 240 * 3 && g.alive; k2++) {
    if (g.mode === 'ship') { g.y = 0.2; g.vy = 16; }   // 钉住这个状态直到进门
    GD_Physics.step(g, false);
    if (g.mode === 'cube') break;                       // 刚切回来的那一瞬间
  }
  GD_ASSERT.ok(g.mode === 'cube', '贴地过回方块门应切成 cube，实为 ' + g.mode);
  // 这条是**护栏**：当前恒真（onGround 会被 collide() 尾部的落地判定改回 false），
  // 拦不住真正的症状。留着是为了万一哪天真的"在地面却带着 vy"，标签能一眼看出
  // 这是有意保留的检查，而不是忘了删的废断言。
  GD_ASSERT.ok(!(g.onGround && g.vy !== 0),
    '切回方块后若在地面，vy 必须为 0（当前恒真，见上方注释：onGround 会被 collide() 尾部改回 false）实为 vy=' + g.vy + ' onGround=' + g.onGround);
  // 上面那条恒真，拦不住真正的症状——飞船残余的 vy 被带进方块模式，
  // 方块会再往上飞一截。改成直接钉住 vy：
  GD_ASSERT.near(g.vy, 0, 1e-9, '切回方块那一刻 vy 必须归零（修复前实测 15.77）');
  // 行为层面：切回方块后不该继续上升（修复前从 y=0.266 被顶到 1.3475，修复后落回地面）
  var ySwitch = g.y, peak = g.y;
  for (var m = 0; m < 240; m++) {
    GD_Physics.step(g, false);
    if (g.y > peak) peak = g.y;
  }
  GD_ASSERT.ok(peak <= ySwitch + 1e-9,
    '切回方块后不应被飞船残余速度顶上天，实测峰值 ' + peak.toFixed(4) +
    '（切回时 y=' + ySwitch.toFixed(4) + '）');

  // 空中切回方块必须**保留**上升速度：把 vy 无条件清零（连空中也清）会让
  // ship→cube 的转换变成"凭空掉下来"。这里只钉"不被清成 0"，不钉具体数值——
  // 手感数值留给 Task 13 校准，本条只钉"地面清 / 空中不清"这个分支区别。
  var air2 = GD_Physics.create({
    objects: [{ x: 10, y: 0.5, t: 'portal_cube' }],
    meta: { endBlock: 100000 },
    segments: [{ from: 0, to: 100, mode: 'ship', speed: 1 }]
  });
  air2.mode = 'ship'; air2.y = 5; air2.vy = 16;
  for (var n2 = 0; n2 < 240 * 3 && air2.alive; n2++) {
    if (air2.mode === 'ship') { air2.y = 5; air2.vy = 16; }
    GD_Physics.step(air2, false);
    if (air2.mode === 'cube') break;
  }
  GD_ASSERT.ok(air2.mode === 'cube', '高空过回方块门应切成 cube，实为 ' + air2.mode);
  GD_ASSERT.ok(air2.vy > 0, '空中切回方块应保留上升速度（vy>0），实为 vy=' + air2.vy);

  // 门框必须盖得住"飞船段内能爬到的高度"：玩家从切船门起一直按住，
  // 理论上能爬到 (252.5−111.5)/10.386 × 16 ≈ 217 格（按最慢的 1x 算），
  // GATE_H = 256 盖得住。关卡只放两扇门（飞船段的柱阵会把玩家撞死，
  // 这里要的是"纯爬升上界"），门的 x 从真实关卡里读——关卡长度改了，这个界会跟着动。
  var lvGates = GD_Level.crossbeat.objects.filter(function (o) {
    return o.t === 'portal_ship' || o.t === 'portal_cube';
  });
  var shipGate = lvGates.filter(function (o) { return o.t === 'portal_ship'; })[0];
  var cubeGate = lvGates.filter(function (o) { return o.t === 'portal_cube'; })[0];
  var climb = GD_Physics.create({
    objects: [{ x: shipGate.x, y: shipGate.y, t: 'portal_ship' },
              { x: cubeGate.x, y: cubeGate.y, t: 'portal_cube' }],
    meta: { endBlock: 1e9 },
    segments: [{ from: 0, to: 1e9, mode: 'ship', speed: 1 }]
  });
  climb.mode = 'ship'; climb.speedKey = 1;      // 按最慢的 1x 算 = 爬升时间的上界
  climb.x = shipGate.x - 0.5; climb.y = 0; climb.vy = 0; climb.onGround = false;
  var maxY = 0;
  for (var cl = 0; cl < 240 * 40 && climb.alive && climb.x < cubeGate.x - 0.5; cl++) {
    GD_Physics.step(climb, true);               // 一直按住
    if (climb.y > maxY) maxY = climb.y;
  }
  GD_ASSERT.ok(maxY < C.HIT.GATE_H,
    '按住不放时飞船段内爬到的高度必须仍在门框内，实测 ' + maxY.toFixed(2) +
    '（门框上沿 ' + (cubeGate.y + C.HIT.GATE_H).toFixed(1) + '）');
```

   实测：切回方块那一刻玩家在 y=0.2662、修复前 `vy = 15.77`，方块被顶到 y=1.3475（多飞 1.08 格）；
   修复后 `vy = 0`，方块落回地面。空中切回（y=5）则**保留** `vy = 15.77`。
   计划原版那条 `!(onGround && vy !== 0)` **实测恒真**（`collide()` 尾部的落地判定会把 `onGround`
   改回 false——玩家在 y=0.266 > 地面 0），拦不住真正的症状，所以另加了两条有牙齿的：
   `near(g.vy, 0, 1e-9)` 与"切回后峰值不高于切回时的高度"；再加一条钉"空中不清"：
   `ok(air2.vy > 0)`——只钉分支区别，不钉具体数值（手感数值留给 Task 13）。

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git add physics.js level.js tests docs/superpowers/plans/2026-11-01-geometry-dash-clone.md && git commit -m "feat: 飞船模式与传送门切换，门的触发框改成通高

飞船段没有天花板，门只有 2.6 格高就等于飞到别的高度就永远切不回方块模式：
玩家在出口一直按住会错过回方块门，要么撞死在 x=264 的第一根尖刺，
要么以 2x 飞过整个收尾段直接通关。门框改成从底边往上 256 格的通高框，
高度按可推导的上界取（飞船段内最多爬 217 格），底边仍是门的 y，
悬在半空的门不会被地面玩家触发。

切回方块时若判定为站在地面上，必须同时清零 vy：在地面 ⇒ vy==0 是不变式，
飞船残余的 vy 带进方块模式会让方块多飞一下；空中则保留 vy，不凭空吃掉动量。"
```

---

## Task 8: 随机稳定性（T6）与架构约束（D1）

**Files:**
- Modify: `tests/physics.test.js`（追加 T6 / T6b / D1 / T5d）
- Modify: `tests/assert.js`（追加 `SOURCES` 预取）
- Modify: `tests/harness.html`（末尾脚本改为等预取完成再 run，`expect_tests` 涨到 20）
- Modify: `physics.js`（Step 3：`collide()` 的玩家框每轮重算）

- [ ] **Step 1: 写测试**

追加 T6 / T6b / D1 / T5d 四条到 `tests/physics.test.js`：

```js
GD_ASSERT.test('T6 随机输入 3000 步无异常无 NaN', function () {
  var seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  var st = GD_Physics.create(GD_Level.crossbeat);
  for (var i = 0; i < 3000; i++) {
    GD_Physics.step(st, rnd() < 0.35);
    if (!isFinite(st.x) || !isFinite(st.y) || !isFinite(st.vy)) {
      throw new Error('NaN/Inf @step ' + i + ' x=' + st.x + ' y=' + st.y + ' vy=' + st.vy);
    }
    if (st.y < -0.001) throw new Error('穿地 @step ' + i + ' y=' + st.y);
    if (st.percent < 0 || st.percent > 100) throw new Error('percent 越界: ' + st.percent);
  }
  GD_ASSERT.ok(true);
});

GD_ASSERT.test('T6b 死亡重开 20 次状态干净', function () {
  var st = GD_Physics.create(GD_Level.crossbeat);
  var seg0 = st.level.segments[0];
  // 一直不按必然撞刺；撞死后 DEATH_DELAY 步就自动重开一次（实测一个循环 558 步）。
  // 断言必须在**刚重开**的那一刻取状态：死亡延时期间 st.x 还停在死亡点。
  // 计划原版在固定 14400 步之后取样，而那个窗口实测正好落在死亡延时里
  // （alive=false、deadTimer=0.45、x=13.76145=死亡点），于是 near(st.x, 0, 12) 必然红——
  // 那不是 respawn() 漏字段，是取样时机不对（逐字段体检见下：刚重开时状态全干净）。
  // 改成按重开次数取样，断言反而更严：每次重开的当刻都要逐字段干净。
  var respawns = 0, steps = 0, guard = 240 * 60 * 3, dirty = [];
  while (respawns < 20 && steps < guard) {
    var before = st.attempt;
    while (st.attempt === before && steps < guard) { GD_Physics.step(st, false); steps++; }
    if (st.attempt === before) break;              // 没等到重开：不该发生，报在下面
    respawns++;
    // 逐字段对照 create()：重开后的状态必须干净（漏清一个字段就记下来）
    var bad = [];
    if (st.x !== 0) bad.push('x=' + st.x);
    if (st.y !== 0) bad.push('y=' + st.y);
    if (st.vy !== 0) bad.push('vy=' + st.vy);
    if (st.rot !== 0) bad.push('rot=' + st.rot);
    if (st.percent !== 0) bad.push('percent=' + st.percent);
    if (st.time !== 0) bad.push('time=' + st.time);
    if (st.deadTimer !== 0) bad.push('deadTimer=' + st.deadTimer);
    if (!st.alive) bad.push('alive=false');
    if (st.finished) bad.push('finished=true');
    if (!st.onGround) bad.push('onGround=false');
    if (st.mode !== seg0.mode) bad.push('mode=' + st.mode);
    if (st.speedKey !== seg0.speed) bad.push('speedKey=' + st.speedKey);
    if (Object.keys(st.used).length !== 0) bad.push('used=' + Object.keys(st.used).length);
    if (bad.length) dirty.push('第 ' + respawns + ' 次重开: ' + bad.join(','));
  }
  GD_ASSERT.ok(respawns >= 20, '应至少重开 20 次，实得 ' + respawns + ' 次（' + steps + ' 步）');
  GD_ASSERT.ok(st.attempt >= 21, 'attempt 应随重开累加（起于 1），实为 ' + st.attempt);
  GD_ASSERT.ok(dirty.length === 0, '重开后状态不干净: ' + dirty.join(' | '));
});

// spec §5 的架构约束：physics.js 不得引用渲染/输入/音频/HUD。
// 这条不是洁癖——它保证物理能在 harness.html 里不加载任何渲染代码就被驱动到任意时刻。
GD_ASSERT.test('D1 physics.js 不依赖渲染层', function () {
  var src = GD_ASSERT.SOURCES['physics.js'];
  GD_ASSERT.ok(src !== undefined, '需要 harness 预取的源码字符串');
  ['GD_Render', 'GD_Hud', 'GD_Audio', 'GD_Input', 'document.', 'window.addEventListener',
   'requestAnimationFrame', 'canvas'].forEach(function (bad) {
    GD_ASSERT.ok(src.indexOf(bad) < 0, 'physics.js 不应出现 ' + bad);
  });
});

// handoff 缺陷清单第 5 条：方块落地判定里的 `st.vy <= 0` 此前**零覆盖**
// （实测把它去掉，16 条断言照样全绿）。这个条件是"上升中撞墙 = 死"的唯一保证：
// 去掉它，玩家上升中撞到方块侧面会被当成落地，吸到方块顶上——撞墙就不算撞墙了。
// 本用例把这个条件钉住。
// （注意：本用例的场景里玩家**照样会死**，只是死之前被吸到了柱顶——
// 所以光断"死了"抓不住这个变异，必须连位置与 vy 一起断，见下面的注释。）
GD_ASSERT.test('T5d 上升中撞墙应致死（落地判定的 vy<=0 护栏）', function () {
  var C = GD_Physics.CONST, dt = C.DT;
  // 场景：玩家在 2 格柱旁**上升中**撞进柱子（x=6 的 y=0 与 y=1 两格）。
  // 起点取 y=0.9：正好落在"落地吸附容差"之内（top-0.33=0.67 < 0.9），
  // 所以只要落地判定里的 vy<=0 被去掉，玩家就会被吸到柱顶（y=1）而不是撞死。
  // 正确实现下玩家是**撞死**的：缩小核心框（0.3×0.3，中心在玩家腰高 1.4）
  // 与柱顶那一格的核心框（中心 1.5）重叠 → 死。
  function riseInto(objs) {
    var st = GD_Physics.create(LV(objs));
    st.x = 6.5; st.y = 0.9; st.vy = 10; st.onGround = false;
    GD_Physics.step(st, false);
    return st;
  }
  var hit = riseInto([{ x: 6, y: 0, t: 'block' }, { x: 6, y: 1, t: 'block' }]);
  GD_ASSERT.ok(!hit.alive, '上升中撞进方块必须死亡，实得 alive=' + hit.alive + ' y=' + hit.y);
  // 关键在"没被吸到方块顶上"：落地分支一旦触发，st.y 会被改成 top(=1) 且 vy 清零。
  // 只断"死了"抓不住这个变异——去掉 vy<=0 之后玩家**照样死**（死在柱顶那一格），
  // 区别只在死之前被吸到了 y=1、vy=0。所以位置与 vy 必须一起钉。
  GD_ASSERT.near(hit.y, 0.9 + 10 * dt - 0.5 * C.G * dt * dt, 1e-9,
    '撞死时的 y 应保持撞上去那一刻的值（没被吸到柱顶 1），实为 ' + hit.y);
  GD_ASSERT.ok(hit.vy > 0, '撞死时 vy 仍应为正（落地分支会把 vy 清零），实为 ' + hit.vy);
  // 对照组：同样的起点，关卡里没有方块 → 不该死，而且要继续上升。
  var ctl = riseInto([]);
  GD_ASSERT.ok(ctl.alive, '没有方块时不该死');
  GD_ASSERT.ok(ctl.y > 0.9, '没有方块时应继续上升，实得 y=' + ctl.y);

  // 反面：下落中踩到方块顶必须仍然是"落地"（不是撞墙）。
  // 玩家从 y=1.2、vy=-8 落到 1 格方块顶上：脚越过顶面之后落地分支接管，
  // st.y 被吸到 1、vy 清零、onGround 变真。
  var fall = GD_Physics.create(LV([{ x: 6, y: 0, t: 'block' }]));
  fall.x = 6.5; fall.y = 1.2; fall.vy = -8; fall.onGround = false;
  var n = 0;
  while (!fall.onGround && n++ < 240) GD_Physics.step(fall, false);
  GD_ASSERT.ok(fall.alive, '下落中踩到方块顶不该死');
  GD_ASSERT.near(fall.y, 1, 1e-9, '应被吸到方块顶 y=1，实为 ' + fall.y);
  GD_ASSERT.near(fall.vy, 0, 1e-9, '落地后 vy 应为 0，实为 ' + fall.vy);
});
```

T5d 是 handoff 缺陷清单第 5 条要求的补丁：方块落地判定里的 `st.vy <= 0` 此前**零覆盖**
（实测把它去掉，全部断言照样绿），必须补一条"上升中撞墙应致死"的断言把它钉住。

`tests/assert.js` 需要加源码预取（Task 1 已建文件，本步补上）：

```js
GD_ASSERT.SOURCES = {};
(function () {
  var files = ['../physics.js', '../level.js', '../render.js', '../hud.js', '../input.js', '../audio.js'];
  files.forEach(function (f) {
    fetch(f).then(function (r) { return r.text(); })
      .then(function (t) { GD_ASSERT.SOURCES[f.replace('../', '')] = t; });
  });
})();
```

`harness.html` 的 `GD_ASSERT.run()` 调用前需等预取完成——把末尾脚本改为（`expect_tests` 涨到 20，且必须在 `run()` **之前**调用，所以它落在轮询循环里 `run()` 的那一行上面，不是循环外面）：

```js
  var waited = 0;
  (function wait() {
    if (Object.keys(GD_ASSERT.SOURCES).length >= 6 || waited > 40) {
      GD_ASSERT.expect_tests(20);
      var res = GD_ASSERT.run();
      res.loadErrors = window.__LOAD_ERRORS__ || [];
      res.runErrors = window.__RUN_ERRORS__ || [];
      res.sources = Object.keys(GD_ASSERT.SOURCES);
      document.getElementById('out').textContent = JSON.stringify(res, null, 1);
      return;
    }
    waited++; setTimeout(wait, 25);
  })();
```

- [ ] **Step 2: 跑测试确认通过**

预期：`pass: 20, fail: 0, registered: 20, runErrors: []`。

**T6b 与计划原版的偏差（2026-11-08 实测后修正）**：计划原版的 T6b 跑满 `240*60` 步之后取 `st.x`，
并断 `near(st.x, 0, 12)`。实测那个取样点**落在死亡延时里**（`alive=false`、`deadTimer=0.45`、
`x=13.76145`——正是第一根尖刺 x=14 的死亡点，`attempt` 已累到 26），于是断言必然红（13.76 > 12）。
**不是 `respawn()` 漏字段**：刚重开那一刻逐字段体检全干净（x=0、y=0、vy=0、rot=0、percent=0、time=0、
deadTimer=0、onGround=true、mode=cube、speedKey=1、`used` 为空）。改成"每次重开当刻取样"，
断言反而更严（`x` 精确为 0，而不是"离 0 不超过 12 格"）。

`D1` 在此任务时 `render.js`/`hud.js`/`input.js`/`audio.js` 还不存在，预取只会拿到 404 的响应体——
`fetch` 对 404 是 **resolve 不是 reject**，所以 `SOURCES` 里照样有 6 个键，轮询的 `>= 6` 条件能满足；
`waited > 40` 的超时兜底是保险。D1 只检查 `physics.js`，不受影响。

- [ ] **Step 3: 修掉 `collide` 里过期的玩家框（handoff 缺陷清单第 3b 条）**

`collide()` 在进循环前算一次 `pb = playerBox(st)`，循环里却会改 `st.y`（落到方块顶时 `st.y = top`、跳板/跳环触发时改 `st.vy`），之后同一个循环里的尖刺/跳板/传送门判定**仍在用旧框**；而跳环分支偏偏又现算了一个新框——同一帧里存在两套玩家框。

当前关卡触发不到（所有尖刺都在 y=0，落地吸附最多把 y 抬到 `LAND_TOL=0.33`，而尖刺框高 0.55；且块与尖刺最近相距 6 格，超出 `nearby()` 的 ±3 格窗口），所以**这是潜伏缺陷，不是当前 bug**。但只要关卡里出现"离地尖刺"且与落地同帧，就会误判死亡。

修法：玩家框每轮重算（不要跨对象复用），跳环分支也改用同一个 `pb`，一帧里只有一套玩家框。

**改完的三项验收（实测，2026-11-08）**：

1. **关卡可通性扫描**：23 个 cube 障碍组逐组隔离、每组扫 65 个起跳阈值（步数上限 `240*40`）——
   单刺 20/65（x=330 那根 19/65）、双刺 10/65、2 格柱 30/65、`zeroTapGroups: []`，与修复前**逐组相同**。
2. **已验证的通关序列**（`docs/superpowers/research/t12-replay-fixture.js`，用计划 `replay.test.js` 的原样回放循环）：
   `finished=true`、`percent=100`、`time=32.0625 s`、四个切换点 x=111.520 / 115.501 / 252.551 / 253.519，全程无死亡——与修复前**完全相同**。
3. **逐帧对拍**：把修复前的 physics.js（计划 Task 2 的旧块）与磁盘上的新 physics.js 跑同一串输入
   （5 个随机种子 × `240*40` 步 + 通关序列全程），共比对 **55700 帧，差异 0 处**。

> **残留缺口（如实记录）**：这个修复**没有**一条能把它跑红的单元断言。把玩家框退回"进循环前算一次"，
> 20 条断言照样全绿——因为落地吸附最多把玩家框抬高 `LAND_TOL=0.33`，而要看出差别，
> 后续对象的命中框必须落在这 0.33 宽的缝里。尖刺的框高 0.55，要落进这道缝，
> 就得让尖刺的框整个嵌在方块那一格里（关卡里不存在这种构造），所以**当前关卡与任何合理关卡都观察不到它**。
> 它的保护网只有上面三项（可通性扫描 + 通关序列 + 逐帧对拍）。若将来要一条专门的红灯断言，
> 只能写一条"白盒探针"（人为造一个尖刺嵌在方块格里的关卡），那会钉住一条没有物理意义的边界情形，
> 本任务不写。

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git add physics.js tests docs/superpowers/plans/2026-11-01-geometry-dash-clone.md docs/superpowers/HANDOFF-2026-11-08.md && git commit -m "test: 随机输入稳定性、重开清洁度与 physics 层依赖约束

随机输入 3000 步必须无 NaN 不穿地；死亡重开 20 次的状态要逐字段干净——
断言取在**刚重开**的那一刻，计划原版取在固定 14400 步之后，
那个窗口实测落在死亡延时里（x 还是死亡点 13.76），测的不是重开后的状态。

D1 用 fetch 预取的源码做静态断言：physics.js 里不许出现渲染/输入/音频层的任何符号，
这条保证物理能在不加载任何渲染代码的情况下被驱动到任意时刻。

另补 T5d：方块落地判定里的 vy<=0 此前零覆盖，去掉它之后上升中撞墙会被当成落地。
collide 的玩家框改成每轮重算（同一帧不再有两套玩家框），
并用可通性扫描、通关序列与 55700 帧逐帧对拍证明当前关卡上行为不变。"
```

---

## Task 9: 渲染静态场景

**Files:**
- Create: `render.js`
- Create: `tests/visual-smoke.html`（调试页，**留在仓库里**，不是"临时文件"）

渲染层难以做无头断言，本任务的验证方式是**截图对比**（Step 4）。物理正确性已由 T1–T6 保证，这里只验"画面对不对"。

- [ ] **Step 1: 写 render.js**

**门的画法（Task 7 之后新增）**：`physics.js` 的门触发框已经改成**通高**
（`CONST.HIT.GATE_H = 256`，从门底 `o.y` 往上延伸），所以 `portal()` 必须把门画成一根
**通高门柱**（从门底一直画到画面顶），不能还画成 2.6 格高的小椭圆门——
否则画面上玩家看得见自己"飞过"了一根矮门柱，判定却生效了。
具体画法：门柱**底边取 `o.y`**（与触发框底边同一个 y；关卡里的门都在 `y=0.5`，实测 `wy(0.5)=159`），
顶边取 `y=0`（画布顶），宽度 `1.4` 格（与 `CONST.HIT.GATE_W` 一致）。
门的符号（`▲▼` / `■` / `»`）画在离底 **2.5 格**处——门柱是通高的，符号必须钉在看得见的那一段上，
画到门柱顶端就等于画到画面外去了。

**飞船的画法（Task 9 自选）**：spec §8 只规定了**方块模式**的图标（1 格见方、黑外框 + 绿主体 +
两只方眼 + 一条横嘴）。但飞船段占关卡的 1/3（x=118–254），用方块画飞船一眼就是错的
（原版里飞船是三角形），所以这里**自选**画法：飞船模式画 1 格见方、**朝上**的三角形
（黑边 + 绿内芯 + 白描边 + 一只眼），跟着 `st.rot` 一起转，飞船的仰角就自然体现在倾角上。
方块模式的绿色方块图标保持 spec §8 原样。

**纵向相机（Task 9 补做）**：关卡的飞船段通道设计到 y=10，而画布地面线以上只有 **5.8 格**
（`VIS_TOP = GROUND_Y / BLK`；地面线画在 y=174，它上面一共 174px = 5.8 格）——
通道的天花板本来就在画面外；再加上飞船段没有封顶（玩家能飞到 y=46，见 spec §13 第 11 条），
固定相机会让玩家**整个飞出画面**：用仓库里那条已验证的通关序列实测，飞船段 2639 帧里
有 2227 帧（84.4%）玩家的 y 超过 5.8 格，屏幕上什么都没有。
所以渲染层要带**纵向相机**：

- 相机状态是**渲染实例的字段** `r.camY`（跟 `wasAlive` 一样），**不许做成模块级变量**——多实例会串状态。
- **死区式跟随**：玩家相对相机（`st.y - r.camY`）必须落在 `[1.0, VIS_TOP - 1.2]`（= `[1.0, 4.6]`）里，
  超出上界就把相机上滚（`camY = st.y - 4.6`），超出下界就下滚。
  直接令相机等于玩家 y 的话，方块段每跳一下画面就抖一下，所以用死区而不是直接跟随。
- 相机**不许滚到地面线以下**（`camY >= 0`）：方块段的 y 只在 0…2.7，必须**完全不滚**（实测 camY 恒为 0）。
- 所有纵向定位都过相机：`wy()` 变成 `wy(r, blockY)`，世界高度 y 画在 `GROUND_Y - (y - camY) * BLK`
  ——所以相机上滚 `camY` 格时，地面线画在 `GROUND_Y + camY * BLK`（地面往画面下方退，最后从底部出画）。
- 背景三层是"远"，纵向只跟 **0.3 倍**（横向仍是 0.35 / 0.6 / 1.0）；地面色带跟着地面线走，
  否则相机上滚时地面色带会留在原地，和地面线错开。

`render.js`：

```js
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
    return { canvas: canvas, ctx: ctx, parts: [], debris: [], wasAlive: true, camY: 0 };
  }

  function resize(canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var availW = Math.max(320, window.innerWidth - 16);
    var availH = Math.max(180, window.innerHeight - 16);
    var k = Math.max(1, Math.floor(Math.min(availW / LW, availH / LH)));
    canvas.style.width = (LW * k) + 'px';
    canvas.style.height = (LH * k) + 'px';
    canvas.width = Math.round(LW * k * dpr);
    canvas.height = Math.round(LH * k * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    return k;
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
  // 通道的天花板本来就在画面外；再加上飞船段没有封顶（玩家能飞到 y=46，见 spec §13），
  // 固定相机会让玩家**整个飞出画面**，玩家根本看不见自己在哪。
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

  function spike(ctx, r, st, x, y, C) {
    var px = wx(st, x), py = wy(r, y);
    ctx.fillStyle = C.fill; ctx.strokeStyle = '#eaf7ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + BLK, py); ctx.lineTo(px + BLK / 2, py - BLK); ctx.closePath();
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
      else if (o.t === 'spike') spike(ctx, r, st, o.x, o.y, C);
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

  return { create: create, resize: resize, draw: draw, LW: LW, LH: LH, BLK: BLK, GROUND_Y: GROUND_Y };
})();
```

`create()` 的 `wasAlive` 已在上面定义，无需额外处理。

- [ ] **Step 2: 起服务，用一次性调试页截图**

创建 `tests/visual-smoke.html`（**调试用页面，留在仓库里方便 Task 13 手感校准**——
真正的游戏页面 `index.html` 要到 Task 11 才有，这一页在那之前是唯一能单独看渲染结果的办法）：

```html
<!DOCTYPE html><html><head><meta charset="utf-8"><title>visual smoke</title>
<!--
  渲染层冒烟页：跑 N 秒物理后画一帧，用来肉眼核对渲染；不是交付物。

  真正的游戏页面 index.html 要到 Task 11 才有，这一页在那之前是唯一能单独看渲染结果的办法，
  所以**留在仓库里**（不是"临时文件"），Task 13 手感校准还要反复用。
  （Task 12 会把这条通关序列复制成 tests/replay.js；如果 research 那份被删，
    把下面 <script src="../docs/superpowers/research/t12-replay-fixture.js"> 换成 ../tests/replay.js 即可。）

  实现上是一边跑一边画，不是最后画一帧：拖尾是"每次 draw 播一个粒子、0.5 秒渐隐"的，
  只在最后画一帧的话拖尾只剩 1 个粒子，Step 4 的第 7 项（渐隐拖尾）根本核对不出来。

  看哪一帧（静态服务在 http://127.0.0.1:8765/）：
    /tests/visual-smoke.html            默认：跑 3 秒真实物理 → 方块段 x≈31（尖刺、拖尾）
    /tests/visual-smoke.html?t=6        跑到第 6 秒 → 方块段 x≈62（方块柱、跳环）
    /tests/visual-smoke.html?t=9        跑到第 9 秒 → 方块段 x≈93
    /tests/visual-smoke.html?t=10.5     跑到切船门前 → 通高门柱在 x=112、速度门在 x=116
    /tests/visual-smoke.html?t=12       飞船段 x≈127 → 玩家是三角形（纵向相机把它拉回画面里）
    /tests/visual-smoke.html?t=20.8     飞船段 x≈241 → 三角形玩家和柱列 x=238 同框
    /tests/visual-smoke.html?t=21.6     回方块门前 → 通高门柱在 x=253、速度门在 x=254
    /tests/visual-smoke.html?t=28       收尾段 x≈318
    /tests/visual-smoke.html?x=180      直接把玩家放到第 180 格（不跑物理，只看那一段的画面）

  纵向相机：飞船段玩家能飞到 y=46，而画布地面线以上只有 5.8 格——
  没有相机的话玩家整个飞出画面。渲染层用死区式跟随把玩家拉回来，
  所以飞船段的任何一帧（?t=12 那种 y=14 的）都能看见玩家。
-->
<style>body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh}</style>
</head><body><canvas id="c"></canvas>
<script src="../level.js"></script><script src="../physics.js"></script><script src="../render.js"></script>
<!-- 通关按键序列：已验证能把整关打通（docs/superpowers/research/t12-replay-fixture.js）。
     用它驱动物理，才能走到飞船段和门柱那几扇门前；不驱动就只能停在开头几十格。 -->
<script src="../docs/superpowers/research/t12-replay-fixture.js"></script>
<script>
// ?t=秒：跑到关卡的第几秒（默认 3）；?x=格：直接把玩家放到第几格（不跑物理）
var q = new URLSearchParams(window.location.search);
var cv = document.getElementById('c');
var r = GD_Render.create(cv); GD_Render.resize(cv);
var st = GD_Physics.create(GD_Level.crossbeat);
if (q.has('x')) {
  st.x = parseFloat(q.get('x'));
  // 模式必须跟着关卡段落走：直接摆位置不会经过传送门，不然在飞船段也画成方块图标
  var segs = GD_Level.crossbeat.segments;
  for (var i = 0; i < segs.length; i++) {
    if (st.x >= segs[i].from && st.x < segs[i].to) { st.mode = segs[i].mode; st.speedKey = segs[i].speed; }
  }
  GD_Render.draw(r, st, 1 / 60);
} else {
  var tEnd = q.has('t') ? parseFloat(q.get('t')) : 3;
  var seq = GD_Replay.crossbeat, si = 0, held = false;
  for (var n = 0; n < 240 * tEnd; n++) {
    while (si < seq.length && seq[si].t <= st.time) { held = seq[si].d; si++; }
    GD_Physics.step(st, held);
    GD_Render.draw(r, st, 1 / 60);
  }
}
</script></body></html>
```

- [ ] **Step 3: 跑 3 秒物理后截图**

`navigate_page` 到 `http://127.0.0.1:8765/tests/visual-smoke.html`，然后 `take_screenshot`。
冒烟页默认就是"跑 3 秒真实物理并逐帧绘制"；要看别的段就加参数
（`?t=12` 飞船段、`?t=20.8` 飞船段玩家与柱阵同框、`?t=10.5` 切船门、`?t=21.6` 回方块门、
`?x=180` 直接摆位置，全部列在 `tests/visual-smoke.html` 顶部的注释里）。

- [ ] **Step 4: 人工核对截图**

必须看到（缺一项就修 render.js）：

1. 三层蓝色系背景，色块随 x 位移（视差）。
2. 地面线是一条 2px 亮线，离画布底部约 2.2 格，下方是压暗的纵向色带。
3. 尖刺是白描边、内部近黑的等腰三角形，底宽=高=1 格。
4. 方块有顶/左亮带 + 白描边。（`?t=6` 附近能看到方块柱）
5. **方块段**玩家是绿色方块图标，两只方眼 + 一条横嘴，带旋转角。
6. 玩家 x 位置在画布中线偏左（锚点 5.12 格处），不是画布正中。
7. 身后有渐隐的青色拖尾。冒烟页是**逐帧绘制**的，拖尾是完整的一条；
   只在最后画一帧的话拖尾只剩 1 个粒子，这一条根本核对不出来。
8. **传送门是通高门柱**：从门底一直画到画布顶，底边落在 `o.y` 那一行，
   符号（`▲▼` / `■` / `»`）钉在柱身上看得见。
   （`?t=10.5` 看切船门与 2x 速度门，`?t=21.6` 看回方块门与 1x 速度门）
9. **飞船段玩家是三角形**（1 格见方、朝上），不是方块，而且**三角形玩家要和通道的柱阵同框**
   （`?t=20.8`：玩家 y=4.70 在地面线附近，柱列 x=238 在画面里）。
10. **纵向相机跟随**：飞船段玩家始终在画面内——他飞到 y=14（`?t=12`）甚至 y=46 时，
    截图里都要看得见玩家（没有相机时这 84% 的帧玩家整个在画面外）。

- [ ] **Step 5: Commit**

`tests/visual-smoke.html` 是调试页，但**留在仓库里**（Step 2 已改），所以要一起 add。

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git add render.js tests/visual-smoke.html && git commit -m "feat: 渲染层，三层视差背景与自绘同风格素材"
```

---

## Task 10: HUD

**Files:**
- Create: `hud.js`

- [ ] **Step 1: 写 hud.js**

`hud.js`：

```js
window.GD_Hud = (function () {
  var LW = 427, LH = 240;

  function draw(ctx, st, fps) {
    ctx = ctx.ctx !== undefined ? ctx.ctx : ctx;      // 兼容传 render 句柄
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillText(Math.round(fps) + ' FPS', 3, 10);

    // Attempt 跟随世界滚动
    var ax = (2 - st.x) * 30 + 213;
    if (ax > -80 && ax < LW) ctx.fillText('Attempt ' + st.attempt, ax, 170 - 3 * 30);

    // 进度条
    var bw = 340, bx = (LW - bw) / 2, by = LH - 14;
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(bx, by, bw, 7);
    ctx.fillStyle = '#4cd137'; ctx.fillRect(bx, by, bw * st.percent / 100, 7);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 6);
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
```

- [ ] **Step 2: 在 visual-smoke.html 里加上 hud.js 并截图核对**

`navigate_page` 重新加载后 `take_screenshot`。必须看到左上角 FPS、底部居中进度条带百分比数字、开局处 "Attempt 1"。

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git add hud.js tests/visual-smoke.html && git commit -m "feat: HUD，FPS / Attempt / 进度条"
```

---

## Task 11: 输入、音频、装配（双击即玩）

**Files:**
- Create: `input.js`, `audio.js`, `main.js`, `index.html`

- [ ] **Step 1: 写 input.js**

```js
window.GD_Input = (function () {
  var held = false;
  function set(v) { held = v; }
  function create(target) {
    target.addEventListener('pointerdown', function (e) { e.preventDefault(); set(true); });
    window.addEventListener('pointerup', function () { set(false); });
    window.addEventListener('pointercancel', function () { set(false); });
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); set(true); }
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space' || e.key === ' ') set(false);
    });
    window.addEventListener('blur', function () { set(false); });   // 防止回来时飞船一直上升
    document.addEventListener('touchstart', function (e) { e.preventDefault(); set(true); }, { passive: false });
    document.addEventListener('touchend', function () { set(false); }, { passive: true });
    return { get: function () { return held; } };
  }
  return { create: create };
})();
```

- [ ] **Step 2: 写 audio.js**

154 BPM，底鼓 + 军鼓 + 闭镲 + 贝斯，四小节循环。全部振荡器合成，不加载音频文件。

```js
window.GD_Audio = (function () {
  var BPM = 154, SPB = 60 / BPM;      // 0.3896 s，等于一次跳跃的滞空
  var ctx = null, started = false, nextNote = 0, step16 = 0, timer = null;

  var KICK = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0];
  var SNARE = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1];
  var HAT = [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1];
  var BASS = [55,0,0,55, 0,49,0,0, 43,0,0,43, 0,41,0,0];   // A1/F1/G1 附近

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

  function schedule() {
    while (nextNote < ctx.currentTime + 0.15) {
      var i = step16 % 16, t = nextNote;
      if (KICK[i]) hit(t, 120, 0.13, 0.55);
      if (SNARE[i]) noise(t, 0.11, 0.22);
      if (HAT[i]) noise(t, 0.03, i % 2 ? 0.05 : 0.09);
      if (BASS[i]) {
        var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(BASS[i], t);
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
        o.connect(lp); env(lp, t, SPB * 0.45, 0.16); o.start(t); o.stop(t + SPB * 0.5);
      }
      nextNote += SPB / 4; step16++;
    }
  }

  function start() {
    if (started) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      nextNote = ctx.currentTime + 0.05;
      timer = setInterval(schedule, 25);
      started = true;
    } catch (e) { started = false; }   // 失败则静音继续，不阻塞游戏（spec §11.1）
  }
  function stop() { if (timer) clearInterval(timer); if (ctx) ctx.close(); started = false; ctx = null; }

  return { start: start, stop: stop, SPB: SPB, isOn: function () { return started; } };
})();
```

- [ ] **Step 3: 写 main.js**

```js
window.GD_Main = (function () {
  var DT = GD_Physics.CONST.DT, MAX_FRAME = 0.05;   // 切后台钳制（spec §11.2）

  function boot(canvas) {
    var r = GD_Render.create(canvas);
    GD_Render.resize(canvas);
    var st = GD_Physics.create(GD_Level.crossbeat);
    var input = GD_Input.create(canvas);
    var acc = 0, last = performance.now(), fps = 60, fpsAcc = 0, fpsN = 0, booted = false;

    function frame(now) {
      var raw = (now - last) / 1000; last = now;
      var dt = Math.min(raw, MAX_FRAME);
      fpsAcc += raw; fpsN++;
      if (fpsAcc >= 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
      acc += dt;
      var steps = 0;
      while (acc >= DT && steps < Math.round(MAX_FRAME / DT)) { GD_Physics.step(st, input.get()); acc -= DT; steps++; }
      if (steps === Math.round(MAX_FRAME / DT)) acc = 0;      // 抛掉追不上的积压
      GD_Render.draw(r, st, dt);
      GD_Hud.draw(r.ctx, st, fps);
      if (!booted && (st.x > 0 || !st.alive)) { GD_Audio.start(); booted = true; }
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
```

- [ ] **Step 4: 写 index.html**

```html
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crossbeat</title>
<style>
  html,body{margin:0;height:100%;background:#04121f;overflow:hidden}
  body{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;
       font:12px monospace;color:#6b8ba8}
  canvas{image-rendering:pixelated;image-rendering:crisp-edges;touch-action:none}
  #hint{position:fixed;bottom:6px;left:50%;transform:translateX(-50%)}
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="hint">空格 / 点击 = 跳。按住 = 飞船上升</div>
<script src="level.js"></script>
<script src="physics.js"></script>
<script src="render.js"></script>
<script src="hud.js"></script>
<script src="input.js"></script>
<script src="audio.js"></script>
<script src="main.js"></script>
<script>GD_Main.install(document.getElementById('c'));</script>
</body>
</html>
```

- [ ] **Step 5: 验证双击即玩**

先验证 `file://` 路径（这是 spec §14 验收项 2）：用 `mcp__browser-use__navigate_page` 打开
`file:///C:/Users/user/Documents/My%20Games/drgame/index.html`。

然后 `list_console_messages` 取错误，`evaluate_script` 读 `JSON.stringify(window.__GD_TEST__.state())`。

预期：无 console 错误；state 返回 `{x: <正数>, y: 0..2, mode: "cube", speed: 1, alive: true, percent: <0-100>}`。

再 `take_screenshot` 确认画面与 Task 9 一致。

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git add input.js audio.js main.js index.html && git commit -m "feat: 输入、154 BPM 合成音轨与装配，双击即玩"
```

---

## Task 12: 通关机器人（T3）

这是证明关卡人类可通的唯一手段，也是本计划里最可能反复的一任务。

**Files:**
- Create: `tests/replay.js`
- Create: `tests/replay.test.js`
- Modify: `tests/harness.html`（两个 `<script src>` 标签 Task 1 就已写好，本任务只把 `expect_tests` 涨到 20）

### 预研结论（2026-11-08 接手后补做，**先读这段，能省掉一整轮试错**）

已经用机器人把这一关打通过一次了，**关卡本身不需要改**——`level.js` 的 23 个 cube 障碍组逐组实测全部 ≥9/65 个起跳阈值可过，没有死局。下面三条是会改变本任务写法的实测结论：

1. **真实速度剖面是 `1x[0,115.5] / 2x(115.5,253.5] / 1x[253.5,360]`**，不是 segments 的 118/254。
   传送门与速度门在"玩家前沿（x+0.5）碰到门的 x"时才生效，实测切换点：
   `portal_ship@112 → x111.5`、`speed_2x@116 → x115.5`、`portal_cube@253 → x252.5`、`speed_1x@254 → x253.5`。
   朴素的 `x / 10.386` 在 x=254 偏 **+2.62 s**；按段表算也还偏 **+0.047 s**（118 vs 115.5 与 254 vs 253.5 正好抵消），
   而双刺的可通过窗口只有 0.825 格（≈0.079 s）——0.047 s 已经吃掉一大半。
   → 本任务的 `tOf()` **从关卡里的速度门推导档位**（Step 4 的初版代码已经这么写了），别再手写段表。

2. **两个速度门是"隐形杀手"，断言必须加时长与切换点。**
   > **下面这三条是旧门高（2.6 格）下的实测结论。Task 7 起门框通高（`GATE_H = 256`），
   > 速度门与传送门走同一条路径，"必须压低/俯冲"已经变成可选动作——但断言要留着。**
   `speed_2x@116` 的命中框要求飞船在 x115.5–117.4 时 **y<2.1** 才吃得到；漏了 → 全程 1x → **34.66 s**。
   `portal_cube@253` / `speed_1x@254` 要求在 x252.5–255.9 前**俯冲回低处**；漏前者 → 仍是飞船 → 撞死 x=264 的第一根尖刺；
   漏后者 → 后半段跑 2x → **30.05 s**。
   **这两种"假通关"的 `finished` 也是 true**，光断 `finished`/`percent` 会放过它们。
   → Step 1 的断言要加上 `time ∈ [31.36, 32.64]` 和四个切换点。
   **Task 7 之后**：门框通高后 `speed_2x@116` 不再要求 y<2.1，`speed_1x@254` 也不再要求俯冲回低处；
   上面"漏掉 → 34.66 s / 30.05 s"只是**旧门高下的现象记录**，但**断言仍然保留**——
   将来若有人把门高改小，时长断言是唯一的警报。
   （预研测出的那条通关序列在 Task 7 之后**仍然有效**：已复核 `finished=true, percent=100, time=32.0625s`，
   四个切换点一个不差——那条序列本来就在出口处贴地飞，旧门框 `[0.5,3.1]` 就够得着。）

3. **本任务初版草稿里的飞船策略不能用。**
   草稿写的是"每 0.42 s 按 0.22 s"，实测**连第一根柱 126 都过不去**。
   飞船必须**按柱排程**：目标 = 下一根要进入的柱子的带心；先压低吃 2x 门，末尾俯冲吃 253/254 两个门。
   （"先压低吃 2x 门、末尾俯冲"是**旧门高下的必要动作**；Task 7 门框通高后这两步都变成可选动作。）

另外两条记录（不阻塞，但要知道）：

- **飞船段 118–254 根本没有天花板**：实测 `y≥11` 以上全程无碰撞，机器人是从柱阵**顶上**飞过去的。
  （Task 7 之后这个"没天花板"还有个后果：玩家按住不放能爬到 y≈173（2x）/ 216（1x），
  **飞到 y≥256.5 仍会错过回方块门**——通高门框只解决了"通道内/出口附近"这一段，见 spec §13。）
  而且致命判定用 0.3×0.3 的缩小核心框 → 柱列之间 0.4 格宽的"贴缝"也能擦过去。
  这是关卡的设计漏洞（不是 bug），要改属于关卡重设计，本任务不碰。
- 物理上限（隔离实测，65 个起跳阈值）：柱高 1/2 格 41/28 可过，**柱高 3 格及以上 0/65**；
  刺宽 1/2 格 19/9 可过，**刺宽 3 格及以上 0/65**（需连续 y≥0.55 跨度 3.550 格，实测窗口只有 3.462 格）。
  关卡里已经没有 3 格柱和 3 连刺了，别再放回去。

- [ ] **Step 1: 写回放测试**

`tests/replay.test.js`（这是最后一条用例，累计 21 条；把 `GD_ASSERT.expect_tests(...)` 改成 21）：

```js
GD_ASSERT.test('T3 回放序列通关 Crossbeat', function () {
  var st = GD_Physics.create(GD_Level.crossbeat);
  var seq = GD_Replay.crossbeat, si = 0, held = false, diedAt = -1;
  var maxSteps = 240 * 40;
  // 记录模式/速度的切换点：漏掉任一速度门，回放也会 finished=true，只是时长变了
  var sw = { mode: [], speed: [] }, prevMode = st.mode, prevSpeed = st.speedKey;
  for (var n = 0; n < maxSteps && !st.finished; n++) {
    while (si < seq.length && seq[si].t <= st.time) { held = seq[si].d; si++; }
    GD_Physics.step(st, held);
    if (st.mode !== prevMode) { sw.mode.push(st.x); prevMode = st.mode; }
    if (st.speedKey !== prevSpeed) { sw.speed.push(st.x); prevSpeed = st.speedKey; }
    if (!st.alive && diedAt < 0) diedAt = st.x;
    if (!st.alive) break;
  }
  if (!st.finished) {
    throw new Error('未通关：percent=' + st.percent.toFixed(1) +
      '% 停在 x=' + st.x.toFixed(1) + (diedAt >= 0 ? '，首次死亡 @' + diedAt.toFixed(1) : ''));
  }
  GD_ASSERT.ok(st.percent >= 100, 'percent 应 ≥100');
  // 时长也要钉住：漏掉 speed_2x@116 → 全程 1x → 34.66 s；漏掉 speed_1x@254 → 后半段跑 2x → 30.05 s。
  // 这两种"假通关"的 finished 也是 true，只断 finished/percent 会放过它们。
  GD_ASSERT.ok(st.time >= 31.36 && st.time <= 32.64,
    '通关时长应在 32.0 ±2% 内，实测 ' + st.time.toFixed(4) + ' s');
  // 四个切换点：真实速度剖面是 1x[0,115.5] / 2x(115.5,253.5] / 1x[253.5,360]
  GD_ASSERT.ok(sw.mode.length === 2, '应有两次模式切换，实测 ' + sw.mode.length);
  GD_ASSERT.ok(sw.speed.length === 2, '应有两次速度切换，实测 ' + sw.speed.length);
  GD_ASSERT.near(sw.mode[0], 111.5, 0.5, '切成飞船的 x');
  GD_ASSERT.near(sw.speed[0], 115.5, 0.5, '变 2x 的 x');
  GD_ASSERT.near(sw.mode[1], 252.5, 0.5, '切回方块的 x');
  GD_ASSERT.near(sw.speed[1], 253.5, 0.5, '回 1x 的 x');
});
```

- [ ] **Step 2: 跑测试确认失败**

预期：`FAIL T3 ... 未通关`，并给出首次死亡的 x 坐标；`registered: 20, fail: 1, runErrors: []`。**这个 x 就是下一步要修的关卡位置。**

- [ ] **Step 3: 用探针定位每个失败点**

`evaluate_script` 执行，拿到死亡位置附近的所有对象：

```js
() => {
  const st = GD_Physics.create(GD_Level.crossbeat);
  const seq = GD_Replay.crossbeat; let si = 0, held = false;
  const log = [];
  for (let n = 0; n < 240 * 40 && st.alive && !st.finished; n++) {
    while (si < seq.length && seq[si].t <= st.time) { held = seq[si].d; si++; }
    GD_Physics.step(st, held);
    log.push({ t: +st.time.toFixed(3), x: +st.x.toFixed(2), y: +st.y.toFixed(2), mode: st.mode, g: st.onGround });
  }
  const death = st.alive ? null : st.x;
  const near = death == null ? [] : GD_Level.crossbeat.objects
      .filter(o => Math.abs(o.x - death) < 6)
      .map(o => `${o.t}@${o.x},${o.y}`);
  return { death: death && +death.toFixed(2), near, percent: +st.percent.toFixed(1), tail: log.slice(-8) };
}
```

- [ ] **Step 4: 迭代闭环（死亡点 → 改按键序列或改关卡 → 重跑）**

**先看上面「预研结论」那一节**——本任务初版草稿里的飞船策略（每 0.42 s 按 0.22 s）实测连第一根柱 126 都过不去，
`tOf()` 的段表边界也差 0.047 s（双刺窗口只有 0.079 s）。预研已经产出一条**验证过通关**的按键序列
（`finished=true, percent=100, time=32.0625s`，切换点 x=111.520/115.501/252.551/253.519，±1 步扰动 60/88 仍通关），
它会作为 `docs/superpowers/research/t12-replay-fixture.js` 一并入库，**直接复制成 `tests/replay.js` 的初版**，
不要手写。复制后按下面三条规则核对，**任何一条不满足就说明物理或回放语义变了，序列必须重新生成**：

1. 时间约定是 `t = (step-0.5)*DT`，配合 `seq[si].t <= st.time` 恰好在第 step 步生效。
2. 步数上限用 `240*40`（写死 6000 步只能跑到 x≈259，会让 x>254 的整段集体"看起来打不通"）。
3. 断言要连**时长**和**四个切换点**一起断（Step 1 已经这么写了）——只断 `finished`/`percent` 会放过两种假通关。

规则，按优先级：

1. **跳跃时机类死亡**（撞刺、撞墙脚）→ 修 `tests/replay.js` 的按键时刻。关卡是对的，是"机器人不会玩"。
2. **物理上不可能**（如某柱阵需要 2.5 格跳高、飞行通道净空 < 玩家 1 格 + 容错）→ 修 `level.js` 的坐标。这是关卡设计错误，必须改关卡。
   （**预研已经查过：当前关卡没有物理上过不去的障碍**，23 个 cube 组逐组实测全部 ≥9/65，所以这一条大概率用不上。）
3. 每次只改一处，重跑 Step 2。不要一次改十个点——无法归因。

`tests/replay.js` 初版。

**注意 `tOf()` 必须做分段积分**：关卡中间有 136 格跑在 2x 上，用 `x / 10.386` 一律换算会让 254 之后的每个起跳时刻偏掉约 3 秒——这是最容易在这里踩的坑，且症状（后半段全撞）很容易被误读成"关卡太难"。

```js
window.GD_Replay = (function () {
  var SPAN = GD_Physics.measureJump(1).span;      // 4.06 格，实测而非硬编码
  var S = GD_Physics.CONST.SPEEDS;
  var LV = GD_Level.crossbeat;

  // 速度档位的生效点是"玩家前沿（x+0.5）碰到速度门的 x"，即门位置 - 0.5。
  // 必须从关卡数据推导，不要在这里抄第二份档位表：
  // 段落断点 118/254 与实际生效点 115.5/253.5 并不相同（差 0.05 秒），
  // 后面每一个起跳时刻都会跟着偏，而且这种偏很容易被误读成"关卡太难"。
  var GATES = LV.objects
    .filter(function (o) { return o.t.indexOf('speed_') === 0; })
    .map(function (o) {
      return { x: o.x - 0.5, speed: { speed_1x: 1, speed_2x: 2, speed_3x: 3, speed_4x: 4 }[o.t] };
    })
    .sort(function (a, b) { return a.x - b.x; });

  function tOf(x) {
    var t = 0, cur = 0, v = S[LV.segments[0].speed];
    for (var i = 0; i < GATES.length; i++) {
      if (x <= GATES[i].x) break;
      t += (GATES[i].x - cur) / v;
      cur = GATES[i].x;
      v = S[GATES[i].speed];
    }
    return t + (x - cur) / v;
  }

  var seq = [];
  // 越过去：落地点刚过障碍末端，留 0.3 格余量。多宽尖刺阵必须给 width
  function jumpOver(startX, width) {
    var t = tOf(startX + (width || 1) - SPAN + 0.3);
    seq.push({ t: t, d: true });
    seq.push({ t: t + 0.05, d: false });
  }
  // 站上去：顶点 2.17 格出现在起跳后约 2.02 格处，故提前 2.0 格起跳
  function jumpOntop(x) {
    var t = tOf(x - 2.0);
    seq.push({ t: t, d: true });
    seq.push({ t: t + 0.05, d: false });
  }

  // 尖刺阵：[起点, 宽度] —— 宽度必须与 level.js 一致。
  // c54f39d 把 pillar(82,3) / pillar(324,3) / spikeRun(340,3) 都降成了 2，
  // 这份表当时漏改（计划自查记录第 16 条），照抄会带着过期的障碍宽度。
  [[14, 1], [22, 1], [30, 2], [48, 1], [64, 2], [74, 2], [94, 2], [106, 1],
   [264, 1], [272, 2], [286, 1], [294, 2], [304, 2], [318, 2], [330, 1], [340, 2]]
    .forEach(function (a) { jumpOver(a[0], a[1]); });
  // 需要站上去的柱阵（2 格高可站，3 格高需借跳板/环）
  [42, 58, 100, 280, 312].forEach(jumpOntop);
  // 2 格墙与高台：靠跳板/环，不靠普通跳
  jumpOver(82, 2);   // pillar(82,2)
  jumpOver(324, 2);  // pillar(324,2)

  // 飞船段 118–254：间歇按住维持通道高度
  for (var t = tOf(118); t < tOf(254); t += 0.42) {
    seq.push({ t: t, d: true });
    seq.push({ t: t + 0.22, d: false });
  }

  seq.sort(function (a, b) { return a.t - b.t; });
  return { crossbeat: seq, tOf: tOf, SPAN: SPAN };
})();
```

暴露 `tOf` 是为了 Step 3 的探针能把"死亡位置 x"换算回"按键时刻 t"，否则只能人肉比对。

- [ ] **Step 5: 跑测试确认通过**

预期：`pass: 21, fail: 0, registered: 21, runErrors: []`，T3 显示通关。`loadErrors` 应为 `[]`（replay.js / replay.test.js 至此都已存在）。

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git add tests && git commit -m "test: Crossbeat 通关回放，证明关卡人类可通"
```

---

## Task 13: 人工试玩与手感校准

**Files:**
- Modify: 视校准结果而定（`physics.js` 或 `level.js`）

- [ ] **Step 1: 打开 index.html 实玩**

`navigate_page` 到 `http://127.0.0.1:8765/index.html`，用 `press_key` 打一段，`take_screenshot` 记录。

**这一步必须真玩，不能只看测试通过。** 测试证明的是"数值正确 + 关卡可通"，证明不了"手感是 GD"。

- [ ] **Step 2: 按 spec §13 逐项检查自调参**

| 症状 | 首个要回看的数字 |
|---|---|
| 整体太快、来不及反应 | `SPEEDS[1] = 10.386` → 试 8.63（spec §13 冲突项） |
| 尖刺莫名其妙碰到我 | `SPIKE_HB = 0.55` → 调小到 0.45 |
| 明明贴着刺过去却死了 | `SPIKE_HB` → 调小到 0.45 |
| 跳不上本该跳得上的台 | `JUMP_V0` / `LAND_TOL` |
| 视野太窄、来不及看后面 | `LH = 240`（8 格）→ 试 300（10 格），spec §13.4 冲突项 |
| 落地后下一跳有粘滞感 | `ROT_SNAP` / 长按自动连跳逻辑 |

**每轮只改一个数字，重跑全部测试**（T1 会拦住任何破坏常数的改动）。

- [ ] **Step 3: 若改了常数，同步更新 spec 与代码注释**

改 `physics.js` 的 `CONST` 后必须重跑 `tests/harness.html`——T1 会红。若确实需要偏离 GD 常数，在 spec §13 追加一条记录"偏离原因 + 实玩证据"，不要悄悄改。

- [ ] **Step 4: 清理临时文件**

删除 `tests/visual-smoke.html`（Task 9 的调试页，不属于交付物）。

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git rm tests/visual-smoke.html
```

- [ ] **Step 5: 跑完整测试 + 最终截图**

预期 `pass: 20, fail: 0, registered: 20, runErrors: []`，`loadErrors: []`（所有文件都已存在）。

`take_screenshot` 存档最终画面，与 `gd_ref/gd3.jpg` 并排比对布局。

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/user/Documents/My Games/drgame" && git add physics.js level.js && git commit -m "fix: 实玩手感校准"
```

---

## 验收对照（spec §14）

| 验收项 | 由哪个任务保证 |
|---|---|
| T1–T6 全绿 | Task 2/3/4/7/8/12 |
| D1 physics 层不依赖渲染（spec §5 架构约束） | Task 8 |
| 双击 index.html 即玩，无需服务器 | Task 11 Step 5（`file://` 路径实测） |
| 一关能打到 100%，死亡重开正常 | Task 12（T3）+ Task 4（T5a） |
| 布局、描边、HUD 位置与原版观感一致 | Task 9 Step 4 + Task 10 Step 2 + Task 13 Step 5 |
| 不含任何原版素材或音乐 | 全程自绘 + WebAudio 合成；`gd_ref/` 已在 .gitignore 中排除 |

## 自查记录（已就地修正）

| # | 问题 | 后果 | 修法 |
|---|---|---|---|
| 1 | `wx(ctx, x)` 读 `ctx.st.x`，但 `ctx` 是 2D 上下文 | 所有物体坐标 NaN，画面全黑 | 改为 `wx(st, x)`，贯穿 block/spike/portal/objects/player/particles |
| 2 | `feed()` 把布尔当对象读（`st.testHeld.down`）；死亡期间 `st.time` 不推进 | Promise 永不 resolve | 用局部 `held`，并以帧数 `guard` 兜底 |
| 3 | `level.js` 段落边界与传送门位置不一致，5 段 vs spec §7 | `tOf()` 分段积分与真实轨迹对不上 | 压成 4 段，边界严格等于传送门 x（118 / 254） |
| 4 | 回放序列用 `x / 10.386` 换算时刻，但关卡有 136 格跑在 2x | 254 之后每个起跳偏约 3 秒，症状易误判成"关卡太难" | 改为 `tOf()` 分段积分；`jumpOver(x, w)` 让落点在障碍末端后 0.3 格 |
| 5 | 非法 CSS 颜色 `'#7cff5fa8'` | 传送门描边色回退成黑色 | 改 `'#7cff5f'` |
| 6 | `wasAlive` 是模块级变量 | 多实例/重开测试串状态 | 移入 `create()` 的实例字段 |
| 7 | spec §5 的"physics 不引用渲染层"无验证 | 架构约束会随时间退化 | 新增 D1，用 fetch 预取源码做静态断言 |
| 8 | `error` 监听器挂在文档末尾的内联 `<script>` 里 | 5 个 parser-blocking 的 404 在解析到该脚本前就发完了，`loadErrors` 恒为 `[]`——Task 2/8 的"404 逐条减少"验证信号静默失效 | 监听器移进 `<head>`，先于任何 `<script src>` 注册 |
| 9 | harness 可以"假绿"：测试文件在注册期抛异常会丢掉其后所有用例，`fail` 仍是 0；文件被改名后 404 混在本属预期的 `loadErrors` 里看不出来 | 后续 11 个任务里任何一次静默丢失用例都不会被发现 | `expect_tests(N)` 注册数门禁 + `__RUN_ERRORS__` 与 `__LOAD_ERRORS__` 分桶 |
| 10 | T1 的三条 2% 相对容差**拦不住**半隐式欧拉：实测欧拉·先减速度顶点 2.127420，对 2.17 只偏 1.96%，距容差下限 2.1266 差 0.0008 格 | 计划开头"不要简化成欧拉，T1 会红"这条防线是假的；将来有人换积分器，测试照样绿，症状推迟到实玩才暴露 | T1 追加 `near(m.apex, 2.173781, 0.002)` 绝对精度指纹断言；开头那节改用实测数字重写 |
| 11 | `respawn` 的两个三元回退会静默改成 cube/1x（`segments` 为空或拼错时没有任何测试会红）；`GROUND_Y` 用中心点、`collide` 用整框，两者对"是否站在方块上"判定不一致；`CONST` 按引用导出、可被外部改写（实测 `G=1` 后顶点变 151.7）；`measureJump` 起点取在起跳步之后、滞空与跳距各少算 1 个 dt；指纹断言写死 2.173781 会让合法的常数重调误报 | 静默换模式时后续任务全绿也没有测试会红；实测吃掉 0.0375 秒的长按起跳输入，症状会传染给 Task 9（渲染倾角）、Task 12（回放机器人）与 ship→cube 传送门；`measureJump` 撞 2000 步上限时静默返回残值当真值 | 直接读取段 0 + 默认关卡补 `segments`；中心判定改成与 `collide` 一致的整框判定；`Object.freeze` CONST 及四个子表；起点前移并对 2000 步截断抛错；指纹期望值改由 `v0²/(2g)` 现算。延后（留给 Task 4/6 实现者顺手处理）：命中框内联字面量（0.35、-0.6…+1.6、1.4×2.6 在 collide 重复两处）未收进 `CONST.HIT`；`collide` 的 `pb` 只算一次、循环中 `st.y` 被改后仍用旧框测后续对象；`GROUND_Y`/`GROUND`/`near` 命名与 physics.js:13 的"致用"错字；`SPIKE_HB` 未拆成宽高；`portal_cube` 传送门置 `onGround = true` 时不清 `vy`，破坏"在地面 ⇒ `vy == 0`"这条不变式（第 15 条的台沿自由落体分支正依赖它——飞船状态残余 `vy` 带进方块模式会多飞一下，Task 7 实现者处理） |
| 12 | `deadTimer <= 0` 判重开：`DEATH_DELAY = 1.0` 恰为 240 个 `1/240`，但 1/240 二进制除不尽，连减 240 次剩 +2.3e-15 | 重开永远慢一步；T5a 里 `near(st.x, 0, 0.05)` 的预算被这一步白吃掉 0.043 格（86.5%），后面对重开时序的任何判定都建立在沙子上 | 死亡分支改为 `<= CONST.DT * 0.5`（按离整步最近判定），Task 2 Step 3 代码块同步 |
| 13 | T5b 用"距墙一整跳"（`6 - span ≈ 1.93`）起跳 | 人不是跳过墙而是**落在墙上**：下落途中 `LAND_TOL` 先把第 1 格的顶当成可站面把人吸进方块内部，随即被缩小框判死；`trial(2)` 恒红，症状看起来像"跳跃高度不够"会误导去改 `JUMP_V0` | 起跳点改为半跳距 `6 - span/2`，让顶点落在墙前沿；实测可通过区间 x∈[2.5, 5.45]（阈值 1.00→5.95、步长 0.05 扫出，连续无空洞），3.966 在正中。本条原先记的 `[2.5, 4.6]`/`3.97` 是过期读数，已由第 14 条重扫修正 |
| 14 | Task 4 质量复查：T5a/T5b/T5c 只断"结果"不钉"原因"。T5a 只查 `!alive`（任何误判早死都绿灯）、名字写着"从 0% 重开"却从不看 `percent`、重开等待写死 240 步；T5b 的 `trial()` 只返回 `st.alive`，"跳过 2 格墙"没证明翻过墙、"撞死 3 格墙"没证明死在墙上，注释里的起跳区间还是过期读数；T5c 标题里的"无 coyote time"零覆盖——平地长按那个循环从不离开地面，任何宽限期都照样绿，`bounced >= 2` 低到"只弹两次也算连跳" | 误判早死、重开没回到 0%、判定框改坏、有人加 coyote grace 都不会红；写死 240 步还会在合法微调常数时把正确实现跑红（模拟 `DEATH_DELAY = 0.5` → 120 步就重开，剩下 120 步活跑 x=5.193，`near(st.x, 0, 0.05)` 必红） | T5a 钉住死亡瞬间 x（实测 7.7462：玩家前沿 `st.x+0.5` 首次进入致死框 `x∈[8.225, 8.775]` 的那一步）+ "同关卡去掉尖刺同样步数仍活着"的反证 + 重开后 `percent === 0 && time === 0`，等待步数改成 `round(CONST.DEATH_DELAY / CONST.DT)`（当前 240，等价性不再写进测试体）；T5b `trial()` 改返 `{alive, x, y}`，断 2 格墙 480 步跑到 x=20.77 > 8、3 格墙死在墙柱内（实测 x=6.2316、y=2.1454，落在 x∈(6,7)），注释与第 13 条同步成实测区间；T5c 的 `bounced` 下限收到 6（实测 7）。本条当时给 T5c 补的"真 coyote 探针"其实是拿起跳后按住冒充，测的是"空中不连跳"而不是 coyote 宽限期，它那句"`physics.js` 不需改动、走下台沿不产生空中态"也把缺陷当成了既成事实——由第 15 条推翻并修物理 |
| 15 | Task 4 质量复查第二轮：走下台沿不掉落是 **`physics.js` 的缺陷**，不是"没法测 coyote"的客观限制。原 `stepCube` 在 `onGround` 且未按时，无条件 `st.y = GROUND_Y(st)`，而 `GROUND_Y` 的支撑窗口是整框重叠（`st.x > o.x + 1.52` 即失效），于是失去支撑那一步把 y 从台面直接拽到地面（实测 x=5.5246 处 1→0、两格台 2→0，`onGround` 全程为真、空中态 0 步） | 原版里走下台阶是掉下去，这里等于"踩空即传送"，Task 5 关卡里任何台沿、Task 12 回放机器人都会被它污染；更要紧的是没有空中态就没有 coyote 的可验对象，第 14 条因此只能用起跳冒充 | `stepCube` 改为支撑面低于脚下时置 `onGround = false`、交给同一步的重力积分做自由落体（`Task 2` Step 3 代码块同步）。实测失去地面那步 `y=0.999, vy=-0.479`（从静止起步，一步重力增量），一格台 31 步、两格台 44 步后落地；T5b 起跳阈值区间在新物理下重扫仍为连续的 `[2.5, 5.45]`、3 格墙 0 个可通过阈值、死点 x=6.2316 未变，注册数与 `pass: 8, fail: 0` 不变。coyote 探针改成真的走台沿：离地后按住 12 步（0.05 s）断 `reJump === 0`，负控在离地后外部把 `vy` 重置回 `JUMP_V0` 得 `reJump: 12`、窗口内 `maxVy: 21.88`（干净跑 `maxVy: -0.958`）。另记一条流程坑：`?v=` 只 bust `harness.html`，**bust 不到 `<script src>` 子资源**——改完 `physics.js` 换新 `?v=` 的页面照旧跑旧物理，必须 `navigate_page {type: "reload", ignoreCache: true}`；「测试执行流程」Step B 已补。复审另提三条 nit：①T5c 原先只钉"离地瞬间"和"12 步后仍在空中"，浮空冻结（`onGround` 假但 `vy` 不再积分）能同时躲过，已补总滞空步数断言，期望值现算 `round(√(2·1/g)/DT)`（=32，实测 1+12+19=32）而不是抄实测；②`portal_cube` 置 `onGround` 不清 `vy` 破坏"在地面 ⇒ `vy==0`"不变式，本条的新分支正依赖它，已并入第 11 条延后清单留给 Task 7；③harness 那 3 条 404 是后续任务的前向引用，不动 |
| 16 | Task 5 关卡数据落地后做了两件事才敢提交：①带 `ring` 的关卡一进邻域就崩——`collide(st)` 少了 `held` 形参，而跳环是"按下才触发"的，`'use strict'` 里引用未定义形参直接 `ReferenceError`（physics.js 命中环那一步）；②拿穷举起跳阈值的机器人扫全关，发现三处按物理常数根本打不通：`pillar(82,3)`、`pillar(324,3)` 的 3 格柱 tap 可通过阈值 **0/65**，`spikeRun(340,3)` 三连刺要腾空覆盖 3.55 格而实测 `y≥0.55` 的窗口只有 **3.49 格**（tap/hold 都 0）| ①Task 6 一加环整个模拟就炸，而且炸在关卡数据里，症状会误判成"关卡布局有问题"；②关卡号称"人类可通"却有三处死局，Task 12 通关机器人会在第一个 3 格柱就永远过不去，届时容易被误读成"机器人策略不行"而去放宽物理 | ①`collide(st, held)` + 调用点同步（Task 2 Step 3 代码块已镜像）；②两处柱子降为 2 格、三连刺改双连刺，并把各障碍的可通过窗口记进注释：单刺 20/65、双刺 10/65、2 格柱 30/65、环/板/传送门/终点 64–65/65。改完全关 30 个 cube 组 `zeroTapGroups: []`，`pass: 11, fail: 0, registered: 11` 不变。**顺带两条要记住的**：(a) 审计机器人一开始步数上限写死 6000 步，只能跑到 x≈259，于是 x>254 的所有组集体"看起来打不通"——上限必须按关卡长度给（现用 `240*40`）；(b) **新缺陷，留给后续**：3 格柱长按有 10 个阈值能"过"，靠的是 `LAND_TOL` 在下落途中把墙肩（top=2）当成可站面把人吸上去、随即起跳拿到 4.17 的顶点，这不是合法路线，本条按 tap 能否通过来判，`LAND_TOL` 墙肩吸附并入第 11 条延后清单 |
| 17 | **Task 5 代码质量复查（第二阶段）查出关卡不可玩**：`portal_cube`/`speed_1x` 放在 y=1.0，触发框是 `[1, 3.6]`，而玩家贴地时框是 `[0,1]`——`overlap` 用严格不等号，`1 > 1` 不成立，**门永远不触发**。实测贴地跑过 x=253 仍是飞船模式，随后撞死在 x=264 的第一根尖刺；若一直按住飞（出口净空带 y∈[4,9]）则两扇门都错过，以 2x 飞过整个收尾段直接通关 | 一关最花心思的收尾要么撞死要么被白送；Task 12 回放机器人的 `SEGS`（假定 254 起 cube/1x）与实际对不上；Task 13 实玩会撞死在 x=264 | 两扇门改贴地（y=0.5，与 `portal_ship`/`speed_2x` 同一惯例），触发窗口 y∈(-0.5, 3.1)，松手落地的玩家必然命中。**残留缺口**：玩家在出口一直按住（y>3.1）仍会错过——Task 7 把 `portal_cube` 的触发框扩到通高时一并关掉。L3 里补了回归断言（贴地跑过门必须切成 cube 且降回 1x） |
| 18 | `tests/assert.js` 的 `approx()`/`near()` 不拒绝 NaN：`err > tolPct` 对 NaN 恒为 false，**断言假绿**。实测把某段 `speed` 写成 `'2x'` → L2 算出的时长变成 NaN → L2 绿；`GD_Level.validate()` 又放行了这个关卡 → L1 也绿。一条写错的速度键名能同时骗过两条断言 | 数值类断言在最该报警的时候最安静；`validate()` 还漏检 `speed:99`、`from>to` 反向段、对象越过终点（实测 4 个坏关卡全部返回 `[]`），而硬规矩要求"输入校验只放在 `GD_Level.validate()` 这个边界上" | `approx`/`near` 开头加有限性检查（非 number 或非有限值直接抛错）；`validate()` 补 `VALID_SPEEDS` 白名单、`from>=to`、段落首尾相接且从 0 开始、对象不得越过 `endBlock` 四类检查；`expect_tests` 的门禁提示语按"少注册/多注册"分开说（原来一律说"有用例文件抛异常"，注册数**多于** N 时是误导） |
| 19 | 文档与关卡实况脱节三处：①"段落边界与传送门 x 坐标严格相等（118 与 254）"是**错的**——传送门在玩家前沿（x+0.5）碰到门时才生效，实际切换点是 ≈111.5/115.5/252.5/253.5，与段落断点差 0.5 格；②计划的 Task 12 `replay.js` 代码块里障碍宽度还是 `c54f39d` 降级**之前**的（`[340, 3]`、`jumpOver(82, 3)`、`jumpOver(324, 3)`），照抄就会带着一份与关卡不符的障碍表；③`level.js` 的注释写"飞行 118–250"（段落到 254）、"回方块 254：门与降速同点"（门在 253、速度门在 254，不同点） | 错误断言会顺着 handoff 一路传下去：`tOf()` 按段表积分会整体偏 0.05 秒，后面每个起跳时刻都跟着偏，而这种偏很容易被误读成"关卡太难" | 计划与 handoff 里的措辞改成"段落边界与主题切换点对齐"，并附实际生效点对照表；`replay.js` 的 `tOf()` 改成**从关卡里的速度门推导档位**（不再抄第二份段表），障碍宽度同步成 2；`level.js` 的注释改成真实值。**顺带**：Task 13 原计划的 `git add -A` 与硬规矩"永远不要 `git add -A`"直接冲突，已改成点名 add |
| 20 | Task 8 动手时发现三处计划与实测对不上：①计划原版的 **T6b** 跑满 `240*60` 步之后取 `st.x` 并断 `near(st.x, 0, 12)`，实测那个取样点落在**死亡延时**里（`alive=false`、`deadTimer=0.45`、`x=13.76145`=第一根尖刺的死亡点），断言必然红——而计划把它解释成"`respawn()` 漏了某个字段"，方向就错了；②handoff 缺陷清单第 5 条说方块落地判定的 `vy <= 0` "去掉它 13 条断言全绿"，实测去掉之后玩家**照样死**（死在柱顶那一格），只是死之前被吸到了方块顶上——所以"必须死"这条断言抓不住这个变异，必须同时钉住"没被吸到顶上"；③`collide` 的玩家框每轮重算之后**没有任何一条断言能把它跑红** | ①照抄计划会把一个**取样时机**问题误当成 `respawn()` 的实现缺陷去"修"，改坏真正的重开逻辑；②只断"死了"的话，去掉 `vy<=0` 这个变异照样全绿，第 5 条缺陷等于没修；③修复失去保护，将来有人把玩家框改回"进循环前算一次"，没有任何测试会红 | ①T6b 改成"每次重开当刻取样"，并逐字段体检（x/y/vy/rot/percent/time/deadTimer/alive/finished/onGround/mode/speedKey/used），断言反而更严（x 精确为 0）；②补 T5d：玩家上升中撞进 2 格柱必须死，**且** y 保持撞上去那一刻的值、vy 仍为正（落地分支一旦触发会把 vy 清零）——实测去掉 `vy<=0` 后 y 从 0.9407 变成 1.0、vy 从 9.52 变成 0，T5d 变红；③如实记为残留缺口：当前关卡与任何合理关卡都观察不到过期玩家框（落地吸附只抬 0.33 格，而尖刺框高 0.55，要看出差别必须造一个"尖刺嵌在方块格里"的关卡），保护网只有可通性扫描、通关序列与 55700 帧逐帧对拍 |
