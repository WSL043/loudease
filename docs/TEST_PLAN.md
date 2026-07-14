# 测试计划

日期：2026-07-07

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

该命令会聚合当前所有本地静态/结构检查。它不是行为测试；真实 Chrome 行为由下面的隔离 Chrome E2E 覆盖。

当前已有隔离 Chrome E2E：

```powershell
node .\tools\e2e_poc_smoke.js
$env:WVB_E2E_PAGE='quiet-dialog.html'; $env:WVB_E2E_EXPECT='lift'; node .\tools\e2e_poc_smoke.js
$env:WVB_E2E_PAGE='burst-volume.html'; $env:WVB_E2E_EXPECT='burst'; $env:WVB_E2E_MIN_REDUCTION_DB='3'; node .\tools\e2e_poc_smoke.js
node .\tools\e2e_stability_smoke.js
node .\tools\e2e_long_run_smoke.js --duration-ms 30000
```

这些 E2E 已证明本地测试页里的 tabCapture 成功、offscreen 有输入/输出 meter、压大声/提小声/burst 恢复有效、连续接管/停止可恢复、页面 reload 后可重新接管，以及本地切源后仍继续处理。`0.4.82` 还包含 `tools/dsp_unit_tests.js` 核心增益计算测试、`tools/offline_audio_tests.js` 合成 PCM 曲线测试、`tools/offline_audio_graph_tests.js` 真实 OfflineAudioContext 图测试，并通过 `tools/e2e_long_run_smoke.js` 对接管后的状态、音轨、信号 tick、输出峰值、AudioContext 和 offscreen heap 做可配置时长监控。它们仍不能替代真实站点矩阵，包括 YouTube、Bilibili、抖音基线和后续全球代表平台。

30 分钟长跑验收命令：

```powershell
node .\tools\e2e_long_run_smoke.js --duration-ms 1800000 --cycles 3 --sample-ms 5000
```

该命令会占用一个隔离 Chrome，不会操作用户正在使用的主 Chrome。

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

覆盖：关闭、0 强度、大声压低、小声提升、峰值余量不足不提升、峰值保护、强度缩放。

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
