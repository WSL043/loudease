# Experimental detector-only limiter candidate

Status: experimental tooling, not shipped. The public 0.8.2 package has not
changed; current main includes separate volume/source-boundary fixes. Passing this experiment does not certify a
true-peak meter, a limiter ceiling, browser performance, or listening quality.

## Chrome follow-up, 2026-09-22

### Fused phase kernel

The candidate now reads each FIR history value once and accumulates all three
fractional phases together. Coefficients, 64-tap support, per-phase addition
order, pruning, limiter policy and delay are unchanged. The original scalar
phase loop remains available only in research tooling with `{ fused: false }`.
10,000 detector inputs require identical peaks; all 33 candidate Chrome scenes
also render the scalar reference and require equal SHA-256 for both PCM channels.
The main report still lists 66 production/candidate scenes, plus these 33
reference renders; benchmarks compare production, fused and scalar kernels.

Five alternating-order measured trials after warm-up in Chrome 152 gave fused
improvements of 10.49/6.63/19.28% for ordinary fixtures and 17.73/9.35/2.90% for
alternating stress at 44.1/48/96 kHz. Candidate overhead versus production was
still 54-76% ordinary and 94-166% stress. These are same-run median wall-render
times, not CPU percentages or guaranteed speedups. A preliminary run had a 4.4%
ordinary 96 kHz regression, illustrating host/timing noise; do not use timing as
a shared-runner pass threshold. JSON retains five individual trials and source
hashes. All 66 scenes and four real-time contexts per variant passed.

Nine additional tone sweeps require identical old/new candidate PCM and record
diagnostic residual/crest/window metrics. See the new
[objective quality research](OBJECTIVE_AUDIO_QUALITY.md) for results and limits.
No shipped runtime module imports the candidate.

### Finite-record/control qualification follow-up

