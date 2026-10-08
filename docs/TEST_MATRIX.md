# Test matrix

## Automated matrix

Automatic mode (`npm run test:auto`, `tools/e2e_auto_mode.js`): loads `dist/github-dev`
in an isolated Chrome profile and, with no popup click and no `tabCapture`, checks
same-origin loud reduction, quiet lift under a strict page CSP, shadow-DOM media,
declined cross-origin media without CORS (never silenced), attached CORS-enabled
cross-origin media, untouched muted media, and the per-site off/on switch.
`node tools/e2e_auto_mode.js --url <page>` probes one real site; YouTube, Bilibili and Dailymotion
Bilibili video pass at 0.8.2 + automatic mode. Twitch, Vimeo and Reddit directory
pages did not autoplay in the harness and are not claimed.
`node tools/assert_auto_engine.js` statically pins the engine's safety invariants.

Optional, local corpus research: `npm run audit:audio-corpus` verifies pinned
downloads before rendering twelve real-material/level combinations through three
variants in Chrome. It is not an automatic network/CI dependency or a release
quality claim; see [provenance and limits](REAL_AUDIO_CORPUS.md).

Unreleased control gates: `node tools/volume_intent_tests.js` covers aligned
manual volume at three rates/three levels, delayed metadata, zero volume and
source-buffer clearing. `node tools/volume_edge_tests.js` additionally covers
high-crest controls, the first 4 ms of delayed PCM, hard mute and real onsets.
`node tools/browser_candidate_audit.js` covers 66 Chrome
offline stereo cases and four concurrent silent real-time contexts per variant.
Candidate timing is recorded, not gated on a shared runner; production's known
inter-sample failure is not hidden. See [measurement boundaries](VOLUME_INTENT.md).

`node tools/true_peak_control_audit.js` adds 30 finite stereo records under active
limiting, with actual rendered tails, both-channel reconstruction, volume/mute,
source/settings and mono-to-stereo input transitions. It runs in `npm test`.
Peak-meter self-tests distinguish interior crops from finite zero-extended
records and reject insufficient interior context; five EBU Tech 3341 tone
definitions are checked, without claiming full meter compliance.

Local capture E2E emits synthetic audio by design. The default developer-safe entry points use an isolated Chrome profile, Chrome's fake audio output, and the Web Audio silent sink so the live DSP graph remains measurable without opening the system playback device. Direct audible runs remain gated behind explicit opt-in.

| Layer | Scenarios | Command |
|---|---|---|
| Pure policy | settings, target-loudness bounds, gate hysteresis, gated programme estimate, confidence, strength zero, player-volume bounds, live quiet-bed cap | `npm test` |
| Unified worklet | baseline neutrality, programme convergence, cold start, adaptive onset, bounded quiet-bed recovery, dynamics, mute, player cap, source reset | `npm run test:dsp` |
| Production worklet multirate | 44.1, 48, and 96 kHz finite output, quiet lift, loud calibrated output, sample-safe limiting, hard mute | `node tools/multirate_worklet_tests.js` (also executed by `npm test`) |
| Peak detector calibration | analytical quarter-rate sine, constant level, silence, and invalid-PCM rejection for 8x Hann and 16x Blackman estimates | `node tools/true_peak_audit.js --self-test` (also executed by `npm test`) |
| Strict inter-sample peak audit | high-frequency and impulse fixtures plus restored alternating-sample and phase-offset quarter-rate counterexamples; currently fails nine cases, recorded in `docs/DSP_EVALUATION.md` | `npm run audit:true-peak` (separate from normal regression tests) |
| Worklet equivalence/performance | exact stereo PCM and state against pinned baseline across three sample rates; lift/cut, mute, volume, settings, and source transitions | `npm run audit:worklet-performance` (requires baseline git history) |
| Offline-only peak candidate | original 24 plus 27 expanded stress cases; bound-pruning equivalence, unchanged delay, mute, stereo, synthetic level change and VM cost; not a release gate pass | `npm run audit:true-peak-candidate` (see `docs/TRUE_PEAK_CANDIDATE.md`) |
| Limiter | look-ahead delay, ceiling, clustered peaks, dynamic ceiling, stereo ratio, overshoot | `npm run test:dsp` |
| Offline PCM | legacy reference vs production vs independent v4 model, steady levels, dynamics, onset, player volume, boundaries | `npm run test:dsp` |
| Offline graph | real AudioWorklet node and AudioContext graph | `npm run test:dsp` |
| Capture E2E | start/stop, loud cut, quiet lift, mute, player volume, burst recovery | `npm run test:capture` |
| Extension-page readiness | initial document, missing APIs, context replacement, wrong extension, timeout, and disconnected debugger | `node tools/cdp_extension_ready_tests.js` (also executed by `npm test`) |
| Stability E2E | repeated capture, reload, source switching, session cleanup | `npm run test:long -- --duration-ms 30000` |
| Silent capture E2E | live tabCapture/DSP with no system playback device, plus native-output rejection | `npm run test:silent` |
| Real-site smoke | YouTube, Bilibili, and Douyin video/live in isolated silent Chrome | `npm run test:sites` |
| Slider persistence | input/change ordering and saved custom strength; advanced target persistence is covered by settings contracts | `npm run test:slider` |
| Store build | allowlist, references, diagnostics stripping, locale catalogs, forbidden code | `npm run test:release` |

