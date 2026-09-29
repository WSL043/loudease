# Real-platform loudness qualification (2026-09-22)

Environment: Windows 11, local Chrome 152.0.7977.64, isolated headless profiles
and silent output. Production runtime source is `55c734a8b35dbf2c46ba9e3367d42d31d29c9acd`
(manifest 0.8.2); test-only observer/tool changes are separate from that runtime.

## Question and decision boundary

This test asks whether the **current main runtime**, not the offline true-peak
candidate, brings sustained input toward the proposed internal target of -19 dB
within +/-2 dB, and whether manual same-tab video changes retain capture.
Those tolerances are experimental product criteria, not an industry mandate.
Passing capture or reporting zero hard clips is not a loudness-quality pass.

**Outcome: not yet qualified against the proposed balance band.** Below-target
output remains common in the measured real material. YouTube playback remains
unresolved in this isolated environment; Bilibili requires legitimate login for
longer observation. Neither is reported as fixed by an extension patch.

## Measurement

The production worklet's input meter is K-weighted but its output energy meter
is unweighted. Comparing those existing fields directly to the same target would
be invalid. `tools/real_quality_meter.js` instruments only the disposable E2E
copy: the original processor writes PCM first, then a separate observer reads
input and output using identical K-weighting filters and channel-mean energy.
There is no audio export, second processing path, new runtime permission, or
change to production DSP. Exact stereo PCM parity with the uninstrumented
processor passes at 44.1, 48 and 96 kHz, including a source/volume change;
bypass input/output meter equality is also tested.

