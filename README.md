<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-ai-a-dark.png">
    <img src="assets/logo-ai-a-light.png" width="112" alt="LoudEase logo">
  </picture>
</p>

<h1 align="center">LoudEase</h1>

<p align="center"><strong>Smooth the jumps. Keep the detail. Stay in control.</strong></p>

<p align="center">
  LoudEase makes web audio more comfortable by calming sudden loudness and carefully lifting quiet detail.<br>
  Player volume and mute always remain authoritative.
</p>

<p align="center">
  <a href="https://github.com/WSL043/loudease/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/WSL043/loudease/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Private beta" src="https://img.shields.io/badge/status-private%20beta-f59e0b">
  <img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome-MV3-2563eb">
  <img alt="Local AudioWorklet" src="https://img.shields.io/badge/processing-local%20AudioWorklet-159669">
  <a href="LICENSE"><img alt="GPL 3.0 only License" src="https://img.shields.io/badge/license-GPL--3.0--only-17202b"></a>
</p>

<p align="center">
  <a href="README_zh.md">简体中文</a> ·
  <a href="#install-the-private-beta">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#help-shape-loudease">Community testing</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="SUPPORT.md">Support</a>
</p>

<p align="center">
  <img src="store/assets/screenshot-balancing-1280x800.png" width="960" alt="LoudEase balancing an authorized browser tab with live input and output status">
</p>

> [!NOTE]
> LoudEase is currently a private beta. Compatibility statements below distinguish verified behavior from community test targets.

## A calmer listening range

Web audio rarely agrees on one comfortable level. Dialogue disappears, effects jump out, ads arrive hot, and the next creator or stream can sound completely different. A normal volume slider moves everything together; LoudEase works on the difference between moments.

| Calm sudden loudness | Recover quiet detail | Respect your controls |
|---|---|---|
| Fast gain reduction and a look-ahead limiter catch uncomfortable jumps and short peaks. | Quiet lift is restrained by signal confidence, available headroom, and the selected strength. | Mute and zero player volume are hard boundaries. The UI only says **active** when fresh runtime evidence exists. |

LoudEase is not a volume booster, an equalizer, or a calibrated hearing-protection device. It narrows disruptive level differences while preserving useful dynamics.

## How it works

<p align="center">
  <img src="docs/processing-flow.png" width="960" alt="Uneven input is measured, balanced, and peak limited into a narrower output range while retaining variation">
</p>

The authorized tab is captured as one audio stream, then processed locally in an `AudioWorklet`. K-weighted measurements guide separate loud-cut and quiet-lift policies; a look-ahead limiter protects peak headroom. No raw audio is uploaded.

For implementation details, assumptions, and current gaps, read [Audio DSP](docs/AUDIO_DSP.md), [Architecture](docs/ARCHITECTURE.md), and [Known limitations](docs/KNOWN_LIMITATIONS.md).

## One audio core, two distributions

| Chrome Web Store build | GitHub development build |
|---|---|
| The same DSP, popup, settings, languages, and per-site rules. Localhost diagnostics and contributor-only controls are physically removed from the package. | The complete open-source project, including opt-in local diagnostics, test pages, evidence tools, and reproducible store packaging. |

The store build is smaller for privacy and review compliance; it does not use a weaker balancing algorithm. The exact package boundary is enforced by an allowlist build and verified in CI. Store copy, permission explanations, privacy fields, and submission assets live in [`store/`](store/).

## Install the private beta

Requirements: Chrome 116+ and Node.js 20+.

```bash
git clone https://github.com/WSL043/loudease.git
cd loudease
npm install
npm run build:dev
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/github-dev`.

1. Open a normal `http` or `https` tab that is playing audio.
2. Click LoudEase once to authorize that tab.
3. A moving waveform and a current dB value confirm live processing.
4. Adjust **Reduce loud sounds** and **Lift quiet sounds** only when the defaults do not fit.