The reference meter previously skipped filter support at both record edges;
an input shorter than that support silently received only a sample-peak check.
The default `interior` mode now rejects insufficient context and explicitly
describes a crop of continuing audio. New `zero` mode reconstructs complete
finite records including both edges and filter tails. Zero extension must not
be used to invent a stop in the middle of a continuing programme. Calibration
retains the original interior checks and adds short/first/last-burst checks
against independently padded records. A 32-sample Fs/4 burst with amplitude
1.05 is sample-safe but reconstructs above full scale; it is no longer silently
accepted as safe. Five synthesized tone definitions (15-19) from
[EBU Tech 3341 (2023), Table 1](https://tech.ebu.ch/docs/tech/tech3341.pdf)
pass their stated tolerances with both reconstruction filters. These are a
subset of the meter tests, not certification or a limiter specification.

`node tools/true_peak_control_audit.js` adds 30 stereo finite-record cases:
ten scenarios at 44.1/48/96 kHz, including volume up/down, delayed metadata,
rapid reversal, mute/unmute, zero-volume/unmute, source reset, target and strength
changes, and mono-to-stereo input into a fixed stereo output. Every event begins
under active limiting; both output channels and the actually rendered silent
delay tail are checked. Candidate passes 30/30, with worst reconstructed peak
about -2.17 dBTP. Production exceeds full scale in 27 of these 30 deliberately extreme
records. The suite checks absolute full-scale safety, not a guarantee that a
variable player-relative ceiling is maintained between samples, nor recovery
quality or arbitrary output-channel topology. It runs in the normal test suite.
Evidence: `tmp/true-peak-control-audit.json`, including source hashes and both
variants. Runtime files are unchanged by this measurement-only follow-up.

Real/encoded-material listening, low-power Chrome performance and fallback
agreement still block promotion; these synthetic passes do not close those gates.

The later control-edge follow-up expands the matrix below from 42 to 66 cases.
Candidate FIR history is no longer rescaled on metadata changes. Instead its
comparison retains the greater old/current base ceiling for the bounded audio
delay plus detector support; current-sample safety stays independent. An initial
browser failure after removing rescaling is retained locally as
`tmp/browser-candidate-pre-boundary-failure.json`. The revised integration passes
the control checks without weakening their thresholds. This remains a research
candidate, not a certified variable-ceiling true-peak limiter; performance and
encoded/diverse-material validation still block promotion. Timing below is the
earlier snapshot, not a measurement of the revised integration.

`node tools/browser_candidate_audit.js` now executes both variants in isolated
Chrome 152. Its 42 stereo offline cases passed control/finite-output checks at
44.1/48/96 kHz; candidate stress peaks stayed below full scale, while production's
retained counterexample reached about +2.74 dBTP with the long cross-check.
Steady 997 Hz tone residuals were below -99 dB in this fixture, not a perceptual
score. Four concurrent contexts per variant ran for 15 seconds with fresh
state and no processor errors, using a silent sink (not four captured tabs).

After warm-up, three alternating-order trials per rate measured candidate
offline wall-render overhead of 67.7-96.2% for ordinary material and 128.0-175.4%
for sustained alternating stress with dynamics disabled. Four seconds of stereo
audio took about 19-48 ms for production versus 49-95 ms for the candidate.
These are render elapsed times on this host, not OS CPU percentages, render-quantum
deadline guarantees or low-power laptop qualification. The earlier Node cost
estimate must not substitute for Chrome measurements. The candidate therefore
remains unpromoted. The JSON report includes source hashes and trial values.

## Hypothesis and implementation

The current limiter reacts to sample peaks. Reconstructed peaks between samples
can exceed full scale, and release during the look-ahead interval can weaken
protection before a transient leaves the delay buffer.

`tools/true_peak_candidate.js` evaluates a replacement detector in a copy of the
current worklet loaded into a Node VM or the isolated Chrome audit. Source anchors must each occur exactly
once; a changed integration point fails instead of silently testing production.
No extension source imports the candidate. Both build targets exclude `tools`.

The candidate adds three fractional phases (4x detection) with a normalized Hann
windowed sinc, 64 taps per phase, to the original sample-peak check. It retains
linked stereo gain and holds a new limiter reduction through the existing
look-ahead interval plus the detector support. It does not resample the output,
lower the global ceiling, alter loudness policy, or add network access.

Two adjacent 64-sample chunks provide a conservative maximum magnitude over the
FIR history. Multiplying that magnitude by the largest absolute coefficient sum
bounds every interpolated phase. When the bound is below the current ceiling,
the FIR multiplies can be skipped. History still advances; this is not a
signal-classification heuristic. Tests require identical gain requirements and
byte-identical stereo PCM with and without this optimization.

Detector history and coefficients occupy 3.5 KiB of typed-array storage per
processor, plus fixed object/scalar overhead. The sample loop creates no new
buffers. The 32-sample detector observation delay fits inside the existing 5 ms
audio delay at the tested 44.1, 48 and 96 kHz rates. Impulse tests verify that
the output delay remains unchanged. Rates outside that set are not qualified.

## Reproducible evaluation

```bash
node tools/true_peak_audit.js
node tools/true_peak_candidate.js
node tools/true_peak_candidate_evaluation.js
```

The first command is expected to fail on current production, retaining all
counterexamples. The other two commands must pass for the current candidate.
`npm run audit:true-peak-candidate` runs the latter pair. Run the benchmark
without simultaneous test workloads; it performs three alternating-order
trials after warm-up. It measures Node VM elapsed time, not Chrome CPU use.

The short calibration, conservative-bound equivalence, unchanged delay and
active-limiter mute tests also run in `npm test`. CI runs both the 24 original
counterexamples and the expanded stress suite (`--stress-only`) as blocking
candidate regressions. This does not remove the separate, non-blocking failed
production audit. CI does not enforce a timing threshold on shared runners.

All stress outputs are checked with both an 8x Hann/radius-32 reconstruction and
a 16x Blackman/radius-128 reconstruction, including when the short filter passes.
The reference estimates are engineering diagnostics, not certified hardware or
standards-compliance measurements. See [ITU-R BS.1770](https://www.itu.int/rec/R-REC-BS.1770)
for the measurement reference, not certification of this implementation.

## Results on 2026-09-12

| Fixture group, across three sample rates | Production over full scale | Candidate over full scale |
|---|---:|---:|
| Original high-frequency, impulse and restored counterexamples | 9 / 24 | 0 / 24 |
| Burst onset/end, phase variation, short alternating bursts, opposite impulse pairs and deterministic wideband signal | 21 / 27 | 0 / 27 |

The candidate's smallest measured margin across the expanded 51 cases is about
0.475 dB. This is a finite-set observation, not an all-input guarantee. A shorter
initial 32-tap candidate left only about 0.09 dB on the original counterexamples;
the retained candidate uses 64 taps to increase the reconstruction support.

A ten-second stereo synthetic sequence covers quiet, ordinary and loud levels,
mute while input continues, zero-volume silence, quarter player volume,
disabling, programme reset and recovery. All rates retain the 2:1 inverted
stereo ratio, and muted sections remain exactly zero. The largest absolute
one-second RMS change from production is below 0.05 dB (test limit: 0.1 dB).
This metric does not measure distortion or prove inaudibility. Original quiet
sections and the tested quarter-volume section are byte-identical.

In the final isolated benchmark (Node v24.19.0 on Windows), median elapsed-time
overhead versus production is 7.69%, 6.14% and 5.79% at 44.1, 48 and 96 kHz.
The equivalent unpruned detector costs 10.06%, 8.02% and 9.25%, respectively.
Both paths produce byte-identical PCM. These are ordinary-sequence measurements,
not a worst-case bound; continuous high-frequency material may exercise every
FIR tap. Earlier unoptimized prototypes incurred substantially larger overhead.

Generated evidence is kept locally in `tmp/true-peak-audit.json`,
`tmp/true-peak-candidate-audit.json` and
`tmp/true-peak-candidate-evaluation.json`. The evaluation records source hashes,
per-fixture peaks, per-section changes, trial timings and pruning equivalence.
The stress-only command writes a separate report rather than replacing timing
evidence. Failing stress results remain in the reports and produce exit code 1.

## Promotion remains gated

The [local real-audio corpus](REAL_AUDIO_CORPUS.md) now provides twelve
speech/piano/level combinations, including decoded MP3. This is partial material
coverage, not completion of the diverse-material or listening gate; its retained
short-window extra attenuation remains a review item.

This candidate is ready for further evaluation, not release. Required next work:

1. Measure the actual candidate AudioWorklet in Chrome, including worst-case
   sustained high-frequency material and multiple tabs. Node timings do not
   establish the render-thread deadline or whole-browser CPU budget.
2. Broaden control-transition coverage under active limiting: live ceiling and
   volume changes, source resets, mute/unmute and channel topology changes.
3. Evaluate legally usable dialogue, music, ambience and transients with
   controlled listening and distortion/envelope metrics. Small RMS differences
   do not rule out pumping or transient damage.
4. Re-run the full DSP and release gates against the exact promoted runtime,
   including fallback-policy agreement and current-version real-site evidence.

Do not enable the candidate through a hidden runtime switch or ship a package
with a different DSP path than the published source.
