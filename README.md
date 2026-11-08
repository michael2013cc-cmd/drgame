# Crossbeat —— Geometry Dash 同人复刻

一个正在开发中的网页横版节奏跳跃游戏：物理常数对齐 Geometry Dash 2.2，原创一关 32 秒关卡 `Crossbeat`，方块（cube）+ 飞船（ship）两种模式，**双击即玩、零构建、零依赖**。

> ✅ **现状（2026-11-08）**：Task 1–13 的**代码**已全部实现，测试套件**全绿**（复核时 **29 条**：`pass: 29, fail: 0, registered: 29`，`loadErrors: []`——用例数会随新用例增长，判定看的是 `registered` 与 `expect_tests` 相等且 `fail` 为 0），游戏**双击 `index.html` 即玩**。物理层、关卡数据、渲染、HUD、输入、音频、装配全部实现；Task 12 的通关回放证明这一关机器人能打到 100%，真实 Chrome 里整关能打通（`finished=true / percent=100.0000 / time=32.0625s`，四个切换点 111.520 / 115.501 / 252.551 / 253.519）。**剩下的是真人手感校准**（Task 13 的实玩部分）——自动化能做的都做完了。

## 版权边界（先说清楚）

这是**同人复刻，不是搬运**：

- 玩法与物理**常数**参考原版公开可查的数值；**素材、关卡、音乐全部原创或自绘**，不含任何原版像素或音频。
- 音乐是 WebAudio 现场合成的原创节拍（154 BPM），不是原版曲目。
- 仓库里**不会有**原版截图：`gd_ref/`（开发时的参考截图目录）已经写进 `.gitignore`，永不入库。

## 现在能跑什么

```
✅ 物理模拟 + 碰撞判定 + 死亡重开     physics.js
✅ 关卡数据 Crossbeat + 数据校验      level.js
✅ 浏览器测试套件（29 条全绿）        tests/
✅ 画面 / HUD / 输入 / 合成音轨 / 装配  render.js · hud.js · input.js · audio.js · main.js · index.html
✅ 通关回放（机器人打到 100%）        tests/replay.js · tests/replay.test.js
```

## 怎么跑测试

**测试本身不需要 Node**（项目故意零依赖）。只要 Python 和一个浏览器：

```bash
# 仓库根目录
python -m http.server 8766 --bind 127.0.0.1
# 然后浏览器打开
http://127.0.0.1:8766/tests/harness.html
```

在浏览器控制台读结果：

```js
window.__RESULTS__
// 期望：{ pass: 29, fail: 0, registered: 29, runErrors: [] }（用例数随新用例增长，以 harness.html 里的 expect_tests(N) 为准）
```

`registered` 是**注册数门禁**——测试文件如果在注册期抛异常会静默丢掉后面的用例而 `fail` 仍是 0，所以必须核对注册条数。`loadErrors` 应当是 `[]`：`replay.js` / `replay.test.js` 在 Task 12 已补齐，从 Task 1 起一直挂着的那两条 404 前向引用至此消失。**若它不为空，就是真的加载失败**（文件名拼错或 `<script src>` 漏了），不是预期。

必须走 http 而不是双击 `tests/harness.html`：架构约束测试（Task 8 的 D1）要用 `fetch` 读源码本身，`file://` 下 `fetch` 会被拦。而**游戏本体**是 `file://` 双击即玩的——所以代码用传统 `<script>` 而不是 ES module（ES module 在 `file://` 下被 CORS 拦）。

## 目录

```
index.html            游戏入口：双击即玩（file:// 下不走 ES module）
physics.js            唯一状态持有者。定步长 1/240 s 的 velocity-Verlet，GD 2.2 常数
level.js              Crossbeat 关卡数据 + validate()（纯数据，不含逻辑）
render.js             三层视差背景、纵向相机、物体与玩家图标
hud.js                FPS、Attempt N、进度条
input.js              键盘 / 指针 / 触摸 → held
audio.js              WebAudio 现场合成（154 BPM，段落切换移调）
main.js               装配：物理步进 + 渲染 + 音频调性
tests/harness.html    测试入口；注册数门禁、错误分桶（load vs run）
tests/assert.js       断言库（approx 是相对容差，且拒绝 expected===0）+ 源码预取（D1 要读源码文本）
tests/physics.test.js T1–T6 + L/P 系列共 18 条
tests/smoke.test.js   脚手架自检（2 条）
tests/render.test.js  R1–R5 / I1 / A1 / M1 共 8 条：驱动真实的渲染 / HUD / 输入 / 音频 / 装配五层
tests/replay.js       预研生成并验证过的通关按键序列（170 个事件，来源见 docs/superpowers/research/）
tests/replay.test.js  T3：回放通关，钉时长窗与四个切换点
tests/visual-smoke.html  渲染层调试页：?t=<秒> 跑到那一刻、?x=<格> 直接摆位置，用来看画面
docs/superpowers/HANDOFF-2026-11-08.md      ← 接手的人先读这个
docs/superpowers/plans/…-geometry-dash-clone.md   13 任务实现计划 + 缺陷台账
docs/superpowers/specs/…-design.md          设计依据（常数出处、验收标准、诚实清单）
```