Chrome requires a user gesture before `tabCapture` starts. A completely new tab cannot be captured silently; after authorization, LoudEase can keep processing while you switch to another tab.

## Verified scope

| Evidence | Current scope |
|---|---|
| Private beta baseline | YouTube video/live, Bilibili video/live, Douyin video/live |
| Automated regression | HTML5 media, SPA source replacement, iframes, Web Audio, mute, zero player volume, slider persistence, and offline DSP graphs |
| Community test targets | Twitch, TikTok, Spotify Web Player, Vimeo, social video, regional services, and protected streaming |

Test targets are not compatibility promises. Chrome internal pages and surfaces Chrome refuses to capture are unsupported. See [Site adapters](docs/SITE_ADAPTERS.md) and the [Test matrix](docs/TEST_MATRIX.md).

The interface currently includes Arabic, German, English, Spanish, French, Japanese, Korean, Brazilian Portuguese, Russian, Simplified Chinese, and Traditional Chinese. English is the default.

## Help shape LoudEase

No single tester needs to cover every platform or run a two-hour endurance session. Small, reproducible checks are more useful:

- spend 10 minutes checking one site, source switch, mute, player volume, and tab switching;
- compare one dialogue, music, live, or transient-heavy sample with LoudEase on and off;
- review one translation in a language you use daily;
- contribute one focused fix with a regression test.

Start with the [community testing guide](docs/COMMUNITY_TESTING.md), then use the [issue chooser](https://github.com/WSL043/loudease/issues/new/choose) for compatibility, audio-quality, bug, or product feedback. Reports are voluntary and user-initiated; LoudEase contains no automatic telemetry service.

WSL043 maintains the official project. Use [Support](SUPPORT.md) and the GitHub Issue Forms for reports and proposals; [Governance](GOVERNANCE.md) defines the project boundary.

<details>
<summary><strong>Current settings and per-site controls</strong></summary>
<br>
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/settings-screenshot-dark.png">
    <img src="docs/settings-screenshot-light.png" width="840" alt="Current LoudEase settings page">
  </picture>
</p>
</details>

## Build and verify

```bash
npm test              # contracts, DSP tests, and offline audio graphs
npm run test:dsp      # focused DSP verification
npm run test:slider   # popup persistence regression
npm run test:release  # stripped Chrome Web Store package
npm run audit         # release-readiness evidence audit
```

`dist/github-dev` keeps contributor diagnostics available but off by default. `dist/store` removes localhost permissions, diagnostic UI, symbols, and network code through an allowlist build. Read [Build and release](docs/BUILD.md) before changing permissions or packaging.

Open beta and store gates are tracked in the evidence-based [Release readiness review](docs/RELEASE_READINESS_REVIEW.md).

## Privacy, safety, and license

- Audio stays inside the local extension audio graph.
- There is no advertising, analytics, silent telemetry, or remote executable code.
- Settings use `chrome.storage.sync`, subject to the user's Chrome Sync configuration.
- LoudEase cannot control operating-system gain, hardware amplification, or acoustic output at the ear.

See [Privacy](PRIVACY.md), [Feedback and data boundaries](docs/FEEDBACK.md), and [Security](SECURITY.md).

Source code is licensed under [GPL-3.0-only](LICENSE). Distributed derivative versions must provide the corresponding source under GPLv3. Copies previously distributed under historical Beta tags retain the license grants attached to those copies, even if a prerelease or tag is later removed from GitHub. The LoudEase name and logo are governed separately by the [Trademark Policy](TRADEMARKS.md); bundled icon notices are recorded in [Third-party notices](THIRD_PARTY_NOTICES.md).

The decision and transition boundary are explained in [Licensing](docs/LICENSING.md). Project authority and contribution rights are documented in [Governance](GOVERNANCE.md), [Contributing](CONTRIBUTING.md), and the [Developer Certificate of Origin](DCO). Asset origins and machine-readable license boundaries are recorded in [Asset provenance](ASSET_PROVENANCE.md) and [REUSE.toml](REUSE.toml).