## Real-site release baseline

Extended 120-second-per-video manual-link and loudness qualification is recorded
in [REAL_SITE_QUALITY.md](REAL_SITE_QUALITY.md). It found under-target windows
and retained YouTube/Bilibili no-extension playback failures; it is not a
three-platform quality pass.

The later [personal-Chrome 0.92 developer-candidate retest](PERSONAL_CHROME_DYNAMICS_092_20260923.md)
used the user's logged-in Chrome and qualified three distinct real videos per
platform for at least one minute each. It confirms live capture and matching
input/output meters, while sustained quiet content still misses the internal
target. This unreleased candidate is not a release-quality pass or listening
test; shorter failed windows, ads, site errors and transport gaps remain in
the record.

The [sustained-quiet counterfactual](SUSTAINED_QUIET_COUNTERFACTUAL_20260923.md)
uses those exact eligible numeric rows and matched synthetic PCM. It rejects an
extra quiet-detail lift because a same-level ambience fixture is raised by the
same amount. This is offline analysis, not a newly installed candidate.

The [product balance review](BALANCE_OBJECTIVE_REVIEW_20260923.md) and
`node tools/analyze_balance_objective.js` report cross-video centre narrowing,
paired input/output within-video contrast and loss-of-contrast warnings. The
`-19±2 dB` window-hit rate remains a diagnostic for labelled stable foreground,
not a pass criterion for every audible window. The analysis test runs in the
complete local checks; no new runtime DSP is implied.

### Local three-video navigation check (2026-09-22)

Current main runtime (not the offline true-peak candidate) was tested in isolated,
silent Chrome for 180 seconds per platform. The same captured tab navigated to
distinct public video links discovered on the page at approximately 60 and 120
seconds, without restarting capture. The clock includes page loading, so this
is not 60 seconds of decoded content per video. It tests full navigation, not
feed swipes or in-page SPA clicks. Ordinary snapshots are one second apart;
the first ten seconds after navigation are sampled about every 250 ms.

| Platform | Result | Navigation-to-playing observation |
|---|---|---|
| Bilibili | Passed, three videos, 180014 ms | 2361 / 1889 ms |
| Douyin | Passed, three videos, 180006 ms | 6288 / 5418 ms |
| YouTube | Failed continuity, three videos, 180017 ms | 2695 / 2683 ms |

YouTube's media element paused and unloaded during the minute segments while
the extension context and meters remained running. Navigation restored input;
nine stale-input observations were retained, rather than turning recovery into
a pass. All three runs' sampled counters showed zero hard-clipped samples.
This does not measure reconstructed true peak, prove absence of sub-snapshot
artifacts, or establish subjective loudness equality. Playback readiness is
not an audio-settling measurement. No runtime DSP changes were made.

Reproduce locally with `WVB_E2E_REAL_SWITCH=1`,
`WVB_REAL_SCENARIO_TIMEOUT_MS=300000`, and
`node tools/e2e_real_site_matrix.js --scenario bilibili-video --hold-ms 180000`
(substitute `youtube-video` or `douyin-short`). The switch mode is fixed at three
minutes. It saves timestamped `tmp/real-switch-*.json` snapshots including
partial failures. These local records include public page URLs/titles and must
not be uploaded as automatic telemetry. Page recommendations vary; later runs
are not guaranteed to select identical material. Missing distinct links fail
the scenario rather than silently replaying one video.

### Historical release baseline

