# Chrome Web Store dashboard update checklist (0.9.1)

The dashboard cannot be edited through the API or by browser automation. Do these steps by hand in Chrome, in about ten minutes. Open the item: https://chrome.google.com/webstore/devconsole (LoudEase). A submission of 0.9.1 is already pending review; edit the sections below, then use **Submit for review** again (Japanese UI: 審査に送信) so listing changes go out with it.

## 1. Store listing tab (ストアの掲載情報)

### 1.1 Language: English (default)

**Title (名前)**: comes from the package (`LoudEase: Auto Volume Normalizer`). Nothing to type.

**Summary (概要)**: also comes from the package. Nothing to type.

**Description (詳細な説明)**: replace with:

```
LoudEase is an automatic volume normalizer for Chrome. It pulls loud ads and sudden peaks down and lifts quiet dialogue, so you stop reaching for the volume control.

Install it and play something. No clicks, no setup. LoudEase balances audible video and audio on ordinary web pages by itself, and the toolbar icon shows ON while it is working.

WHAT YOU GET
- Loud ads, jump scares and peaks come down (fast protection plus a 5 ms look-ahead limiter)
- Quiet dialogue and quiet videos come up (bounded, strength-controlled lift)
- Steadier volume from one video, stream or creator to the next
- Your mute and player volume stay in charge; LoudEase never overrides them
- Three calibrated targets (Gentle, Balanced, Strong), per-site rules, and a per-site off switch
- 100% on-device processing with Web Audio and AudioWorklet: no accounts, no ads, no analytics
- 11 interface languages

HOW IT DIFFERS FROM A VOLUME BOOSTER
A booster makes everything louder, peaks included. LoudEase measures programme loudness and moves loud and quiet passages toward a common level, so you choose the overall volume with the player as usual.

WORKS WITH
HTML5 video, music and live streams on ordinary web pages. Verified with no clicks on YouTube and Bilibili. Some audio cannot be attached automatically because Chrome protects it (cross-origin media without CORS, DRM streams, pages that build their own audio graph). There, open LoudEase once on that tab to use full-tab capture instead.

PRIVACY
Audio is processed on your device and never recorded or uploaded. A lightweight local observer reads only page media state (playing, muted, volume) and never page text, forms, cookies or credentials. No advertising, analytics or remote code.

LoudEase is a listening-comfort tool, not hearing protection or a medical device. It is a public beta: please report compatibility or audio-quality problems through the support link without including private URLs.
```

**Category (カテゴリ)**: choose **Tools** (was Accessibility).

**Screenshots (スクリーンショット)**: delete the old ones and upload, in this order (1280x800), from the repository folder `store/assets/`:
1. `screenshot-balancing-1280x800.png`
2. `screenshot-onboarding-1280x800.png`
3. `screenshot-settings-1280x800.png`

**Small promo tile (小さいプロモーション タイル)**: upload `promo-small-440x280.png`.

### 1.2 Optional: Simplified Chinese listing

Add the language 中文 (简体) in the listing language selector, then paste:

**Name**

```
LoudEase：自动音量均衡器
```

**Summary**

```
自动音量均衡：压低突然的大声和广告，提亮听不清的小声对白。无需逐个标签点击，本地处理不上传。
```

**Description**

```
LoudEase 是 Chrome 的自动音量均衡器。它会压低突然冲出来的广告和大声，提亮听不清的小声对白，让你不用再频繁去调音量。

装好、播放就行，不需要点击，也不需要设置。LoudEase 会自动平衡普通网页里正在播放的视频和音频，工作时工具栏图标会显示 ON。

主要功能：

- 压低广告、惊吓音效和突然的峰值（快速保护加 5 ms 前视限幅）；
- 提亮小声对白和音量偏小的视频（有上限、强度可调的提升）；
- 不同视频、直播、主播之间的音量更稳定；
- 始终尊重网页静音和播放器音量，不会越过你的设置；
- 三档校准目标（柔和、均衡、强力）、按站点规则、按站点一键关闭；
- 完全在本机用 Web Audio 和 AudioWorklet 处理，无账号、无广告、无分析工具；
- 支持 11 种界面语言。

和音量增强器有什么不同：
增强器会把所有内容都变响，连峰值也不放过。LoudEase 会测量节目响度，把大声和小声片段拉向同一个水平，整体音量仍由播放器控制。

适用范围：
普通网页里的 HTML5 视频、音乐和直播。已在 YouTube 和 Bilibili 上实测无需点击即可生效。少数音频因 Chrome 的保护无法自动接入（缺少 CORS 的跨域媒体、DRM 流媒体、自建音频图的页面），此时在该标签页打开一次 LoudEase 即可改用整页接管。

隐私：
音频只在你的设备上处理，不会被录制或上传。轻量本地观察器只读取页面媒体状态（是否播放、静音、音量），不读取页面文字、表单、Cookie 或凭据。没有广告、分析工具或远程代码。

LoudEase 是提升聆听舒适度的工具，并非听力保护装置或医疗器械。目前为公开测试版，遇到兼容性或音质问题请通过支持链接反馈，并且不要附上私人网址。
```

(This Chinese text is a draft; read it once before publishing.)

## 2. Privacy tab (プライバシー)

**Single purpose (単一の目的)**:

```
Make web audio more comfortable by reducing sudden loud sections and applying bounded, strength-controlled lift to genuine quiet passages while respecting mute and the player's current volume.
```

