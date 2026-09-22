# Release Readiness Review

Review baseline: version `0.8.2` public beta with a configurable target-loudness baseline, unified AudioWorklet DSP, independent multi-tab capture sessions, an internationalized compact popup, and separate development/store builds.

Published-package audit: `2026-09-12`. Static, DSP, isolated-Chrome slider/capture, release-build, and package checks passed for `0.8.2`; the capture matrix passed 8/8 and the YouTube/Bilibili/Douyin site matrix passed 6/6. The production AudioWorklet also passed 15 multirate assertions at 44.1, 48, and 96 kHz for finite output, quiet lift, loud calibrated output, sample-safe limiting, and hard mute. The earlier passing 30-assertion inter-sample screen was incomplete: it omitted a failing waveform. The corrected strict audit reproduces nine over-full-scale cases; see `docs/DSP_EVALUATION.md`. The verified store package contains 44 runtime files and reproduced the same SHA-256 (`6C212FAEAC5D428A878CCAEAA7BDAF611BFB999F60E8387CF90DCB9B351422F9`) across consecutive builds. A current-version Bilibili live endurance run passed for `1,800,005 ms` with 360 continuous samples, `89,907` fresh signal ticks, zero hard-clipped samples, one live audio track, and peak heap growth of `753,984 bytes`; stop cleanup passed. Historical Windows endpoint A/B evidence remains useful context but is not presented as a new `0.8.2` measurement. These measurements prove the pipeline and restoration behavior, not universal listening preference.

Unreleased integration (`2026-09-12`): the audio worklet precomputes fixed coefficients, with exact stereo PCM/state parity against `afcfff1` in the three-rate comparison. Its measured Node VM render-time reduction is approximately 9-12%; Chrome CPU savings are not yet measured. This change is on the development path and is not included in the existing `0.8.2` public package or its checksum above.

## Decision

Unreleased 2026-09-22: manual-volume measurement and source-boundary fixes are
qualified separately in [VOLUME_INTENT.md](VOLUME_INTENT.md). These change PCM
during control transitions; historical coefficient-only parity is not a claim
about these functional changes. Existing release checksums and store publication
remain unchanged. Candidate true-peak detection is still not shipped.

| Target | Decision | Reason |
|---|---|---|
| Published `0.8.2` package | Existing verified beta | The archived ZIP and checksum identify the published runtime; later main-branch work is not a new release |
| Next local release candidate | Pending | Rebuild and qualify an explicitly versioned package from the next reviewed commit before upload |
| Public GitHub beta | Published | `v0.8.2-beta.1` targets the tested source commit and contains the matching verified store ZIP |
| Chrome Web Store public beta | Published; listing revision pending | Version `0.8.2` is public for general availability; a package-neutral third-screenshot revision is waiting for review and configured for automatic publication |
| Version `1.0.0` | Not yet | Requires the stable-release gates in `docs/VERSIONING.md` |

## Confirmed implementation

- One primary processing architecture: `tabCapture -> offscreen -> programme-leveler-v4 AudioWorklet -> destination`.
- A lightweight bridge is injected on demand into audible, recognized-media, captured, or explicitly opened HTTP(S) tabs. It observes media/player state but does not process audio; there is no manifest-wide content-script injection.
- Continuous worklet measurement, gain control, mute/player-volume enforcement, and sample-peak limiting.
- Two independent user strengths with persistence regression coverage.
- Independent capture ownership for multiple authorized tabs.
- Development diagnostics are opt-in and removed from the store build.
- Eleven locale catalogs with English as the default.
- GPL-3.0-only license for future versions, preserved historical license grants, founder-led governance, DCO, CODEOWNERS, asset provenance, trademark policy, privacy policy, security policy, contribution guide, and CI workflow.

## Automated gates

Before every release candidate:

```bash
npm test
npm run test:dsp
npm run test:capture
npm run test:sites
npm run test:long -- --duration-ms 30000
npm run test:slider
npm run test:release
npm run package:store
npm run audit
```

The store verifier must confirm:

- no localhost permission or URL, no diagnostics or silent-E2E symbol, and no development marker;
- no forbidden source, docs, tests, tools, secrets, archives, or logs;
- no dynamic evaluation or remote executable code;
- all manifest, locale, CSS, HTML, worklet, and icon references exist;
- a valid default locale and complete translated message catalogs.

## Remaining post-publication and stable-release gates

1. Verify the third-screenshot revision after Chrome Web Store approval and record its publication date before starting the matched 14-day acquisition window.
2. Recheck the public homepage, privacy, support, and install URLs for every update.
3. Keep the retained HTTP(S) host-permission rationale from `store/PRIVACY_PRACTICES.md` aligned with the published package. The permission is used only to restore media/player observation on useful, captured, or explicitly opened tabs across navigation; it does not process audio or collect browsing history.
4. Confirm every future store build still has zero remote telemetry. Any future extension data collection must pass `docs/DATA_GOVERNANCE.md` and ship with new explicit consent and store disclosures.
5. Monitor the Chrome Web Store Support Hub, ratings, installs, uninstalls, impressions, weekly users, and store-managed GA4 acquisition data. Treat the Users report as installation evidence, not active-use telemetry.
6. Resolve the strict inter-sample audit's retained counterexamples and expand it with encoded real-world fixtures. The previous `2.4 dB` margin excluded a failing waveform and must not be cited as evidence that the true-peak gap is closed.
7. Complete a current `0.8.2` audible endpoint start/stop A/B and the broader stable-release listening and endurance gates before promoting the product to `1.0.0`.

The broader multi-content listening matrix and project-defined two-hour mixed-content endurance session remain `1.0.0` stable-release gates. A clearly labeled public beta is the mechanism for collecting real-user compatibility and listening feedback when no private tester pool exists; it must not be marketed as universal compatibility or universally preferred sound.

## Residual technical risk

- The public store runtime still requires a user gesture for a new tab capture; the GitHub startup-allowlist path must remain absent from the verified store ZIP.
- Sample-peak limiting does not catch every inter-sample true peak.
- Full-strength transition protection intentionally applies a short, deep ceiling to newly loud material; deterministic tests close the first-frame leak, but listening tests must confirm that its attack character is acceptable across speech, music, and live streams.
- Unknown/conflicting player-volume state can reduce quiet-lift availability.
- Strong full-scale lift can expose noise or codec artifacts and can audibly compress high-crest peaks; controlled listening remains required.
- Site-independent capture avoids media-element conflicts but cannot bypass Chrome-protected surfaces.
- Listening quality is sensitive to source material; synthetic tests prove invariants, not universal preference.

## Marketing boundary

Allowed statements:

- processes authorized tab audio locally;
- drives sustained loud and genuine quiet sections toward a common bounded target at full strength;
- respects mute and player-volume state when reliable;
- uses worklet-based loudness riding and look-ahead peak limiting;
- supports the documented languages and tested site matrix.

Do not claim:

- guaranteed hearing protection;
- automatic capture of every new tab in the public store build;
- standards-compliant broadcast LUFS normalization;
- compatibility with every website;
- zero latency, zero distortion, or perfect volume equality.
