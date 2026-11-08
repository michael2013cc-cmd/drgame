// Task 12 可行性预研产出的**已验证通关按键序列**，供实现者直接复制成 `tests/replay.js` 的初版。
//
// 怎么来的：一个机器人搜索器（DFS 排 cube 段 + beam 搜飞船段）在仓库真实的 physics.js/level.js 上
// 搜出这条序列，并用计划里 replay.test.js 的原样回放循环验证过：
//   finished = true、x = 360.0191、percent = 100.0000、time = 32.0625 s、全程无死亡
//   四个切换点：mode→ship x=111.520 / speed→2 x=115.501 / mode→cube x=252.551 / speed→1 x=253.519
//   跳变点 ±1 步（1/240 s）扰动后仍有 60/88 通关
//
// **它是有时效的**：物理或回放语义一变（Task 8 的玩家框重算、Task 13 的手感校准都会改物理），
// 这条序列可能失效，失效了就必须重新生成，不能靠改容差把它糊过去。
// 重新生成需要那个搜索器，它在会话临时目录里，不入库——所以这里存的是**结果**而不是工具。
//
// 时间约定：t 是"从开局算起的秒"，回放里用 `seq[si].t <= st.time` 取值，
// 因此 t 落在 (step-1)*DT < t <= step*DT 之间时，该按键恰好在第 step 步生效。
// 本序列的 t 取的是 (step-0.5)*DT。语义若差一步，实测约 1/3 概率会挂。
window.GD_Replay = (function () {
  var crossbeat = [
    { t: 1.1187, d: true },
    { t: 1.1229, d: false },
    { t: 1.8896, d: true },
    { t: 1.8938, d: false },
    { t: 2.7563, d: true },
    { t: 4.1021, d: false },
    { t: 4.5646, d: true },
    { t: 4.5687, d: false },
    { t: 5.4771, d: true },
    { t: 5.4813, d: false },
    { t: 6.0313, d: true },
    { t: 6.0354, d: false },
    { t: 7.0687, d: true },
    { t: 7.0729, d: false },
    { t: 7.7771, d: true },
    { t: 8.0313, d: false },
    { t: 8.9187, d: true },
    { t: 12.4854, d: false },
    { t: 14.0854, d: true },
    { t: 16.7854, d: false },
    { t: 18.8354, d: true },
    { t: 19.3854, d: false },
    { t: 20.0854, d: true },
    { t: 20.3854, d: false },
    { t: 22.5896, d: true },
    { t: 22.5938, d: false },
    { t: 23.4563, d: true },
    { t: 24.2563, d: false },
    { t: 24.7104, d: true },
    { t: 24.7146, d: false },
    { t: 25.5729, d: true },
    { t: 25.5771, d: false },
    { t: 26.6104, d: true },
    { t: 26.6146, d: false },
    { t: 27.2437, d: true },
    { t: 27.9646, d: false },
    { t: 28.3979, d: true },
    { t: 28.4021, d: false },
    { t: 28.6479, d: true },
    { t: 28.6521, d: false },
    { t: 29.1146, d: true },
    { t: 29.1187, d: false },
    { t: 30.0021, d: true },
    { t: 30.0063, d: false }
  ];
  return { crossbeat: crossbeat };
})();