The observer reports 400 ms momentary and 3 s short-term windows every 100 ms.
These time scales follow [EBU Tech 3341](https://tech.ebu.ch/docs/tech/tech3341.pdf),
but the meter retains the product's approximate filters and channel convention:
**these numbers are internal weighted dB, not certified LUFS or acoustic SPL**.
The output tap is the worklet output, before downstream mute/startup gates;
normal active/unmuted playback is the analysis scope, not endpoint calibration.

`tools/analyze_real_quality.js`:

- normalizes both sides by the reliable player attenuation, so a half-volume
  player is not incorrectly judged 6 dB too quiet;
- excludes the first three seconds after source/volume changes, unknown-volume,
  muted/paused media and short-term input below -45 dB;
- reports every excluded category and requires 60 seconds of eligible data to
  label a segment adequately covered;
- separately screens steady input (three seconds of short-term input varying
  no more than 2 dB with full programme confidence);
- retains below/above-band fractions and excursions lasting at least 3 seconds;
- reports time to the first complete one-second momentary in-band interval,
  **not** a claim that the audio thereafter remains settled.

The energy/steadiness screens do not identify speech, distinguish intentional
quiet music from noise, or determine subjective preference. Overlapping windows
are correlated; counts are not independent statistical samples. Live source
and output are separated by the existing 5 ms delay, insignificant for stable
3 s comparisons but not sufficient for sample-accurate transient attribution.

## First extended run

The plan was three videos per platform, 120 seconds after playback readiness
per video. Videos were selected from observed page links, activated with a
page click under a browser user gesture and forced into the already captured
tab. This simulates manual link selection, not physical mouse operation and not
feed swipes. YouTube autoplay was switched off. After navigation the test did
not repeatedly force play or unmute helpers to recover an error.

| Platform | Actual record | Continuity / coverage |
|---|---|---|
| Douyin | 362.788 s, three videos, 3,638 meter records | Observer continuity passed, two clicks resumed in 1.038 / 1.063 s; outer runner failed while printing its oversized report |
| YouTube | 364.316 s, three videos, 3,651 meter records | Failed; page playback errors left only 34.9 / 41.2 / 41.1 s eligible per segment |
| Bilibili | 150.148 s before failed switch | Failed; first video paused near 61 s; only 54.2 s eligible, next video did not start |

The Douyin runner-output failure is retained. Detailed observations are now
returned by file reference rather than duplicated into console output. It is
not a DSP failure, but the first run does not establish successful final cleanup.

At -19 +/-2 dB, the first Douyin run's eligible short-term in-band proportions
were **44.7%, 27.7%, 28.2%**. The steady-input subset proportions were
**86.2%, 49.7%, 49.5%**, respectively. Eligible output medians were
**-21.54, -21.91, -22.53 dB** after player-volume normalization. There were no
above-band eligible short-term windows in those three segments. Thus this
sample exposes **under-target output / inconsistent lift**, not evidence that
all material is correctly balanced or that all loud transients are safe.

YouTube's limited steady subsets had medians -22.78 / -22.93 / -23.81 dB,
all below the proposed band. Bilibili's eight-second steady subset had a median
-24.84 dB. These limited records are leads for reproduction, not full-platform
scores. Frequent peak protection is one hypothesis to investigate before
increasing lift; intentional dynamics and fast protection also matter.

## Platform diagnosis

- An isolated **no-extension** YouTube control also stopped, unloaded the media
  and displayed “Something went wrong / refresh or try again later.” Disabling
  autoplay and selecting another video manually restores input only temporarily.
  This excludes LoudEase as a necessary cause in this environment, not every
  possible interaction on a user's browser. The underlying website/network
  failure is not claimed fixed. Follow the
  [official playback troubleshooting guidance](https://support.google.com/youtube/answer/3037019?hl=en)
  without bypassing account or platform restrictions.
- The no-extension Bilibili control paused at about 61 seconds and displayed a
  login dialog. Do not dismiss authentication gates, extract session cookies,
  or force playback to make the test green. Longer qualification needs a
  legitimately available playback session or other unrestricted material.

The additional YouTube network diagnostic did not reveal a conclusive media
failure code. An anonymous account-check HTTP 401 and aborted fetches are not
enough to attribute the playback error to authentication or the network.

## Tool correction and second Douyin run

The compact-report fix was verified by another complete roughly six-minute
Douyin run, with successful stop cleanup and no native audio output. The
recommendations selected a different third page, so this is not a paired
identical-content A/B comparison. The original first-run failure is retained.

Review caught another harness issue: an SPA can update its URL while still
playing the old video. URL plus `playing` alone was too weak for readiness. The
new predicate requires two advancing observations near the new video's start,
plus changed title or duration; unchanged metadata is treated as ambiguous.
Regression tests reject the observed old-video-at-121-seconds case. Reanalysis
of the retained snapshots verifies new playback at **1.650 / 2.138 seconds**,
not the original optimistic 1.084 / 0.536 seconds. The second duration includes
slightly less than 120 seconds after this stricter readiness point.

Initial setup of the legacy media helper briefly started two media elements in
two snapshots of the second run. Stable loudness analysis excludes the startup
and volume-change windows. It is not an unmodified-user-startup qualification.
The detailed record retains this limitation rather than claiming ideal startup.

Second-run results (362.662 s, 44.1 kHz stereo):

| Segment | Eligible duration | Short-term in band | Steady subset in band (duration) | Eligible output median |
|---|---:|---:|---:|---:|
| 1 | 109.4 s | 44.4% | 88.0% (30.9 s) | -21.49 dB |
| 2 | 116.0 s | 29.4% | 51.1% (18.2 s) | -22.51 dB |
| 3 | 116.8 s | 36.5% | 30.5% (9.5 s) | -21.49 dB |

The output medians span only 1.02 dB: programme-to-programme central levels are
closer than the within-programme windows suggest. Nonetheless, much of the
material remains below the proposed target band. There were zero above-band
eligible 3 s windows; this is not a peak or transient-safety conclusion.
For segment 1's quiet-input subgroup, medians changed from -32.38 to -26.31 dB;
the loud-input subgroup changed from -13.30 to -19.86 dB. These groups show
reduced contrast but not equal loudness. They are energy groups, not labels of
foreground speech or unwanted noise. The third steady subset is particularly
short and must not be treated as a platform-wide quality score.

Priorities supported by this evidence: reproduce low-output regions with legal
offline material, separate intentional quiet passages from under-mastered
speech, and inspect whether sustained transition limiting or fast protection
is too conservative. Do not simply increase maximum lift, relax peak bounds,
or redefine the target band to turn these observations into a pass. A robust
three-second convergence claim still needs controlled source changes, not the
first in-band moment in a constantly changing movie.

This work changed only test tools/documentation. It did not raise the target,
weaken peak protection, ship a new limiter, or publish a store update.

## Reproduction and privacy

Set `WVB_E2E_REAL_QUALITY=1`, `WVB_REAL_SCENARIO_TIMEOUT_MS=550000`, and run
`node tools/e2e_real_site_matrix.js --scenario douyin-short --hold-ms 360000`.
The optional `WVB_QUALITY_VIDEO_MS` overrides the default 120000 ms per video;
the matrix hold duration must match three times that value. Use
`node tools/analyze_real_quality.js tmp/<real-quality-record>.json` for analysis.

`WVB_E2E_SITE_BASELINE=1` runs a 105 s no-extension control via the smoke runner;
set `WVB_E2E_URL`, `WVB_E2E_HEADLESS=1`, and `WVB_E2E_SILENT_SINK=1` explicitly.
This mode records local visible page error text and sanitized error host/path,
not request headers, cookies or signed media query strings.

Timestamped raw/analysis files stay in ignored `tmp/`. They include public test
page metadata, never private browsing history or raw audio, and are not uploaded.
Recommendations change over time; use recorded titles/URLs to interpret each
run rather than assuming subsequent selections are identical. Instrumentation
adds measurement cost; these runs are not CPU-performance benchmarks.
