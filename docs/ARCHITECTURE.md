# Architecture

This document describes the current `0.8.2` runtime. The runtime files and executable checks are the source of truth.

Unreleased control fixes retain this same capture path. Windows/session volume
remains downstream and user-owned; page-player attenuation is accounted for in
worklet measurement, not canceled in playback. See [volume intent](VOLUME_INTENT.md).

## Product boundary

LoudEase has two entry points into one DSP. **Automatic mode** (default) attaches to eligible audible media elements from a content script and needs no click. **Tab capture** processes a whole tab after the user invokes LoudEase; it is the fallback for media automatic mode cannot safely attach to. Chrome requires `tabCapture` to start from a user invocation.

The tab-capture audio path is:

```text
tabCapture MediaStream
  -> offscreen AudioContext
  -> unified programme-leveler-v4 AudioWorklet
  -> player-volume boundary
  -> analyser used for output diagnostics
  -> local AudioDestinationNode
```

The automatic-mode path is:

```text
<audio>/<video> element (audible, eligible)
  -> MediaElementAudioSourceNode (content script AudioContext)
  -> unified programme-leveler-v4 AudioWorklet (same files as above)
  -> AudioDestinationNode
```

`content/bridge.js` still only observes media and player-volume state for the capture path; it does not own an audio graph. See [Automatic mode](#automatic-mode-contentauto-enginejs).

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

### Offscreen document (`offscreen/`)

The offscreen document is the source of truth for active audio sessions. Each authorized tab has one `CaptureSession` containing the stream, `AudioContext`, worklet node, player-volume gain, output analyser, state counters, and cleanup listeners.

`offscreen/leveler-worklet.js` is the normal processing path. It performs continuous measurement, gated programme estimation, stable programme-baseline correction, floor-qualified quiet-detail correction capped at 16 dB, independent fast loud protection, linked gain smoothing, mute/player-volume enforcement, and sample-peak look-ahead limiting on the audio render thread. `shared/programme-leveler-policy.js` is loaded into both the AudioWorklet scope and fallback page so the control law has one source of truth.

If the unified worklet cannot load, `offscreen/index.js` falls back to the older meter/controller/limiter graph. The fallback is intentionally conservative and is reported in diagnostics.

### Automatic mode (`content/auto-engine.js`)

A static content script on HTTP(S) frames (`all_frames`, `document_idle`). It is inert on pages without media: it only listens for media events and DOM additions and never messages the service worker until a candidate is audible.

An element is attached only when it is audible and eligible. `createMediaElementSource` silences cross-origin media without CORS and protected (EME) media, so these are never attached; the popup then falls back to tab capture. Attachment order is fixed: create the `AudioContext`, confirm it is `running` (otherwise wait for a user gesture), load the leveler worklet from a web-accessible resource, configure the node, wait for its `configured` acknowledgement, and only then create the element source and connect it. A `processorerror` or stale worklet state routes the element straight to the destination.

Settings, per-site rules, and the automatic-mode switches (`webVolumeBalancer.autoMode`) are resolved by the service worker (`WVB_AUTO_CONFIG`). The engine never talks to the service worker on a timer: it reports on attach/detach/block, and the service worker pulls a summary when the popup opens. When a tab capture is live, the service worker sends `WVB_AUTO_REFRESH` and the engine bypasses processing so audio is never processed twice. The action badge shows `ON` while automatic mode is processing a tab.

The worklet loads from `chrome-extension://` URLs listed in `web_accessible_resources` (with `use_dynamic_url`); this works under strict page CSP, unlike blob URLs, which strict CSP blocks (`tools/e2e_auto_mode.js`).

Known scope limits: elements created with `new Audio()` and never attached to the DOM are not observed (no prototype patching), and pages that build their own Web Audio graph are not attached. Both fall back to tab capture.

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

The advanced settings page also stores a target loudness from `-22 dB` to `-16 dB`. The balanced default remains `-19 dB`; the value can be global or overridden per hostname and is passed to each live capture without rebuilding the graph.

### Monitor and options (`monitor/`)

The options page contains advanced target-loudness settings, global and per-site strength overrides, diagnostics export, and the development-only localhost sender switch. It separately reports whether the receiver actually answered, so a checked box is not presented as a live receiver. It is not part of the normal listening workflow.

## Session lifecycle

1. The session begins when the user opens the extension on a normal tab.
2. The popup requests a `tabCapture` stream ID for that tab.
3. The service worker asks the offscreen document to consume the ID immediately.
4. The offscreen document creates a `CaptureSession` and resumes its `AudioContext` under the popup gesture.
5. Status flows from the worklet to the offscreen session, then to the service worker and popup.
6. Navigation in the same captured tab can continue without rebuilding the graph; a changed programme fingerprint resets cumulative loudness state and inherited gain.
7. Closing the tab, stopping capture, disabling the extension, or losing the stream stops tracks, disconnects nodes, removes listeners, and closes the context.

## Multi-tab behavior

Captured tabs have independent sessions and settings views. Switching focus does not stop an existing captured tab. Concurrent user-authorized requests await one offscreen-document creation and then create separate sessions. A never-authorized tab remains outside the extension until the user invokes it there.

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
- LoudEase never modifies Chrome startup arguments or browser profiles. Each newly selected tab is captured only after an explicit user action.

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
