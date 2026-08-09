# 测试计划

日期：2026-08-10

## 原则

不能再只靠人工刷抖音/B站判断。每次改动必须至少覆盖：

- 静态结构检查。
- DSP 单元测试。
- Web Audio 集成测试。
- Chrome 扩展 E2E。
- 手动站点矩阵。

## 当前已有测试

当前已有 Node 脚本：

```powershell
node .\tools\run_all_checks.js
```

该命令会聚合本地静态/结构检查、纯 DSP 渲染和 OfflineAudioContext 图测试；它仍不能证明真实站点或可听设备行为，后者由下面的隔离 Chrome E2E 与人工站点矩阵覆盖。

当前已有隔离 Chrome E2E：

```powershell
npm run test:silent
npm run test:capture
npm run test:sites
npm run test:long -- --duration-ms 30000
```

`test:silent`、`test:capture` 和 `test:long` 使用每次运行独占的临时 Chrome Profile，并同时启用浏览器假音频输出和 `AudioContext.setSinkId({ type: 'none' })`。DSP 与 meter 保持运行，但音频不会送到系统播放设备；测试还会在 Chrome 日志中拒绝原生 WASAPI 输出流。`test:capture` 覆盖 loud cut、quiet lift、低播放器音量的 source-domain 等价性、mute boundary 和 burst recovery。`test:sites` 依次打开 YouTube 视频/直播、Bilibili 视频/直播、抖音短视频/直播，默认同样静默运行。这些命令不读取或控制用户正在使用的 Chrome Profile。独占目录允许并行执行而不互相覆盖，但真实站点长跑仍会消耗本机 CPU、内存和网络；为了不影响日常播放或游戏，一次只运行一个真实站点浏览器。真实站点 URL、页面结构、反自动化策略和直播状态仍可能变化。

这些 E2E 已证明本地测试页里的 tabCapture 成功、offscreen 有输入/输出 meter、压大声/提小声/burst 恢复有效、连续接管/停止可恢复、页面 reload 后可重新接管，以及本地切源后仍继续处理。当前 DSP 证据由 `tools/dsp_unit_tests.js`、`tools/programme_leveler_experiment.js`、`tools/leveler_worklet_tests.js` 和 `tools/offline_audio_graph_tests.js` 共同提供；`tools/e2e_long_run_smoke.js` 对接管后的状态、音轨、信号 tick、输出峰值、AudioContext 和 offscreen heap 做可配置时长监控。真实站点结果必须另外记录，因为自动播放、登录、地区限制或站点改版都可能改变结果。

30 分钟长跑验收命令：

```powershell
npm run test:long -- --duration-ms 1800000 --cycles 3 --sample-ms 5000
node .\tools\e2e_real_site_matrix.js --scenario bilibili-live --hold-ms 1800000
```

真实站点长跑应选择当次快速矩阵中能够持续播放的公开源，不绑定某一家网站。汇总写入 `tmp/latest-real-site-endurance-e2e.json`；每个样本都必须推进 signal tick、保持 meter 新鲜、维持静音 sink、无硬 clipping，并满足 heap 上限。若站点播放器自行暂停、卸载媒体元素或断流，测试必须失败并将其与扩展会话仍存活的情况区分开，不能只凭进程存活判通过。

两条命令都会占用一个隔离且静默的 Chrome，不会操作用户正在使用的主 Chrome，也不会占用系统播放设备。第一条覆盖可控本地源的重复接管、reload 与切源；第二条覆盖真实直播的持续输入、DSP 新鲜度、hard clipping、offscreen heap 和退出清理。

当前运行状态审计：

```powershell
node .\tools\current_runtime_audit.js
```

该命令只读，输出磁盘版本、Chrome Profile 中音量扩展和 Codex Chrome Extension 的注册/禁用状态、`tmp/latest-diagnostics.json` 是否过期，以及诊断文件指向哪个 tab。它不是功能测试，但排查“页面未回传/未接入/截图仍旧版/无法读 DevTools”时必须先跑。

## 必须新增的测试类型

### 1. DSP 单元测试

当前已有基础测试：

```powershell
node .\tools\dsp_unit_tests.js
```

覆盖：关闭、0 强度、节目门控累计、冷启动置信度、节目中心修正、内部动态修正、快速压大声、自适应 onset、峰值预算、播放器音量边界和节目切换重置。`tools/programme_leveler_experiment.js` 还会同条件对打多个节目中心，验证当前 `-19 dB / +25 dB` 选择没有靠单一素材拍脑袋确定。

输入样本：

- silence
- 1kHz sine
- quiet dialog 模拟
- burst peak
- noise + quiet speech
- loud/quiet alternating sequence

验收：

- 静音不被提升。
- 小声有效信号被提升且不超过 max lift。
- burst 被削减。
- 输出 peak 不超过 ceiling。
- gain 曲线平滑，不出现大幅跳变。

### 2. OfflineAudioContext 集成测试

目标：

- 验证 source -> meter -> AGC -> limiter -> output 的完整图。
- 生成可重复的音频 buffer。
- 输出 RMS、peak、gain reduction。

### 3. Chrome 扩展 E2E

使用 Playwright/Puppeteer 加载 unpacked extension。

最小场景：

- 打开测试页面播放音频。
- 点击 popup 开启。
- offscreen document 创建。
- capture status 进入 processing。
- input/output meter 有数据。
- 关闭后声音恢复。
- 连续开关 10 次无双声/无声/异常。

### 4. 本地 test-pages

已创建：

- `test-pages/simple-video.html`
- `test-pages/simple-audio.html`
- `test-pages/dynamic-video-replace.html`
- `test-pages/spa-route-change.html`
- `test-pages/iframe-video.html`
- `test-pages/multi-video.html`
- `test-pages/live-like-audio.html`
- `test-pages/burst-volume.html`
- `test-pages/quiet-dialog.html`
- `test-pages/switching-audio.html`

这些页面用于阶段 3/4 的本地可控验证。它们只能证明扩展对可控页面的基础链路，不等同于任何真实站点通过。

## 手动矩阵

见 `docs/TEST_MATRIX.md`。真实站点测试必须记录日期、URL 类型、结果、诊断 JSON 摘要，而不是只说“感觉好了”。

## 诊断验收

每次 E2E/手动测试都要采集：

- extension version
- tabId / hostname
- state machine
- capture 是否成功
- tracks count/kind/readyState/muted/enabled
- AudioContext state/sampleRate/baseLatency/outputLatency
- input RMS/peak
- output RMS/peak
- current gain
- gain reduction
- limiter triggers
- recent errors
