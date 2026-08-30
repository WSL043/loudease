# Research and design basis

The runtime combines established browser and audio engineering techniques. The value is in their browser-safe integration, bounded policy, tuning, and verification rather than a claim of a novel scientific algorithm.

## Primary references

- [Chrome `tabCapture` API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture): user invocation, stream IDs, offscreen consumption from Chrome 116, and capture lifecycle.
- [Chromium `tabCapture` implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/extensions/api/tab_capture/tab_capture_api.cc): the normal per-tab user-invocation grant check and stream-ID lifecycle.
- [Chrome offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen): long-lived extension document for DOM and Web Audio work unavailable to a service worker.
- [Web Audio API](https://www.w3.org/TR/webaudio-1.1/): `AudioContext`, `AudioWorklet`, channel handling, parameters, and processing model.
- [ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770): perceptual weighting and loudness measurement basis.
- [EBU R 128](https://tech.ebu.ch/publications/r128): broadcast loudness and true-peak guidance.
- [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies/policies): single purpose, accurate claims, privacy, and minimum permissions.

## Design decisions

### Full-tab capture instead of media-element sources

Tab capture avoids one-source-node ownership conflicts and follows SPA media replacement, live players, and page Web Audio. The tradeoff is mandatory per-tab user authorization. LoudEase keeps that browser security boundary intact in development and store builds.

### Programme-centred control instead of one fixed compressor

The product needs programme-level consistency and fast peak protection. One aggressive compressor can pump, alter transients, and make music tiring. The current design uses gated cumulative programme measurement, one relative gain law, one asymmetric envelope, and final limiting.

### Confidence-gated bounded upward gain

Quiet material is not automatically safe to amplify. Low RMS can coexist with high peaks or noise. Upward gain therefore waits for gated programme confidence and depends on captured-domain peak headroom and player-volume reliability. Full strength is capped at `25 dB` and can use up to `10 dB` of bounded look-ahead limiter allowance; lower settings scale both down.

### Sample-peak look-ahead limiter

A short delay lets the processor reduce gain before a buffered peak reaches the output. The current 5 ms sample-peak limiter protects normal PCM fixtures but is not a true-peak estimator; oversampling remains future work.

### Runtime truth before UI claims

An enabled setting is only user intent. The popup requires capture state, signal ticks, and a fresh meter timestamp before it says audio is being processed.

## Comparable open-source work

Many browser compressor extensions insert a native `DynamicsCompressorNode` into individual media elements. That is a useful baseline, but it inherits media-source ownership and cross-origin/SPA limitations. LoudEase differentiates through full-tab capture, a unified worklet, upward-gain safety policy, multi-session lifecycle, and release/runtime verification.

These differences are engineering depth, not an uncopyable secret. A public implementation should compete on trustworthy behavior, tuning evidence, compatibility, UX, and maintenance quality.

## Evidence policy

- Synthetic PCM proves mathematical invariants and regressions.
- OfflineAudioContext proves browser graph behavior.
- Isolated Chrome E2E proves capture and extension lifecycle.
- Real-site runs prove compatibility only for the tested browser, site, date, and scenario.
- Listening tests are required for perceptual claims such as pumping, distortion, clarity, or fatigue.

No single evidence layer substitutes for the others.
