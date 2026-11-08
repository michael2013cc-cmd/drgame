# Crossbeat —— Geometry Dash 同人复刻

一个正在开发中的网页横版节奏跳跃游戏：物理常数对齐 Geometry Dash 2.2，原创一关 32 秒关卡 `Crossbeat`，方块（cube）+ 飞船（ship）两种模式，**双击即玩、零构建、零依赖**。

> ⚠️ **现状（2026-11-08）**：还没做完，现在**还不能玩**。已完成的是地基——物理层、关卡数据、以及在真实浏览器里跑的 11 条测试（全绿）。渲染、HUD、输入、音频、装配分别在 Task 9–11。想先跑起来看效果的，请去看下面的「现在能跑什么」。

## 版权边界（先说清楚）

这是**同人复刻，不是搬运**：

- 玩法与物理**常数**参考原版公开可查的数值；**素材、关卡、音乐全部原创或自绘**，不含任何原版像素或音频。
- 音乐是 WebAudio 现场合成的原创节拍（154 BPM），不是原版曲目。
- 仓库里**不会有**原版截图：`gd_ref/`（开发时的参考截图目录）已经写进 `.gitignore`，永不入库。

## 现在能跑什么

```
✅ 物理模拟 + 碰撞判定 + 死亡重开     physics.js
✅ 关卡数据 Crossbeat + 数据校验      level.js
✅ 浏览器测试套件（11 条全绿）        tests/
❌ 画面 / 声音 / 可玩页面             render.js · hud.js · audio.js · index.html（尚未实现）
```

## 怎么跑测试

**本机不需要也跑不了 Node**（项目故意如此，见下）。只要 Python 和一个浏览器：

```bash
# 仓库根目录
python -m http.server 8765 --bind 127.0.0.1
# 然后浏览器打开
http://127.0.0.1:8765/tests/harness.html
```

在浏览器控制台读结果：

```js
window.__RESULTS__
// 期望：{ pass: 11, fail: 0, registered: 11, runErrors: [] }
```

`registered` 是**注册数门禁**——测试文件如果在注册期抛异常会静默丢掉后面的用例而 `fail` 仍是 0，所以必须核对注册条数。`loadErrors` 里剩 `replay.js` / `replay.test.js` 两条 404 是**预期的前向引用**（Task 12 才实现），不是故障。

必须走 http 而不是双击 `tests/harness.html`：架构约束测试（Task 8 的 D1）要用 `fetch` 读源码本身，`file://` 下 `fetch` 会被拦。而**游戏本体**将来是 `file://` 双击即玩的——所以代码用传统 `<script>` 而不是 ES module（ES module 在 `file://` 下被 CORS 拦）。

## 目录

```
physics.js            唯一状态持有者。定步长 1/240 s 的 velocity-Verlet，GD 2.2 常数
level.js              Crossbeat 关卡数据 + validate()（纯数据，不含逻辑）
tests/harness.html    测试入口；注册数门禁、错误分桶（load vs run）
tests/assert.js       断言库（approx 是相对容差，且拒绝 expected===0）
tests/physics.test.js T1/T2/T5 + L1/L2/L3 共 11 条
tests/smoke.test.js   脚手架自检
docs/superpowers/HANDOFF-2026-11-08.md      ← 接手的人先读这个
docs/superpowers/plans/…-geometry-dash-clone.md   13 任务实现计划 + 缺陷台账
docs/superpowers/specs/…-design.md          设计依据（常数出处、验收标准、诚实清单）
```

依赖方向是单向的：`level.js` → `physics.js` → `render.js`/`hud.js`，`input.js`/`audio.js` 只提供外部时钟与输入，`main.js` 装配。`physics.js` **不许**引用 `document.` / `requestAnimationFrame` / `canvas` / 渲染层——这条不是口头约定，Task 8 有静态断言钉它。

## 几个关键数字

| 常数 | 值 | 说明 |
|---|---|---|
| 重力 `G` | 115.0 | GD 2.2 |
| 起跳初速 `JUMP_V0` | 22.36 | 推出顶点 **2.1737** 格、@1x 跳距 **4.0678** 格、滞空 **0.3917 s** |
| 1x 水平速度 | 10.386 格/s | 反编译值（社区另有 8.63 流传，采用前者） |
| 定步长 `DT` | 1/240 s | |
| BPM | 154 | 一拍 0.3896 s；@1x 一拍正好走 4.046 格 ≈ 一次跳 |

**为什么必须是 velocity-Verlet**：半隐式欧拉的实测顶点是 2.127420，对 2.17 只差 1.96%，能**溜过** 2% 的相对容差把错误积分器放过去（容差下限 2.1266，它距它只差 0.0008 格）。所以 T1 里额外钉了一条绝对精度指纹：`near(apex, JUMP_V0²/(2G), 0.002)`——期望值由 `CONST` 现算（解析值 2.173781，Verlet 实测 2.173668 差 0.00011，两种欧拉各差约 0.046），既关得住欧拉，也不会因为合法的常数微调而误红。详见计划的「关键实现决策」一节。

关卡可通性不是"看起来能过"，是扫出来的：30 个障碍组逐个穷举起跳阈值，`zeroTapGroups: []`（没有一组点按完全过不去）。三处原布局（3 格柱 ×2、三连刺）就是被这个扫描判死才降级的。

## 想接手：三步

```bash
git clone https://github.com/michael2013cc-cmd/drgame.git && cd drgame
```

开发分支是 `feat/crossbeat`，`master` 与它同步（同一提交）。当前默认分支显示为 `feat/crossbeat`（空仓库首次推送决定的），两边代码一致，随便哪个都能开工。

1. 读 [docs/superpowers/HANDOFF-2026-11-08.md](docs/superpowers/HANDOFF-2026-11-08.md) —— 恢复执行的确切步骤、缓存与提交硬规则、已实测不必重验的数字、5 条有意延后的缺陷各留给哪个任务。
2. 第一件事是 **Task 5 的第二阶段代码质量复查**（spec 合规复查已过，质量复查还没跑）。
3. 然后按计划 `Task 6 → 13` 顺序推进。每个任务的代码块都是完整写好的，不需要你自己设计。

协作规矩（这些是用真实事故换来的，别绕）：

- **不要为了让测试变绿而放宽容差或删断言。** 数字对不上就报实测值，先怀疑代码。
- 计划的 fenced 代码块与磁盘代码**逐字节一致**，改代码要同步改计划并真 `diff` 验证。
- 提交信息用中文写**为什么**；不要 `git add -A`、不要 `--amend`、不要 `push --force`。
- `physics.js` 不加防御性兜底，校验只在 `GD_Level.validate()` 边界上做。

## 已知不确定的地方

原版有些数值根本没有权威来源（尖刺致死框 0.55 格、地面线离底 2.2 格、视差系数、可见区 8 格高等），是我的判断，实玩后可能要调——逐条列在 spec 第 13 节「未证实项 / 自调参项（诚实清单）」。已发现但有意延后的缺陷列在计划的「自查记录」表（16 条，每条都带实测数字和后果）。

## 许可

同人作品，非商业。原版 Geometry Dash 属于 RobTop Games；本项目不含其任何素材。
