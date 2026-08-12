# Test matrix

## Automated matrix

Local capture E2E emits synthetic audio by design. The default developer-safe entry points use an isolated Chrome profile, Chrome's fake audio output, and the Web Audio silent sink so the live DSP graph remains measurable without opening the system playback device. Direct audible runs remain gated behind explicit opt-in.

| Layer | Scenarios | Command |
|---|---|---|
| Pure policy | settings, gate hysteresis, gated programme estimate, confidence, strength zero, player-volume bounds, live quiet-bed cap | `npm test` |
| Unified worklet | baseline neutrality, programme convergence, cold start, adaptive onset, bounded quiet-bed recovery, dynamics, mute, player cap, source reset | `npm run test:dsp` |
| Limiter | look-ahead delay, ceiling, clustered peaks, dynamic ceiling, stereo ratio, overshoot | `npm run test:dsp` |
| Offline PCM | legacy reference vs production vs independent v4 model, steady levels, dynamics, onset, player volume, boundaries | `npm run test:dsp` |
| Offline graph | real AudioWorklet node and AudioContext graph | `npm run test:dsp` |
| Capture E2E | start/stop, loud cut, quiet lift, mute, player volume, burst recovery | `npm run test:capture` |
| Stability E2E | repeated capture, reload, source switching, session cleanup | `npm run test:long -- --duration-ms 30000` |
| Silent capture E2E | live tabCapture/DSP with no system playback device, plus native-output rejection | `npm run test:silent` |
| GitHub automatic capture | normal-Chrome denial plus two concurrently opened allowlisted tabs with pre-play capture, real PCM, one offscreen lifecycle, and no native output | `npm run test:auto-capture` |
| Real-site smoke | YouTube, Bilibili, and Douyin video/live in isolated silent Chrome | `npm run test:sites` |
| Slider persistence | input/change ordering and saved custom strength | `npm run test:slider` |
| Store build | allowlist, references, diagnostics stripping, locale catalogs, forbidden code | `npm run test:release` |

## Real-site release baseline

The following rows require current `0.7.2` evidence before Chrome Web Store submission. A previous-version run is useful history but does not pass a current release gate.

| Scenario | Connect | Fresh signal | Cut/lift evidence | Mute/volume | Source switch | 30 min | 2 h mixed run |
|---|---:|---:|---:|---:|---:|---:|---:|
| YouTube video | Passed 2026-08-10 | Passed 2026-08-10 | Observed 2026-08-10 | Pending | Pending | Pending | Pending |
| YouTube live | Passed 2026-08-10 | Passed 2026-08-10 | Observed 2026-08-10 | Pending | Pending | Source unloaded after 45–60 s in anonymous headless Chrome | Pending |
| Bilibili video | Passed 2026-08-10 | Passed 2026-08-10 | Observed 2026-08-10 | Pending | Pending | Pending | Pending |
| Bilibili live | Passed 2026-08-10 | Passed 2026-08-10 | Observed 2026-08-10 | Pending | Pending | Passed 2026-08-10 | Pending |
| Douyin video | Passed 2026-08-10 | Passed 2026-08-10 | Observed 2026-08-10 | Pending | Pending | Pending | Pending |
| Douyin live | Passed 2026-08-10 | Passed 2026-08-10 | Observed 2026-08-10 | Pending | Pending | Pending | Pending |

The final 2026-08-10 quick matrix passed all six scenarios with current `0.7.2` development code, fresh isolated profiles, silent output, no native WASAPI output, fresh worklet meters, and zero hard-clipped samples. The input/output readings were: YouTube video `-32.83/-25.83 dB`, YouTube live `-20.52/-23.76 dB`, Bilibili video `-44.86/-35.13 dB`, Bilibili live `-22.18/-25.49 dB`, Douyin short video `-30.13/-33.53 dB`, and Douyin live `-38.75/-35.49 dB`.

The representative Bilibili live endurance run lasted `1,800,011 ms` and collected 360 consecutive five-second samples. Signal ticks advanced `53 -> 90046`, maximum signal age was `91 ms`, offscreen heap growth peaked at `1,195,700 bytes` against a `32 MiB` limit, and hard-clipped samples remained zero. Three attempted anonymous-headless YouTube endurance runs correctly failed when the site unloaded its media element after roughly 45–60 seconds even though the extension capture session remained alive; they are not counted as extension passes. These automated results prove capture and DSP continuity, not audible quality; mute/volume, in-page source switching, controlled listening, and the two-hour mixed run remain separate gates.

## Core global compatibility matrix

These rows extend coverage across distinct playback architectures. A row may be advertised as tested only after current-version evidence is recorded. They are not all blockers for the first private beta.

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