依赖方向是单向的：`physics.js` 是唯一状态持有者，它吃 `level.js` 的数据（`level.js` 是纯数据层，不反向依赖物理层）；`render.js`/`hud.js` 只读状态，`input.js`/`audio.js` 只提供外部时钟与输入，`main.js` 装配。`physics.js` **不许**引用 `document.` / `requestAnimationFrame` / `canvas` / 渲染层——这条不是口头约定，Task 8 有静态断言钉它。

## 几个关键数字

| 常数 | 值 | 说明 |
|---|---|---|
| 重力 `G` | 115.0 | GD 2.2 |
| 起跳初速 `JUMP_V0` | 22.36 | 推出顶点 **2.1737** 格、@1x 跳距 **4.0678** 格、滞空 **0.3917 s** |
| 1x 水平速度 | 10.386 格/s | 反编译值（社区另有 8.63 流传，采用前者） |
| 定步长 `DT` | 1/240 s | |
| BPM | 154 | 一拍 0.3896 s；@1x 一拍正好走 4.046 格 ≈ 一次跳 |

**为什么必须是 velocity-Verlet**：半隐式欧拉的实测顶点是 2.127420，对 2.17 只差 1.96%，能**溜过** 2% 的相对容差把错误积分器放过去（容差下限 2.1266，它距它只差 0.0008 格）。所以 T1 里额外钉了一条绝对精度指纹：`near(apex, JUMP_V0²/(2G), 0.002)`——期望值由 `CONST` 现算（解析值 2.173781，Verlet 实测 2.173668 差 0.00011，两种欧拉各差约 0.046），既关得住欧拉，也不会因为合法的常数微调而误红。详见计划的「关键实现决策」一节。

关卡可通性不是"看起来能过"，是扫出来的：**23 个 cube 障碍组**（尖刺与柱子，x<110 或 x≥254 的方块段，不含飞船段的柱阵）逐个穷举起跳阈值，`zeroTapGroups: []`（没有一组点按完全过不去）。三类障碍的通过阈值数：单刺 19–20/65、双刺 10/65、2 格柱 30/65。原布局里的三处死局（3 格柱 ×2、三连刺）就是被这个扫描判死才降级的。

## 想接手：三步

```bash
git clone https://github.com/michael2013cc-cmd/drgame.git && cd drgame
```

开发分支是 `feat/crossbeat`，`master` 与它同步（同一提交 `668a1ee`）——按仓库规矩，`master` 只在**阶段收尾且测试全绿**时快进，最近一次快进就是 Task 13 收尾时做的（快进前验过是纯快进、没有分叉）。当前默认分支显示为 `feat/crossbeat`（空仓库首次推送决定的），两边代码一致，随便哪个都能开工。

1. 读 [docs/superpowers/HANDOFF-2026-11-08.md](docs/superpowers/HANDOFF-2026-11-08.md) —— 恢复执行的确切步骤、缓存与提交硬规则、已实测不必重验的数字、还欠着的缺陷各留给哪个任务。
2. **Task 1–13 的代码已全部完成**（Task 1–8 的两阶段审查早已跑完；Task 9 / 9.5 / 10 / 11 / 12 / 13 的复查也已补做）。**Task 13 的自动化部分已完成**——剩下的是**需要真人试玩的手感校准**。
3. 接手要做的就是那部分校准：按 spec §13 的诚实清单**逐项对照症状**调（症状 → 先看哪个数字，计划的 Task 13 Step 2 有对照表），**每轮只改一个数字，改完重跑全部测试**（以 `tests/harness.html` 里的 `expect_tests(N)` 为准；T1 会拦住破坏常数的改动）。**若改完常数让 `tests/replay.js` 那条通关序列失效了，要重新生成、不许放宽容差**——生成方法见 `docs/superpowers/research/t12-replay-fixture.js` 的文件头。每个任务都是"派新 subagent 实现 → spec 复查 → 代码质量复查 → 通过才进下一个"。

协作规矩（这些是用真实事故换来的，别绕）：

- **不要为了让测试变绿而放宽容差或删断言。** 数字对不上就报实测值，先怀疑代码。
- 计划的 fenced 代码块与磁盘代码**逐字节一致**，改代码要同步改计划并真 `diff` 验证。
- 提交信息用中文写**为什么**；不要 `git add -A`、不要 `--amend`、不要 `push --force`。
- `physics.js` 不加防御性兜底，校验只在 `GD_Level.validate()` 边界上做。

## 已知不确定的地方

原版有些数值根本没有权威来源（尖刺致死框 0.55 格、地面线离底 2.2 格、视差系数、可见区 8 格高等），是我的判断，实玩后可能要调——逐条列在 spec 第 13 节「未证实项 / 自调参项（诚实清单）」（**目前 20 条**，含纵向相机、飞船图标、音频移调音程等实现时自定的项）。已发现但有意延后的缺陷列在计划的「自查记录」表（20 条，每条都带实测数字和后果）。

还有一件做不了的事：**原版参考截图（`gd_ref/`）已经不在本机上**（它当初由用户提供，目录已 gitignore，仓库里也不可能有原版权图）。所以"布局与原版观感一致"目前只能保证**数值层面**有依据——§8 里从截图量来的数字（地面线离底 2.2 格、可见区 8 格、视差系数）已经固化进代码与 spec；**肉眼并排比对要由人自备参考图**。

## 许可

同人作品，非商业。原版 Geometry Dash 属于 RobTop Games；本项目不含其任何素材。
