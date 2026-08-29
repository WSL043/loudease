# Architecture

This document describes the current `0.8.0` runtime. The runtime files and executable checks are the source of truth.

## Product boundary

The public store runtime processes audio from a user-authorized Chrome tab. Chrome normally requires `tabCapture` to start from a user invocation.

The trusted GitHub development build has an additional maintainer-only mode. When Chrome itself is launched with `--allowlisted-extension-id=<LoudEase ID>`, Chromium grants that one extension ID the per-tab capture capability at browser startup. The development service worker can then establish the same tab-capture pipeline during early navigation for the maintained YouTube, Bilibili, and Douyin site matrix, and for a new tab opened by an already protected tab. No second DSP or page-level audio graph is used. The store builder removes this orchestration path completely.

The production audio path is:

```text
tabCapture MediaStream
  -> offscreen AudioContext
  -> unified programme-leveler-v4 AudioWorklet
  -> player-volume boundary
  -> analyser used for output diagnostics
  -> local AudioDestinationNode
```

The old page-level `createMediaElementSource()` engine is no longer part of the runtime. `content/bridge.js` observes media and player-volume state only; it does not own the audio graph.

## Components

### Service worker (`background.js`)

- receives the user gesture from the popup;
- obtains a one-use `tabCapture` stream ID;
- creates or reuses the offscreen document through one shared creation promise, so concurrent tabs cannot race Chrome's single-document limit;
- tracks independent capture sessions by tab ID;
- aggregates lightweight page telemetry with offscreen DSP state;
- stores global and per-site settings;
- exposes status and recovery commands to the popup;
- owns opt-in development diagnostics, which are removed from the store build.
- in the trusted GitHub build only, starts allowlisted capture early for maintained media sites and inherited new tabs.

### Offscreen document (`offscreen/`)

The offscreen document is the source of truth for active audio sessions. Each authorized tab has one `CaptureSession` containing the stream, `AudioContext`, worklet node, player-volume gain, output analyser, state counters, and cleanup listeners.

`offscreen/leveler-worklet.js` is the normal processing path. It performs continuous measurement, gated programme estimation, stable programme-baseline correction, floor-qualified quiet-detail correction capped at 16 dB, independent fast loud protection, linked gain smoothing, mute/player-volume enforcement, and sample-peak look-ahead limiting on the audio render thread. `shared/programme-leveler-policy.js` is loaded into both the AudioWorklet scope and fallback page so the control law has one source of truth.

If the unified worklet cannot load, `offscreen/index.js` falls back to the older meter/controller/limiter graph. The fallback is intentionally conservative and is reported in diagnostics.

### Content bridge (`content/bridge.js`)

The background injects the isolated content script on demand into ordinary HTTP(S) frames for tabs that are audible, recognized media targets, already captured, or explicitly opened through the popup. Merely being the active tab is not enough. Unrelated pages do not receive it. The bridge reports:

- media element count and playback state;
- mute and volume observations;
- conflicting or unknown player-volume state;
- a local fingerprint used to reset programme measurement when page or media identity changes;
- lifecycle and frame freshness.

It does not patch `HTMLMediaElement.play`, does not call `createMediaElementSource`, and does not process PCM audio.
Status updates are event-driven while a tab is idle. The background explicitly polls only active capture sessions, so ordinary pages do not wake the service worker on a fixed heartbeat.

### Popup (`popup/`)

The popup is both the authorization surface and the compact status UI. Opening it provides the user gesture used for one automatic capture attempt. It shows active processing only when fresh offscreen signal evidence exists.

The two strength controls are independent:

- **Reduce loud sounds** maps to downward loudness control and peak protection.
- **Lift quiet sounds** maps to confidence-gated upward programme and within-programme correction, with a `+25 dB` cap, up to `10 dB` of bounded limiter allowance, and player-volume constraints.

### Monitor and options (`monitor/`)

The options page contains advanced settings, diagnostics export, and the development-only localhost sender switch. It separately reports whether the receiver actually answered, so a checked box is not presented as a live receiver. It is not part of the normal listening workflow.

## Session lifecycle

1. The public path begins when the user opens the extension on a normal tab. The trusted GitHub auto-protection path begins on an early tab URL event after Chrome was launched with the exact extension ID allowlisted.
2. The popup or GitHub-only service-worker path requests a `tabCapture` stream ID for that tab.
3. The service worker asks the offscreen document to consume the ID immediately.
4. The offscreen document creates a `CaptureSession` and resumes its `AudioContext` under the popup gesture or the browser-startup grant.
5. Status flows from the worklet to the offscreen session, then to the service worker and popup.
6. Navigation in the same captured tab can continue without rebuilding the graph; a changed programme fingerprint resets cumulative loudness state and inherited gain.
7. Closing the tab, stopping capture, disabling the extension, or losing the stream stops tracks, disconnects nodes, removes listeners, and closes the context.

## Multi-tab behavior

Captured tabs have independent sessions and settings views. Switching focus does not stop an existing captured tab. Concurrent startup requests await one offscreen-document creation and then create separate sessions. In the store runtime, a never-authorized tab remains outside the extension until the user invokes it there. In the allowlisted GitHub runtime, maintained media-site tabs and inherited new tabs are captured automatically before playback when Chrome exposes the startup grant.

## Player-volume boundary

The content bridge reports the active media volume and mute state when it can do so reliably. The DSP uses that state to:

- hard-mute output for mute or zero volume;
- reduce the upward-gain budget at lower player volume;
- lower the limiter ceiling proportionally when the player-volume state is reliable;
- disable upward lift when the state is conflicting or unsafe to infer.

This protects software intent. It cannot measure or control operating-system, DAC, amplifier, speaker, or headphone gain.

## Build separation

The repository produces two allowlist-based builds:

- `dist/github-dev`: trusted contributor build with opt-in localhost diagnostics and allowlisted automatic-capture orchestration;
- `dist/store`: public store runtime with localhost diagnostics and automatic-capture code removed.

The contributor build also exposes a test-only silent `AudioContext` sink for isolated E2E. It is never selected in ordinary use and is removed from the store target. `tools/assert_release_build.js` rejects forbidden paths, localhost or silent-E2E symbols, development markers, dynamic evaluation, missing runtime references, and invalid locale catalogs.

## Security boundaries

- Page content, titles, URLs, and media metadata are untrusted input.
- The page cannot request extension capture directly.
- Runtime version decisions use extension-owned state, not page-supplied globals.
- No remote JavaScript or Wasm is loaded.
- Audio samples do not leave the local Web Audio graph.
- Development diagnostics are off by default and absent from the store build.
- The Chromium startup allowlist grants silent tab capture to one exact extension ID. Use it only with a locally reviewed GitHub build, and remove the launch argument to roll back automatic protection.

## Source map

```text
background.js                 service worker and session orchestration
content/bridge.js             lightweight page observation
offscreen/index.js            capture session lifecycle and fallback graph
offscreen/leveler-worklet.js  primary DSP processor
offscreen/limiter-worklet.js  fallback look-ahead limiter
offscreen/meter-worklet.js    fallback render-thread meter
popup/                        authorization, status, and two user controls
monitor/                      options and diagnostics
shared/core.js                settings, measurement, and player-boundary helpers
shared/programme-leveler-policy.js  shared gated estimator and gain law
tools/                        build, static, DSP, E2E, and release checks
```
