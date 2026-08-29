# Release Readiness Review

Review baseline: version `0.8.0` public-beta candidate, unified AudioWorklet DSP, independent multi-tab capture sessions, internationalized compact popup, and separate development/store builds.

Latest code/package audit: `2026-08-29`. Static, DSP, isolated-Chrome slider/capture, release-build, and package checks passed locally. The store ZIP was byte-for-byte reproducible across two consecutive builds and contained 42 verified runtime files. The current-version six-site smoke matrix passed 6/6. A representative Bilibili live endurance run passed for `1,800,013 ms` with 360 continuous samples, `89,982` fresh signal ticks, zero hard-clipped samples, one live audio track, and peak heap growth of `939,684 bytes`. A real Windows default-render-endpoint A/B verified audible processing and stop restoration: the stopped level returned within `-0.905 dB` of baseline. These measurements prove the pipeline and restoration behavior, not universal listening preference.

## Decision

| Target | Decision | Reason |
|---|---|---|
| Local/private beta candidate | Ready | Clean reproducible store ZIP and current verification evidence exist; no public compatibility claim is implied |
| Public GitHub beta | Technically ready | Source, package, assets, six-site smoke, and representative endurance evidence are current; publishing the private repository remains an explicit maintainer decision |
| Chrome Web Store public beta | Technically ready | Package, copy, privacy fields, assets, endpoint A/B, site matrix, and representative endurance evidence are current; public privacy/support URLs and account-owner dashboard submission remain |
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

## Remaining owner and submission gates

1. Make the privacy and support URLs publicly reachable before submission, then recheck every listing URL.
2. Keep the retained HTTP(S) host-permission rationale from `store/PRIVACY_PRACTICES.md` aligned with the final package. The permission is used only to restore media/player observation on useful, captured, or explicitly opened tabs across navigation; it does not process audio or collect browsing history.
3. Publish English as the initial listing. Unreviewed localized listing drafts remain unpublished and do not block the English public beta.
4. Confirm the store build still has zero remote telemetry. Any future collection must pass `docs/DATA_GOVERNANCE.md` and ship with new explicit consent and store disclosures.
5. Enable the Chrome Web Store Support Hub or configure the reviewed Support URL, then verify the privacy-safe GitHub Issue Form route described in `docs/FEEDBACK.md`.
6. Complete the account-owner checklist in `store/ACCOUNT_SETUP.md`. The maintainer reports that the one-time registration fee was probably already paid; contact-email verification, agreements, two-step verification, and final submission still require confirmation in the Developer Dashboard.

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
