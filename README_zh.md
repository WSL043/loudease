<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-ai-a-dark.png">
    <img src="assets/logo-ai-a-light.png" width="136" alt="LoudEase Logo">
  </picture>
</p>

<h1 align="center">LoudEase</h1>

<p align="center"><strong>让网页声音更稳定，也更舒服。</strong></p>

<p align="center">
  LoudEase 压低突然的大声，在安全余量允许时轻柔提起小声，<br>
  同时始终尊重播放器的音量和静音状态。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="#体验测试版">体验</a> ·
  <a href="docs/AUDIO_DSP.md">声音算法</a> ·
  <a href="docs/ARCHITECTURE.md">架构</a> ·
  <a href="docs/RELEASE_READINESS_REVIEW.md">发布状态</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/popup-screenshot-dark.png">
    <img src="docs/popup-screenshot-light.png" width="420" alt="LoudEase 实时响度处理界面">
  </picture>
</p>

> [!NOTE]
> 当前版本仍是私有 Beta。README 只陈述已有实现和验证证据，不把测试目标包装成兼容承诺。

## 把网页声音收进舒服的范围

网页音频经常在低声对白、突然音效、音乐、广告和不同创作者的母带音量之间跳变。普通音量条只能让所有声音一起变大或变小；单纯增强容易破音；固定压缩又可能产生明显抽吸感。

LoudEase 不是音量放大器，也不是均衡器。它遵循三条清晰原则：

| | LoudEase 的处理方式 |
|---|---|
| **压住大声** | 快速降低持续的大声，并用前视限幅器接住短促峰值。 |
| **轻提小声** | 只有检测到真实信号且存在峰值余量时，才进行受控提升。 |
| **尊重控制** | 播放器静音和零音量是硬边界；没有新鲜运行证据时，界面不会假装已经生效。 |

目标不是把所有声音压成一条直线，而是在保留必要层次的同时，缩小让人不舒服的响度落差。

## 真正的实时音频链路

```text
用户授权的标签页
  -> 整页音频捕获
  -> K-weighted 响度分析
  -> 双时间窗增益调节
  -> 前视峰值限幅
  -> 播放器音量边界
  -> 本机输出
```

- 整页捕获覆盖授权标签页中的媒体元素、直播和 Web Audio。
- AudioWorklet 负责实时处理，不把音频控制循环塞进网页或 Service Worker。
- 压大声和提小声是两套独立策略，不用一条粗暴压缩曲线解决所有问题。
- 音频只在本机处理，原始声音不会上传或用于分析。

准确算法、参数依据和当前缺口见 [声音算法说明](docs/AUDIO_DSP.md)。

## 体验测试版

要求 Chrome 116+、Node.js 20+。

```bash
git clone https://github.com/WSL043/loudease.git
cd loudease
npm install
npm run build:dev
```

打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，然后选择 `dist/github-dev`。

1. 打开正在播放声音的普通网页。
2. 点击一次 LoudEase，为当前标签页授权。
3. 出现实时时域状态和当前 dB 调整值后，才代表真正接管。
4. 只有默认听感不合适时，再调整“压大声”和“提小声”。

Chrome 要求 `tabCapture` 由用户手势启动，因此全新标签页不能静默接管。这是浏览器安全边界，不是站点适配失败。

## 兼容范围

| 证据级别 | 当前范围 |
|---|---|
| Beta 基线 | YouTube 视频/直播、Bilibili 视频/直播、抖音视频/直播 |
| 本地回归 | HTML5 媒体、SPA 换源、iframe、Web Audio、静音与播放器音量边界 |
| 扩展矩阵 | Twitch、TikTok、Spotify Web Player、Vimeo、社交视频、地区平台和受保护流媒体 |

扩展矩阵是测试目标，不是兼容承诺。Chrome 内部页面以及 Chrome 拒绝捕获的页面不受支持。详见 [站点兼容](docs/SITE_ADAPTERS.md)、[已知限制](docs/KNOWN_LIMITATIONS.md) 和 [测试矩阵](docs/TEST_MATRIX.md)。

界面提供阿拉伯语、德语、英语、西班牙语、法语、日语、韩语、巴西葡萄牙语、俄语、简体中文和繁体中文，默认语言为英语。

<details>
<summary><strong>设置与站点规则</strong></summary>
<br>
<p align="center">
  <img src="docs/settings-screenshot-light.png" width="760" alt="LoudEase 设置页面">
</p>
</details>

## 开发与验证

```bash
npm test
npm run test:dsp
npm run test:slider
npm run test:release
npm run audit
```

`dist/github-dev` 保留默认关闭的贡献者诊断；`dist/store` 通过白名单构建移除 localhost 权限、诊断界面、符号和网络代码。修改权限或打包逻辑前请阅读 [构建说明](docs/BUILD.md)。

## 隐私与安全边界

- 音频样本只存在于本机扩展音频图中。
- 不包含广告分析或远程可执行代码。
- 设置使用 `chrome.storage.sync`，同步行为取决于用户的 Chrome 设置。
- LoudEase 不是经过校准的听力保护设备，无法控制系统增益、硬件放大或耳边实际声压。

详见 [隐私说明](PRIVACY.md)、[反馈与数据边界](docs/FEEDBACK.md) 和 [安全说明](SECURITY.md)。

## 参与贡献

欢迎提交问题和范围清晰的 PR。DSP 修改需要可复现输入、输出峰值、增益包络和听测记录；权限、捕获、存储或网络行为变化必须进行明确的隐私审查。请先阅读 [贡献指南](CONTRIBUTING.md)。

## 许可证

LoudEase 源代码使用 [Mozilla Public License 2.0](LICENSE) 发布。对 LoudEase 原有源文件的修改在对外分发时仍需公开；独立的新文件可以采用其他许可证。

LoudEase 名称和 Logo 不随源代码授权。欢迎合规分叉，但重新发布的产品必须使用不同的名称和视觉标识。详见 [商标政策](TRADEMARKS.md) 与 [NOTICE](NOTICE)。
