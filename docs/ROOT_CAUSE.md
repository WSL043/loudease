# Root-cause retrospective

## Original failure pattern

The early extension mixed two competing processing architectures:

1. page-level `createMediaElementSource()` processing attached to individual media elements;
2. full-tab `tabCapture` processing in an offscreen document.

They had no single owner for audio state, lifecycle, or recovery. Site SPAs replaced elements, other extensions created media source nodes first, extension updates left old page code alive, and popup status tried to reconcile incompatible runtimes.

## Root mechanism

`HTMLMediaElement` can only be connected to a `MediaElementAudioSourceNode` once. Re-injection, multiple extensions, or competing page code therefore produced `InvalidStateError`. Retrying did not repair ownership; it repeated the forbidden operation.

The dual architecture also created:

- unprocessed audio leaks during element replacement;
- stale “enabled” state without a live graph;
- reload loops driven by mixed runtime versions;
- page-wide observers and prototype patches running even when unused;
- status fields copied between page, service worker, and popup without one authoritative owner.

## Resolution

The runtime now has one primary audio path:

```text
popup gesture or trusted GitHub startup grant -> tabCapture -> offscreen CaptureSession -> programme-leveler-v4 AudioWorklet -> output
```

The content bridge is observation-only. It never calls `createMediaElementSource()` and does not patch media prototypes. The offscreen session owns PCM state; the service worker owns orchestration; the popup owns user intent and display.

## Why this fixes source switching

`tabCapture` follows the tab's mixed output rather than a specific `<video>` node. When Bilibili, Douyin, YouTube, or another SPA replaces media elements, the capture stream remains attached to the tab. The bridge may update player-volume hints, but the DSP graph does not need to reconnect to the new element.

## Remaining hard boundary

Chrome requires a normal MV3 extension to be invoked by the user before a tab can be captured. The public store runtime must state this clearly and make per-tab authorization fast and observable. The trusted GitHub build can use Chromium's exact-ID browser-startup allowlist to pre-authorize its existing tab-capture path; this is an explicit browser-process configuration, not a second audio architecture, and it is stripped from the store build.

## Regression rules

- Do not reintroduce page-level PCM processing.
- Do not use page-supplied version values to reload the extension.
- Do not make status reads mutate or repair runtime state.
- Do not claim processing from a preference flag alone.
- Do not ship localhost diagnostics in the store target.
- Do not add broad permissions without an implemented feature and public justification.
