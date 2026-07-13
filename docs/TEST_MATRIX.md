# Test matrix

## Automated matrix

Local capture E2E emits synthetic audio by design. It is disabled on developer machines unless a silent output endpoint is selected and `WVB_E2E_ALLOW_LOCAL_AUDIO=1` is set. GitHub Actions may run it with `CI=true`.

| Layer | Scenarios | Command |
|---|---|---|
| Pure policy | settings, strength zero, K-weighting, dual windows, gate hysteresis, player-volume bounds, target hold | `npm test` |
| Unified worklet | silence, quiet voice, loud tone, burst, mute, player cap, linked channels, long run | `npm run test:dsp` |
| Limiter | look-ahead delay, ceiling, clustered peaks, dynamic ceiling, stereo ratio, overshoot | `npm run test:dsp` |
| Offline PCM | silence, voice-like tones, noise, loud/quiet alternation, recovery envelope | `npm run test:dsp` |
| Offline graph | real AudioWorklet node and AudioContext graph | `npm run test:dsp` |
| Capture E2E | start/stop, loud cut, quiet lift, mute, player volume, burst, source replacement | `npm test` |
| Stability E2E | repeated capture, reload, source switching, session cleanup | `npm test` |
| Slider persistence | input/change ordering and saved custom strength | `npm run test:slider` |
| Store build | allowlist, references, diagnostics stripping, locale catalogs, forbidden code | `npm run test:release` |

## Real-site release baseline

The following rows require current `0.7.1` evidence before Chrome Web Store submission. A previous-version run is useful history but does not pass a current release gate.

| Scenario | Connect | Fresh signal | Cut/lift evidence | Mute/volume | Source switch | 30 min | 2 h mixed run |
|---|---:|---:|---:|---:|---:|---:|---:|
| YouTube video | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| YouTube live | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Bilibili video | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Bilibili live | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Douyin video | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Douyin live | Pending | Pending | Pending | Pending | Pending | Pending | Pending |

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
