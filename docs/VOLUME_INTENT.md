# Volume intent and source-boundary regression

Status: unreleased integration, 2026-09-22. This does not replace the archived
0.8.2 store package. The detector-only true-peak candidate remains test tooling.

## Listener contract and research

The listener chooses overall level with Windows master volume or its application
mixer. LoudEase balances programmes and audible quiet/loud sections upstream;
it must not compensate against that choice. Page-player volume is different:
its attenuation can already be in captured PCM. Reliable metadata belongs in
source measurement, while output retains that attenuation. Unknown metadata
must not enable lift.

Microsoft distinguishes endpoint and session
[volume controls](https://learn.microsoft.com/en-us/windows/win32/coreaudio/volume-controls)
and describes user-controlled
[audio sessions](https://learn.microsoft.com/en-us/windows/win32/coreaudio/audio-sessions).
Chrome documents captured-audio replay in
[tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture).
These establish the architecture, not a new Windows hardware measurement.

[EBU R128 supplement 2](https://tech.ebu.ch/docs/r/r128s2.pdf) separates streaming
normalization, dynamic treatment and true-peak headroom.
[Supplement 4](https://tech.ebu.ch/docs/r/r128s4.pdf) addresses large
dialogue/programme contrasts. We retain separate programme normalization,
bounded/floor-qualified detail lift, fast cut and peak protection. We do not
adopt a distribution target as a universal speaker level, flatten intentional
silence, or claim EBU compliance for this controller.

## Reproduced defects and correction

1. Smoothing player metadata over 30 ms and then compensating a whole frame
   invents source-level changes. Compensation now precedes K-weighting sample
   by sample. Peak safety still uses captured PCM, not compensated analysis.
2. Metadata can trail PCM. Eight preallocated 20 ms checkpoints retain about
   140-160 ms of estimator history. Reliable nonzero volume changes roll back
   recent cumulative measurements and discard partial frames, short measurement
   windows and measurement-filter state. Established programme history remains;
   this is not a source reset. Normal upward confidence still applies. For a
   bounded 500 ms recovery interval, upward smoothing uses a 120 ms constant.
   Downward attack, gain-increase slew bounds and peak protection remain active.
3. Each delayed sample carries the player-volume base ceiling that applied when
   it entered the buffer. A later message neither attenuates nor amplifies that
   pending PCM. The existing 5 ms delay drains naturally; mute is immediate and
   actual onset protection still applies. This supersedes the initial buffer
   rescaling approach, which double-attenuated already-adjusted audio.
4. Genuine source boundaries clear delayed PCM, K-weighting state and partial
   accumulators as well as the estimator. Old loud samples must not play under
   the next source's reset gain.
5. Reliable zero volume is a hard mute even without a separate mute flag.

Checkpoint storage is eight pairs of 141-bin typed arrays (13,536 bytes), plus
fixed object/scalar overhead. Copies occur at 50 Hz, not per sample. Audio
look-ahead stays 5 ms. No permissions, telemetry or audio uploads were added.

## Reproduction and evidence

Baseline: `475d29ce92d63f92fa73a3b816177b86afd5afbe`.

```text
node tools/volume_intent_tests.js --baseline
node tools/volume_intent_tests.js
node tools/browser_candidate_audit.js
```

Baseline intentionally exits nonzero after preserving its report. Reports:
`tmp/volume-intent-baseline.json`, `tmp/volume-intent-audit.json`,
`tmp/browser-candidate-audit.json`.

| Controlled measurement | Baseline | Corrected |
|---|---:|---:|
| Worst aligned volume error: 3 rates x 3 levels x 4 changes | 18.168 dB | below 0.000184 dB |
| 101.33 ms metadata lag, 10% to 100%, RMS error at 0.5-1 s | -4.738 dB | -0.193 dB |
| Old PCM after source boundary, 997 Hz fixture | about -14.73 dBFS | exact zero |
| Zero volume without mute flag, nonzero input | peak 0.2 | exact zero |

Aligned tests use 20 ms windows starting 10 ms after adjustments, allowing the
existing look-ahead to drain. Lag tests retain the original 0.5 dB recovery
criterion. An intermediate fix failed (-4.728 dB), and rollback alone still
failed (-0.974 dB), before bounded recovery passed. These are not green reruns
of an unchanged implementation.

### Follow-up: high-crest and sub-look-ahead regressions

The initial `9456af2` integration passed the earlier matrix but introduced two
control regressions. `node tools/volume_edge_tests.js --baseline` reproduces
them and deliberately fails after saving `tmp/volume-edge-baseline.json`.
The normal command saves `tmp/volume-edge-audit.json` and is now part of the
required suite (33 rows at three rates, including real-onset safety and mute).

- Clearing the previous source peak invented an onset after manual adjustment.
  Retain a trusted source peak with the measurement checkpoint instead. In the
  high-crest fixture the worst 10-50 ms error fell from 5.0235 dB to less than
  0.000019 dB; genuine new loud onsets remain limited.
- Rescaling pending PCM imposed another 12.0412 dB attenuation for a 100%-to-25%
  adjustment. Carrying the base ceiling alongside PCM removes that attenuation;
  the first 4 ms transport error is zero in the isolating fixtures. This is not
  a claim that all limiter activity during a volume adjustment disappears.

The Chrome matrix now contains 66 cases, adding high-crest and first-4-ms
transport checks for both variants. The latter disables lift on both the
reference and controlled branch to isolate buffer transport. An intermediate
two-tone, full-lift comparison failed by 0.420 dB: lift had grown during the
metadata delay and returning onset protection legitimately changed shared
limiter gain. A reference deliberately retaining stale metadata cannot demand
identical control output in that case. This fixture-design failure is recorded
in `tmp/browser-volume-edge-reference-failure.json`, not counted as a pass.
The separate full-strength delayed-metadata recovery checks remain unchanged.

Research basis: [W3C Web Audio 1.0, asynchronous operations](https://www.w3.org/TR/webaudio-1.0/#asynchronous-operations)
separates control and rendering work; it supplies no sample timestamp aligning
a captured page's volume event with PCM. Carrying the boundary through the
audio delay is our engineering choice, not a W3C-prescribed algorithm. It adds
one preallocated float64 value per delay slot, no extra audio latency.

For later work, [EBU Tech 3343 v2](https://tech.ebu.ch/docs/tech/tech3343-v2.pdf),
sections 3.2 and 5.1, distinguishes dynamic processing from normalization and
discusses limitations of automatic speech-anchor detection. Do not blindly
replace cumulative programme measurement with a rolling target or assume an AI
speech detector is infallible. A future long-stream adaptation candidate needs
paired sustained-quiet-dialogue versus intentional quiet-bed/ambience fixtures,
bounded upward changes, return-to-loud recovery, and diverse-material validation.
The programme gain law and long-stream behavior are unchanged in this follow-up.

Chrome 152 adds 42 stereo OfflineAudioContext cases: production and candidate
at 44.1/48/96 kHz, including aligned controls, approximately 100 ms delayed
controls, downstream gain, source boundaries, tone residual and peak stress.
Four concurrent silent real-time contexts per variant also passed. This is
actual AudioWorklet execution, not four captured tabs or a Windows endpoint
test. Downstream gain is an explicit graph simulation; hardware output is
refused by the real-time harness.

## Limits and next gate

- Delays beyond the rollback interval, metadata ahead of PCM, rapid repeated
  adjustments, mixed contributors and custom Web Audio players are not fully
  qualified. No metadata-only method promises sample-perfect alignment without
  a shared audio/control clock.
- Synthetic tests detect clipping, corruption, unstable gain and control
  violations; they do not prove naturalness across all speech/music.
- A new source still needs representative measurement. Instant exact matching
  of an unknown next video would require future audio information.
- The known production inter-sample failure remains. Keep the detector candidate
  separate pending performance and diverse-material qualification; see
  [candidate evidence](TRUE_PEAK_CANDIDATE.md).
- Versioned packaging and current-package site/endurance checks remain release
  gates. Passing main-branch tests is not store publication.
