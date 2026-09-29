# LoudEase Agent Guide

This file is the shared operating contract for coding agents and human contributors. Read it before changing the project.

## Source of truth

Read the smallest relevant set before editing:

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md` for runtime ownership and message flow
3. `docs/AUDIO_DSP.md` for signal-processing behavior
4. `docs/BUILD.md` for development/store package boundaries
5. `docs/TEST_MATRIX.md` and `docs/RELEASE_READINESS_REVIEW.md` for claim and release gates
6. `CONTRIBUTING.md` for contribution, privacy, and evidence requirements

The live runtime, current source, tests, and recorded evidence outrank old screenshots, issue guesses, and historical notes.

## Product invariants

- There are two audio-processing paths and both end in the same programme-leveler AudioWorklet: automatic mode (`content/auto-engine.js`: eligible `<audio>`/`<video>` element -> `MediaElementAudioSourceNode` -> leveler -> destination, no gesture needed) and user-invoked capture (`tabCapture -> offscreen document -> AudioWorklet -> destination`). Do not add a third path.
- All tab sessions share one serialized offscreen-document creation lifecycle; concurrent tabs must not race `chrome.offscreen.createDocument()`.
- `content/bridge.js` only observes media and player state. `content/auto-engine.js` is the sole page-side owner of element graphs and must obey the automatic-mode rules below.
- Automatic mode must never attach an element Chrome would silence: cross-origin media without CORS, EME/DRM media (`mediaKeys` or an `encrypted` event), or an element another script already routed through Web Audio. It must not create the element source until the leveler is configured and the `AudioContext` is running, and it must fall back to a direct connection (bypass) on `processorerror` or stalled worklet state so audio is never left silent.
- When a user-invoked tab capture is live for a tab, automatic mode must route its elements directly to the destination so audio is never processed twice.
- Automatic mode attaches only when an element is audible (not paused, muted, or zero volume) and must offer a global and per-site off switch.
- Page mute and zero player volume are hard boundaries. Quiet lift must never bypass them.
- A quiet bed inside a loud programme is not a new programme. Positive within-programme correction stays bounded and floor-qualified; full lift belongs to programme-to-programme correction.
- Ephemeral `blob:` URLs and `srcObject` instances are transport identities, not programme boundaries. A real navigation or stable source-path change may reset the estimator.
- Muted or zero-volume helper media must not participate in programme identity; only sources that contribute audible programme audio may trigger a source boundary.
- Upward programme confidence requires representative signal and reaches full strength after about 1.5 seconds of continuous accepted audio; fast downward protection does not wait.
- Transition limiting uses a fixed programme-relative safety crest and must not chase recent quiet output peaks.
- A popup label such as **active** requires fresh runtime evidence, not merely an enabled preference.
- `tabCapture` requires an explicit user action before a newly selected tab is captured; automatic mode does not capture tabs. Development tooling must not modify Chrome startup arguments or browser profiles.
- The store build and GitHub development build use the same DSP. The store build removes contributor-only localhost diagnostics.
- Raw audio, browsing history, URLs, titles, account identifiers, and secrets must not be uploaded or silently collected.

Do not introduce prototype patching (`HTMLMediaElement`, `AudioContext`, `Audio` constructors), main-world scripts, remote executable code, or hidden telemetry. Page-level media source ownership is allowed only through `content/auto-engine.js` under the rules above.

## Working method

1. Inspect `git status`, the affected code path, and current runtime evidence.
2. Reproduce or prove the mechanism before changing code. Keep verified facts separate from hypotheses.
3. Make the smallest coherent change that fixes the root cause.
4. Add or update the narrowest regression test that would have caught it.
5. Run focused checks, then the complete required suite for the touched area.
6. Review the diff for unrelated changes, stale claims, new permissions, and privacy impact.

Do not revert user changes, rewrite unrelated files, bump versions, create tags, publish releases, change repository visibility, or delete remote releases without explicit maintainer approval.

## Verification gates

| Change | Minimum verification |
|---|---|
| Documentation or store metadata | `node tools/assert_publish_hygiene.js`, `git diff --check` |
| Popup, settings, or persistence | `npm test`, `npm run test:slider` |
| DSP or AudioWorklet | `npm test`, `npm run test:dsp`, relevant offline regression evidence |
| Capture, mute, player-volume, or tab lifecycle | automated checks plus a direct runtime scenario |
| Permissions, diagnostics, or packaging | `npm run test:release`, inspect `dist/store/manifest.json` and the ZIP |
| Release candidate | every command in `docs/RELEASE_READINESS_REVIEW.md` plus current-version real-site evidence |

A screenshot of the popup is UI evidence, not proof that audio was processed correctly.

## Installation boundary

Ordinary users do not deploy LoudEase and do not need Node.js. The supported public installation path is the Chrome Web Store. Trusted beta testers may manually sideload the verified stripped release ZIP through Chrome Developer mode; this is a testing workflow, not ordinary distribution.

Node.js 20+ is only required to build or test from source. A local diagnostics receiver is optional contributor tooling and is never required for normal listening. See `docs/INSTALLATION.md`.

## Release boundary

- `main` is the integration branch.
- Normal maintenance lands as signed-off commits; it does not imply a release.
- The private repository may be prepared and tested without creating new tags.
- Before the first public release, stale private prereleases may be removed only after the maintainer confirms the exact release and tag list.
- Once a beta has been published publicly, retain its release record and tag. A stable release becomes **Latest** instead of rewriting public history.
- The exact same verified stripped `dist/loudease-store.zip` is attached to GitHub Releases and submitted to the Chrome Web Store. Never publish `dist/github-dev` or an ad hoc archive of it. Follow `docs/PUBLISHING.md`.

## Contribution quality

Use focused commits with Developer Certificate of Origin sign-off (`git commit -s`). DSP changes need a stated hypothesis, measurable before/after evidence, and artifact checks for pumping, distortion, clipping, transients, settling, and recovery. Compatibility claims require current-version evidence for the named platform and media type.

When evidence is unavailable, document the gap instead of claiming success.