**Permission justifications (権限の理由)**: paste each into the matching field. Fields for permissions you do not see can be left as they are.

**`storage`**

```
Saves the enabled state, appearance and language choices, two balance strengths, and per-site rules. Settings use Chrome Sync when the user has Sync enabled; LoudEase operates no settings server.
```

**`activeTab`**

```
Grants temporary access to the tab on which the user invokes LoudEase. Chrome uses that user-authorized tab as the target of `tabCapture`; the grant is not used to read unrelated tabs.
```

**`scripting`**

```
Injects the bundled automatic-mode content script into pages that were already open when the extension was installed or updated, and restores the media-state observer after navigation. It never injects remote code.
```

**`tabCapture`**

```
Obtains the audio stream for the current tab after the user invokes LoudEase. The stream is processed and played locally.
```

**`offscreen`**

```
Hosts the local Web Audio and AudioWorklet graph because an MV3 service worker cannot own the required DOM audio context.
```

**`http://*/*`, `https://*/*`**

```
Lets the bundled automatic-mode content script attach to audible `<audio>`/`<video>` elements on ordinary web pages and follow their mute, volume, and source state so the DSP preserves user intent. It also provides current-page access needed for per-site rules and capture-session recovery. No page text, form data, cookies, or credentials are read.
```

**`web_accessible_resources` (`offscreen/leveler-worklet.js`, `shared/programme-leveler-policy.js`)**

```
Let the content script load the bundled AudioWorklet processor into the page's own audio context. This is the only way to run the processor there under strict page CSP. The files are inert without the extension and contain no page or user data.
```

**Remote code**: No, the extension does not use remote code.

Data usage and certifications: keep the existing answers (Website content and Web history handled locally; all three Limited Use certifications ticked; privacy policy URL `https://github.com/WSL043/loudease/blob/main/PRIVACY.md`).

## 3. Distribution tab (配布)

No change (Public, all regions).

## 4. Test instructions tab (テスト手順)

Replace with:

```
## Basic review path

1. Open a normal HTTP(S) page with audible HTML5 video or audio. A public YouTube video is sufficient; protected browser pages such as `chrome://` cannot be captured.
2. Start playback. No click on LoudEase is needed: within a few seconds the toolbar icon shows **ON**. (Automatic mode; Chrome may keep the audio context suspended until you have clicked or pressed a key on the page once.)
3. Open **LoudEase** from the toolbar and confirm the popup shows an active state and that the input/output waveform moves while sound is present.
4. Move **Reduce loud sounds** and **Lift quiet sounds**. Close and reopen the popup to confirm that the values persist.
5. Mute the website player or set its volume to zero. LoudEase must not produce audible output. Restore the player volume to continue.
6. Open the extension settings page, change **Target loudness** between Gentle (`-22 dB`), Balanced (`-19 dB`), and Strong (`-16 dB`), then reopen Settings to confirm that the calibrated baseline persists. The page also exposes site rules, appearance, language, and the local-only support report.
7. Untick **Balance this site automatically** in the popup. Processing must stop (the **ON** badge disappears) and the site's ordinary audio must continue unchanged. Tick it again to resume.
8. Optional fallback path: for audio automatic mode declines to attach (cross-origin media without CORS, DRM streams), open the popup on that tab; it offers full-tab capture through the standard Chrome user gesture. Choose **Stop balancing** to end that session.

## Permission behavior

- Automatic mode attaches only to audible `<audio>`/`<video>` elements and needs no capture permission. It never attaches to cross-origin media without CORS or to DRM media, which Chrome would silence.
- `tabCapture` (fallback path) starts only after the reviewer invokes LoudEase on a tab.
- `activeTab` identifies that user-authorized capture target.
- `web_accessible_resources` expose only the two AudioWorklet files the content script loads into the page's audio context.
- `offscreen` owns the local Web Audio and AudioWorklet processing graph required by Manifest V3.
- `storage` saves preferences and per-site strength settings.
- `scripting` plus HTTP(S) host access runs the bundled content script that attaches to media, follows mute/player-volume intent, and restores after navigation. It does not read page text, forms, cookies, credentials, or general click/keyboard activity; the only page events it listens for are media events and a single first click/key press, used solely to let Chrome start its audio context.

All audio processing is local. The store package contains no localhost diagnostics, remote executable code, advertising, analytics, or automatic telemetry.

## Expected limitations

- Automatic mode cannot attach to cross-origin media without CORS, DRM media, pages that build their own Web Audio graph, or `new Audio()` elements never inserted into the page. Chrome requires a user gesture for every tab-capture fallback.
- Browser-internal, protected, and unsupported surfaces cannot be captured.
- Site navigation or player replacement can occasionally require the user to reopen the popup and authorize capture again.
- LoudEase is a listening-comfort tool, not hearing protection, a medical device, or broadcast-standard loudness normalization.
```

## 5. Submit

Click **Submit for review** (審査に送信). If the dashboard says a submission is already pending, choose to update it; the package is already uploaded (0.9.1).

## What each change achieves

- **Category Tools**: the volume-tool listings people compare against are in Tools; Accessibility has almost no browsing traffic.
- **Description and screenshots**: lead with "auto volume normalizer, no clicks", which is what a searcher types and what the extension now does.
- **Permission text**: explains the automatic-mode content script; a mismatch with the package is the most likely cause of a review question.
