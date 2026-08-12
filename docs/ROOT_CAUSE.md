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

Two later defects were found at those ownership boundaries:

- concurrent restored tabs could both observe "no offscreen document" and call `chrome.offscreen.createDocument()`, although Chrome permits only one; all callers now await one shared creation promise;
- within-programme positive dynamics treated a live programme's near-silence as a fully quiet programme, producing measured gain travel from about `+23 dB` to `-11 dB`; programme baseline, bounded detail lift, and fast protection are now distinct decisions in one policy.

A current Bilibili live trace then exposed three related control-boundary defects. In 58 seconds the programme reset counter moved from 10 to 16 because transient `blob:` media identities were treated as new programmes. Each reset returned gain to unity and rebuilt full upward confidence from only nine accepted blocks. At the same time, a quiet recent output peak could lower the next transition ceiling far below the programme safety crest, producing up to about 13 dB of limiter reduction. The resulting reset, relearn, and limiter-release cycle sounded like alternating small and large sections even though the steady controller reduced the measured middle-80% range.

Programme identity now normalizes ephemeral `blob:` and `srcObject` sources within one page, upward baseline confidence takes 40 accepted blocks, and transition protection uses one fixed programme-relative crest. Clearly audible quiet detail may use up to 12 dB, while the existing quiet floor still gives near-silence zero positive detail correction.

## Why this fixes source switching

`tabCapture` follows the tab's mixed output rather than a specific `<video>` node. When Bilibili, Douyin, YouTube, or another SPA replaces media elements, the capture stream remains attached to the tab. The bridge may update player-volume hints, but the DSP graph does not need to reconnect to the new element.

## Remaining hard boundary

Chrome requires a normal MV3 extension to be invoked by the user before a tab can be captured. The public store runtime must state this clearly and make per-tab authorization fast and observable. The trusted GitHub build can use Chromium's exact-ID browser-startup allowlist to pre-authorize its existing tab-capture path; this is an explicit browser-process configuration, not a second audio architecture, and it is stripped from the store build.

## Regression rules

- Do not reintroduce page-level PCM processing.
- Do not use page-supplied version values to reload the extension.
- Do not make status reads mutate or repair runtime state.
- Do not claim processing from a preference flag alone.
- Do not call offscreen-document creation outside the shared lifecycle.
- Do not let moment-to-moment quiet detail consume the full programme-normalization range.
- Do not reset a live programme because an ephemeral blob URL or `srcObject` instance changed.
- Do not let recent quiet output lower the next onset ceiling below the fixed programme safety crest.
- Do not ship localhost diagnostics in the store target.
- Do not add broad permissions without an implemented feature and public justification.
