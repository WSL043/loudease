# Acceptance Audit

Current source of truth: version `0.8.1`. Runtime evidence must match this version to satisfy a release gate.

## Product acceptance

| Requirement | Status | Evidence |
|---|---|---|
| Authorized tab audio is rerouted through a live output graph | Pass | Isolated silent Chrome capture E2E and output meter state |
| Authorized tab audio remains audible and returns to the same baseline after stop | Pending | Requires current-version audible endpoint A/B; silent E2E deliberately cannot prove this |
| Loud material is reduced | Pass | DSP fixtures, worklet tests, OfflineAudioContext, Chrome E2E |
| Quiet material can be lifted | Pass | Signal-gated headroom fixtures and Chrome E2E |
| Silence is not amplified into noise | Pass | Synthetic silence fixture and gate tests |
| Short peaks stay below the sample ceiling | Pass | Look-ahead limiter tests, clustered peaks, zero expected overshoot |
| Stereo level ratio is preserved | Pass | Linked-channel impulse test |
| Mute and zero player volume produce zero output | Pass | Player-volume and mute E2E |
| Strength `0` disables its corresponding effect | Pass | Static policy and E2E assertions |
| Slider values persist without being pulled back | Pass | `tools/e2e_slider_persistence.js` |
| Dynamic source changes do not require page audio reattachment | Pass | Tab-wide capture and source-switch E2E |
| Multiple authorized tabs have independent sessions | Pass | Multi-capture assertions and runtime state model |
| Popup only claims active processing with fresh signal evidence | Pass | Truthfulness assertions and status TTL checks |
| Store build removes local diagnostics | Pass | Allowlist build and release verifier |
| Current-version six-site real-site smoke matrix | Pass | Isolated silent Chrome passed YouTube/Bilibili/Douyin video/live 6/6 on 2026-08-10 |
| Representative 30-minute real-site endurance | Pass | Bilibili live: 360 continuous samples, zero hard clips/native output, bounded heap growth |
| Controlled listening corpus | Pending | Required before stable `1.0.0` |

## Architecture acceptance

- The media-element engine is removed from the runtime.
- The main DSP loop is inside `programme-leveler-v4 AudioWorklet`.
- Main-thread analyser/controller code is fallback-only.
- The offscreen document is the source of truth for active captures.
- Status queries and repair commands are separate message types.
- Page-supplied globals do not trigger extension reloads.
- Development diagnostics require explicit opt-in and are absent from the store artifact.

## Release interpretation

Passing this audit means the repository is suitable for a public beta. It does not mean the extension is a medical device, a standards-compliant loudness meter, universally compatible, or ready for `1.0.0`.
