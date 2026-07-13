# Changelog

All notable public changes to LoudEase are recorded here.

## Unreleased

## 0.7.0-beta.1

- Introduced the LoudEase product name and a rebuilt English-first open-source presentation.
- Consolidated the runtime around one whole-tab capture path and one AudioWorklet loudness processor.
- Added separate loud-cut and quiet-lift controls, K-weighted dual-window analysis, and look-ahead peak limiting.
- Preserved player mute and zero volume as hard output boundaries.
- Added compact light/dark UI, per-site defaults, 11 locales, and truthful live processing state.
- Split contributor and Chrome Web Store builds so local diagnostics are removed from store packages.
- Added deterministic DSP, OfflineAudioContext, popup persistence, packaging, and CI checks.

Earlier private prototypes and patch-by-patch development logs are intentionally excluded from the public source history. The current runtime, canonical documentation, and executable tests are the source of truth.
