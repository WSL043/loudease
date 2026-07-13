# Release Readiness Review

Review baseline: version `0.7.0`, unified AudioWorklet DSP, independent multi-tab capture sessions, internationalized compact popup, and separate development/store builds.

## Decision

| Target | Decision | Reason |
|---|---|---|
| Private GitHub beta | Ready | Private prerelease and clean store ZIP exist; this is not a public compatibility claim |
| Public GitHub beta | Not yet | Needs refreshed real-site, endurance, listening, and feedback evidence |
| Chrome Web Store | Not yet | Needs final permission justification, listing assets, and refreshed real-site endurance evidence |
| Version `1.0.0` | Not yet | Requires the stable-release gates in `docs/VERSIONING.md` |

## Confirmed implementation

- One primary processing architecture: `tabCapture -> offscreen -> leveler-v3 AudioWorklet -> destination`.
- Content script observes media/player state but does not process audio.
- Continuous worklet measurement, gain control, mute/player-volume enforcement, and sample-peak limiting.
- Two independent user strengths with persistence regression coverage.
- Independent capture ownership for multiple authorized tabs.
- Development diagnostics are opt-in and removed from the store build.
- Eleven locale catalogs with English as the default.
- MIT license, privacy policy, security policy, contribution guide, and CI workflow.

## Automated gates

Before every release candidate:

```bash
npm test
npm run test:dsp
npm run test:slider
npm run test:release
npm run package:store
npm run audit
```

The store verifier must confirm:

- no localhost permission, URL, diagnostics symbol, or development marker;
- no forbidden source, docs, tests, tools, secrets, archives, or logs;
- no dynamic evaluation or remote executable code;
- all manifest, locale, CSS, HTML, worklet, and icon references exist;
- a valid default locale and complete translated message catalogs.

## Remaining Chrome Web Store gates

1. Refresh the unpacked extension and collect current-version evidence for YouTube video/live, Bilibili video/live, and Douyin video/live.
2. Run at least a two-hour mixed-content endurance session and record capture count, track count, context state, stale status, limiter overshoot, and hard-clipped samples.
3. Complete controlled A/B listening on dialogue, music, live speech, ads, sparse ambience, and loud transient material.
4. Confirm every required permission is justified in the store dashboard and remove any permission proven unnecessary.
5. Prepare final store icon, screenshots, small promotional tile, description, privacy fields, support URL, and contact route.
6. Review translated store copy for accuracy; do not use keyword lists or compatibility claims unsupported by the matrix.
7. Confirm the store build still has zero remote telemetry. Any future collection must pass `docs/DATA_GOVERNANCE.md` and ship with new explicit consent and store disclosures.
8. Enable the Chrome Web Store Support Hub or configure a reviewed Support URL, then verify the privacy-safe GitHub Issue Form route described in `docs/FEEDBACK.md`.
9. Record representative global playback evidence before advertising support beyond the baseline matrix; use `docs/TEST_MATRIX.md` as the claim boundary.

## Residual technical risk

- Chrome still requires a user gesture for a new tab capture.
- Sample-peak limiting does not catch every inter-sample true peak.
- Unknown/conflicting player-volume state can reduce quiet-lift availability.
- Site-independent capture avoids media-element conflicts but cannot bypass Chrome-protected surfaces.
- Listening quality is sensitive to source material; synthetic tests prove invariants, not universal preference.

## Marketing boundary

Allowed statements:

- processes authorized tab audio locally;
- reduces loud sections and conservatively lifts quiet detail;
- respects mute and player-volume state when reliable;
- uses worklet-based loudness riding and look-ahead peak limiting;
- supports the documented languages and tested site matrix.

Do not claim:

- guaranteed hearing protection;
- automatic capture of every new tab;
- standards-compliant broadcast LUFS normalization;
- compatibility with every website;
- zero latency, zero distortion, or perfect volume equality.
