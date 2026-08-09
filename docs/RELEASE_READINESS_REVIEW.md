# Release Readiness Review

Review baseline: version `0.7.2`, unified AudioWorklet DSP, independent multi-tab capture sessions, internationalized compact popup, and separate development/store builds.

Latest code/package audit: `2026-08-09`. Static, DSP, muted isolated-Chrome slider/capture, release-build, and package checks passed locally. The store ZIP was byte-for-byte reproducible across two consecutive builds and contained 41 verified runtime files. The acceptance audit remains incomplete because current real-site and endurance evidence is missing.

## Decision

| Target | Decision | Reason |
|---|---|---|
| Private GitHub beta | Ready | Private prerelease and clean store ZIP exist; this is not a public compatibility claim |
| Public GitHub beta | Not yet | Needs refreshed real-site, endurance, listening, and feedback evidence |
| Chrome Web Store | Not yet | Submission copy, privacy fields, and required-size assets are prepared; public URLs and refreshed real-site endurance evidence remain |
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
4. Reconfirm the permission justifications in `store/PRIVACY_PRACTICES.md` against the final package. The redundant `tabs` permission has been removed and `activeTab` remains as the user-invocation grant for the `tabCapture` target. Before public submission, explicitly decide whether seamless cross-navigation observer recovery justifies persistent `http://*/*` and `https://*/*` host permissions or whether the product should accept reduced recovery in exchange for optional/narrower host access.
5. Reinspect the required-size assets and copy in `store/`, then make the privacy and support URLs publicly reachable before submission.
6. Obtain fluent review before publishing any draft in `store/LOCALIZATION_STATUS.md`. English remains the default; unreviewed localized listings stay unpublished and do not block an English-only first release. Do not use keyword lists or compatibility claims unsupported by the matrix.
7. Confirm the store build still has zero remote telemetry. Any future collection must pass `docs/DATA_GOVERNANCE.md` and ship with new explicit consent and store disclosures.
8. Enable the Chrome Web Store Support Hub or configure a reviewed Support URL, then verify the privacy-safe GitHub Issue Form route described in `docs/FEEDBACK.md`.
9. Record representative global playback evidence before advertising support beyond the baseline matrix; use `docs/TEST_MATRIX.md` as the claim boundary.
10. Complete the account-owner checklist in `store/ACCOUNT_SETUP.md`; registration fee, agreements, two-step verification, and final submission are manual maintainer actions.

## Residual technical risk

- Chrome still requires a user gesture for a new tab capture.
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
- automatic capture of every new tab;
- standards-compliant broadcast LUFS normalization;
- compatibility with every website;
- zero latency, zero distortion, or perfect volume equality.