Development follow-up (`2026-09-12`): [CI run 34681266561](https://github.com/WSL043/loudease/actions/runs/34681266561) failed the first capture scenario with `Cannot read properties of undefined (reading 'query')` after discovering the popup target; its remaining seven scenarios passed. The harness queried tabs without waiting for the extension execution context. It now waits for the exact document URL, extension ID, document readiness, and required APIs before evaluating extension code. A deterministic context-transition regression and the local 8/8 silent capture matrix passed after this change. Capture scenarios are not retried and persistent API absence remains a failure.

The following rows require current `0.8.2` evidence before Chrome Web Store submission. A previous-version run is useful history but does not pass a current release gate unless the affected runtime is byte-identical and the release review records that limited carry-forward explicitly.

| Scenario | Connect | Fresh signal | Cut/lift evidence | Mute/volume | Source switch | 30 min | 2 h mixed run |
|---|---:|---:|---:|---:|---:|---:|---:|
| YouTube video | Passed 2026-08-29 | Passed 2026-08-29 | Observed 2026-08-29 | Capture fixture passed | Capture fixture passed | Pending | Pending |
| YouTube live | Passed 2026-08-29 | Passed 2026-08-29 | Observed 2026-08-29 | Capture fixture passed | Capture fixture passed | Source unloaded after 45–60 s in anonymous headless Chrome | Pending |
| Bilibili video | Passed 2026-08-29 | Passed 2026-08-29 | Observed 2026-08-29 | Capture fixture passed | Capture fixture passed | Pending | Pending |
| Bilibili live | Passed 2026-08-29 | Passed 2026-08-29 | Observed 2026-08-29 | Capture fixture passed | Capture fixture passed | Passed 2026-08-29 | Pending |
| Douyin video | Passed 2026-08-29 | Passed 2026-08-29 | Observed 2026-08-29 | Capture fixture passed | Capture fixture passed | Pending | Pending |
| Douyin live | Passed 2026-08-29 | Passed 2026-08-29 | Observed 2026-08-29 | Capture fixture passed | Capture fixture passed | Pending | Pending |

The final 2026-09-01 quick matrix passed all six scenarios with current `0.8.2` code, fresh isolated profiles, silent output, no native WASAPI output, fresh worklet meters, and zero hard-clipped samples. The eight-scenario capture matrix also passed, including dynamic in-page source replacement, continued metering, a single live audio track, popup state matching the live DSP, mute/player-volume behavior, loud cut, quiet lift, burst recovery, and stop cleanup.

The current-version `0.8.2` representative Bilibili live endurance run lasted `1,800,005 ms` and collected 360 consecutive five-second samples. Signal ticks advanced by `89,907`, peak offscreen heap growth was `753,984 bytes` against a `32 MiB` limit, one audio track and a running context remained live, stop cleanup passed, and hard-clipped samples remained zero. Earlier anonymous-headless YouTube endurance runs correctly failed when the site unloaded its media element after roughly 45–60 seconds even though the extension capture session remained alive; they are not counted as extension passes. A historical native-output test sampled the actual Windows default render endpoint and verified that stopping LoudEase returned the audible level within `-0.905 dB` of baseline; that measurement predates `0.8.2` and is supporting context rather than a current-version claim. These results prove pipeline continuity and restoration, not universal audible preference; broader listening and the two-hour mixed run remain stable-release gates.

## Core global compatibility matrix

These rows extend coverage across distinct playback architectures. A row may be advertised as tested only after current-version evidence is recorded. They are not all blockers for the current public beta.

| Scenario | Technology represented | Status |
|---|---|---:|
| YouTube Music | Long-form web music and source switching | Pending |
| Twitch live and VOD | Low-latency live plus archived playback | Pending |
| TikTok video and live | Short-video SPA and live switching | Pending |
| Spotify Web Player | Web music and protected playback | Pending |
| Vimeo | Generic embedded and first-party video | Pending |
| Dailymotion | Alternative global video platform | Pending |
| Facebook Video / Instagram Reels | Social video and dynamic feeds | Pending |
| SoundCloud / Apple Music | Audio-only web playback | Pending |
| Netflix, Prime Video, or Disney+ | Representative EME/DRM playback | Pending |

## Regional expansion candidates

Regional services are added to the maintained matrix when access is available or an issue supplies a reproducible case. Initial candidates are Niconico and ABEMA; CHZZK and SOOP; VK Video, Rutube, and Yandex Music; BBC iPlayer, ARD/ZDF, and France.tv; JioHotstar; Shahid; and Globoplay.

Do not bypass subscriptions, DRM, account controls, or geographic restrictions to produce evidence. A generic capture success on one protected service does not prove compatibility with every protected service.

## Required evidence fields

- Chrome and extension version;
- page type and timestamp, with private URLs redacted when needed;
- `captureActive`, `captureState`, pipeline mode, context state, and track count;
- signal tick count and last signal age;
- input/output level and current gain;
- limiter reduction, hard-clipped samples, and maximum overshoot;
- player mute/volume state and reliability;
- source-switch result;
- duration and observed audible artifacts.

## Listening matrix

Use legally redistributable or privately licensed material for:

- dialogue with sparse ambience;
- dialogue followed by loud effects;
- music with transients and intentional dynamics;
- live speech with background noise;
- ads or clips mastered much louder than surrounding content;
- low player volume, mute, silence, and near-silence.

Record pumping, breathing, distortion, transient loss, stereo movement, noise lift, speech clarity, and fatigue. Do not commit copyrighted recordings without redistribution rights.

## 2026-10-08 automatic signal recovery (unreleased)

Automatic-mode signal age now tracks the last positive worklet signal, rather than the latest state message. A silent heartbeat or stale positive state must not keep the signal fresh. When the user opens the popup and Chrome reports an audible tab but the automatic graph has no fresh signal, the existing user-invoked tab-capture fallback is allowed. An unconfirmed automatic graph exposes manual capture recovery instead of claiming to be connected. Silence alone, player mute, fresh automatic signal, and an existing capture do not trigger that fallback.

`node tools/auto_signal_recovery_tests.js` reproduces the former heartbeat-age error and covers fallback guards and popup recovery. The local slider/capture smoke test passed with explicit slider-persistence settings (the slider wrapper currently imports a main-guarded module and does not execute it). Personal Douyin live-page recovery remains unverified; the local test is not a replacement for that acceptance check. No DSP parameters, permissions, or version were changed.
