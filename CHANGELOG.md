# Changelog

All notable public changes to LoudEase are recorded here.

## Unreleased

- Replaced the accumulated fixed-target loud/quiet controller with one programme-centred gain law shared by the primary AudioWorklet and fallback path.
- Added constant-memory gated programme loudness estimation that persists through pause/resume and resets when the active media programme changes.
- Calibrated the new policy against independent-model and legacy-reference experiments, including startup onset, dynamics, player-volume equivalence, programme-boundary, and clipping checks.
- Tightened the first 40 ms after a loud onset in proportion to the loud-cut strength, closing the audible gap before the 20 ms programme controller catches up.
- Removed the fixed all-page status heartbeat and reduced active AudioWorklet diagnostic messages from 50 Hz to about 10 Hz without changing render-thread DSP cadence.
- Made already-stopped capture cleanup return promptly when no offscreen audio document exists.
- Strengthened full-scale quiet leveling so genuinely quiet passages move toward the same bounded target as loud material.
- Replaced the quiet detector's mean-energy window with a robust 100 ms median window so isolated peaks no longer suppress the whole passage.
- Added a strength-scaled, bounded look-ahead limiter allowance for high-crest quiet material, plus convergence and no-hard-clip regressions.
- Added isolated silent-output Chrome E2E for local capture, six real-site smoke scenarios, and configurable endurance runs, with per-run profiles, continuous-signal/source-state guards, native-output rejection, clipping/heap checks, and store-build stripping.
- Added a reproducible Chrome renderer for current-version documentation and Chrome Web Store screenshots, replacing stale versioned assets.
- Relicensed future LoudEase versions from MPL-2.0 to GPL-3.0-only so distributed derivative extensions must keep their corresponding source available. Historical tagged releases retain their original license grants.
- Added founder-led governance, DCO sign-offs, CODEOWNERS, machine-readable license metadata, asset provenance, and third-party icon notices.
- Added a public, Issue-based support route while keeping official maintenance and releases under WSL043.

## 0.7.1-beta.2

- Added a direct, localized route from Settings to the structured listening-feedback form.

## 0.7.1-beta.1

- Added a one-click light/dark theme switch to the popup, synchronized with the options page.
- Reworked voluntary support reports into a versioned, privacy-safe DSP snapshot with signal and limiter evidence.
- Added structured listening feedback fields for consistency, artifacts, content type, and strength settings.
- Replaced the MIT release posture with MPL-2.0 plus separate notice and trademark policies.
- Refined the settings, report, localization, theme-logo, and Chrome Web Store packaging paths.

## 0.7.0-beta.1

- Introduced the LoudEase product name and a rebuilt English-first open-source presentation.
- Consolidated the runtime around one whole-tab capture path and one AudioWorklet loudness processor.
- Added separate loud-cut and quiet-lift controls, K-weighted dual-window analysis, and look-ahead peak limiting.
- Preserved player mute and zero volume as hard output boundaries.
- Added compact light/dark UI, per-site defaults, 11 locales, and truthful live processing state.
- Split contributor and Chrome Web Store builds so local diagnostics are removed from store packages.
- Added deterministic DSP, OfflineAudioContext, popup persistence, packaging, and CI checks.

Earlier private prototypes and patch-by-patch development logs are intentionally excluded from the public source history. The current runtime, canonical documentation, and executable tests are the source of truth.
