# DSP evaluation contract

LoudEase is optimized for comfortable web listening, not for maximizing standards compliance or flattening every moment. A DSP candidate enters the runtime only when reproducible evidence shows that it improves the product objective without hiding a material regression.

## Product objective

- reduce programme-to-programme average loudness differences;
- reduce disruptive jumps and short peaks before they leak;
- recover genuinely quiet material when evidence and headroom exist;
- retain useful dynamics and transient character inside a programme;
- avoid pumping, breathing, noise-floor lift, hard clipping, and stereo movement;
- respect mute and player-volume intent;
- keep latency, memory, and AudioWorklet CPU suitable for continuous use.

There is no invented aggregate score. A candidate can win one metric and still be rejected.

## Required comparison states

- **legacy reference** when the claim is a structural improvement over the replaced controller;
- **current runtime** as the normal baseline for future changes;
- **candidate** rendered from the same PCM and settings;
- **bypass** when measuring coloration, latency, or false-positive processing.

Use identical PCM, sample rate, channel layout, programme boundaries, player-volume state, strength settings, and metric code.

## Deterministic fixture families

### Programme centre

Use steady sources at materially different levels. Record input loudness, output loudness, gain, limiter activity, and hard clips.

Acceptance requires both:

- ordinary content remains close to its bypass average;
- loud and quiet programme centres move materially closer together.

Do not demand that every individual source have zero enabled/bypass delta. That would make cross-source normalization impossible.

### Internal dynamics

Use verse/chorus, dialogue/effect, transient-rich, sparse-ambience, and loud-live-programme/near-silence sequences. Record input and output contrast, gain distribution, transient attenuation, and recovery.

The desired result is a smaller disruptive range, not a flat waveform.

A loud programme's near-silence must not be reclassified as a second quiet programme. At full strength, clearly audible within-programme detail may receive up to 16 dB and the correction falls to zero below the quiet-detail floor; programme-to-programme correction remains independently capable of lifting an entire genuinely quiet source.

### Cold start and jumps

Use silence-to-loud, quiet-to-loud, normal-to-loud, and source-boundary transitions. Record the first 5, 20, and 40 ms; limiter samples; hard clips; and recovery trajectory.

Downward protection must act before upward programme confidence exists. Upward normalization must not guess from the first samples, but continuous accepted signal in a short-form clip must reach full confidence in about 1.5 seconds. A two-second multi-level sweep must keep its output range within 5 dB, bring the quiet reference above -25 dB, and remain onset-safe.

### Quiet lift and noise

Use quiet speech-like, dense music-like, high-crest, silence, and near-floor signals. Record requested and realized lift, peak budget, limiter activity, and false lift.

Reliable player-volume-scaled copies of one source should receive equivalent source-domain gain decisions while retaining the intended output-volume difference.

### Programme boundaries

Run a loud programme followed by a quiet programme with and without an explicit boundary. The boundary path must clear estimator history and inherited gain. Within one programme, ordinary amplitude changes must not reset the estimator.

### Runtime boundaries

Verify mute, zero volume, unknown/conflicting player volume, live settings changes, navigation, capture start/stop, mono/stereo linked gain, worklet fallback, and multiple captured tabs.

## Controlled listening set

Synthetic fixtures prove invariants but cannot select a universal listening preference. Maintain legally usable examples of:

- normal and very quiet dialogue;
- music with preserved dynamics;
- live speech;
- advertisements and creator-to-creator jumps;
- dense transients;
- sparse ambience and background noise.

Randomize A/B order where practical. Judge comfort, intelligibility, dynamics, pumping, noise lift, and transient damage separately. Record disagreement rather than collapsing it into a false score.

## Performance budget

Measure render cost, allocations, algorithmic latency, retained memory per session, and multiple-tab behavior for any candidate that adds history, oversampling, FFTs, or classification.

The current estimator uses a fixed histogram and the worklet reuses control objects. No audio buffer or rolling programme window grows with runtime.

## Accepted structural replacement: programme-leveler-v4

The former controller combined a fixed `-29 dB` output target with separate short-window quiet lift, peak allowances, output-feedback assistance, target holding, and an absolute `-24 dBFS` transition ceiling. It converged synthetic levels strongly, but lowered typical content, flattened internal dynamics, and visibly accumulated policy branches.

The accepted replacement uses:

```text
gated cumulative programme reference
  -> bounded programme baseline
  + floor-qualified within-programme detail (max +16 dB)
  + independent fast loud protection
  -> one asymmetric smoother
  -> adaptive 5 ms look-ahead limiter
```

`tools/programme_leveler_experiment.js` retains the same legacy measurements and renders both the production worklet and an independent model. At full strength:

- the selected `-19 dB` centre minimizes worst enabled/bypass error across the two ordinary calibration levels to about `1.24 dB`;
- five steady programme outputs span about `2.21 dB`;
- two-second short-form inputs spanning about `32.82 dB` converge to about `3.97 dB` of output variation;
- a 12.04 dB internal contrast retains about `2.30 dB` instead of `0.40 dB`;
- the quiet-to-loud first 20 ms changes from the old `-24 dBFS` peak / `-27.75 dB` RMS to about `-13 dBFS` peak / `-17.10 dB` RMS;
- production and independent-model asserted metrics differ by less than `0.05 dB`;
- deterministic steady fixtures have zero hard-clipped samples.

An explicit source-boundary experiment also shows why cumulative measurement needs a real reset signal. A 10–30 second rolling baseline was rejected as the primary model because it would eventually chase programme sections.

## Candidate roadmap

These are hypotheses, not promised features:

### Quiet-signal confidence

Test cheap persistence, stationarity, crest, or spectral-flatness evidence against quiet dialogue, music, hiss, and ambience. Promote only if false noise lift falls without suppressing wanted quiet content.

### Detector-only true peak

Test 4x detector oversampling without oversampling the full audio path. Promote only if it catches inter-sample overshoot at acceptable render cost.

Corrected screening result (`2026-09-12`): the original 8x audit replaced a failing alternating-sample waveform with a passing near-Nyquist sine. Its reported `2.4 dB` minimum margin applied only to that smaller fixture set and did not resolve the counterexample. The strict `npm run audit:true-peak` now retains the original waveform, a sub-full-scale variant, and a phase-offset quarter-rate sine; it exits nonzero when any fixture exceeds estimated full scale and writes `tmp/true-peak-audit.json` even on failure.

Both the 8x Hann / radius-32 detector and a 16x Blackman / radius-128 cross-check pass analytical quarter-rate sine, constant-level, and silence calibration. With cut strength `0`, lift strength `100`, and a three-second quiet prelude, the expanded audit reproduces nine over-full-scale cases across 44.1, 48, and 96 kHz. The quarter-rate tone estimates are about `+0.10 dBTP` with both filters. Alternating-sample onset estimates are roughly `+1.01` to `+1.05 dBTP` with the short filter and `+2.74` to `+2.77 dBTP` with the long filter. Their magnitude is filter-sensitive; neither filter is a certified meter or a hardware reconstruction measurement. Input samples below full scale still reproduce the failure.

The normal regression suite runs detector calibration (`--self-test`) alongside existing sample-safety tests. CI also runs the full strict audit in an explicitly non-blocking experimental step and emits a warning on failure. A successful integration job does **not** establish true-peak safety; inspect that step's outcome. The true-peak candidate now has reproducible motivation: it must fix these counterexamples and demonstrate acceptable render cost, ordinary-content dynamics, and listening results before entering the release pipeline. [ITU-R BS.1770](https://www.itu.int/rec/R-REC-BS.1770) provides the measurement reference.

### Fixed-coefficient render cost

`npm run audit:worklet-performance` compares the current production processor with commit `afcfff1cfd2456048c1b80de43286076beb9e6fa` and requires unchanged policy source. Fetch that commit if using a shallow checkout. The worklet now calculates fixed smoothing coefficients and onset thresholds once per worklet scope. A 12-second stereo sequence covers lift, cut, silence, mute, player-volume changes, zero strengths, disabling, target changes, and programme resets. Three alternating-order trials at 44.1, 48, and 96 kHz produced byte-identical PCM and identical emitted state. Median elapsed times decreased by `9.34%`, `9.66%`, and `11.59%`, respectively, on this host's Node `v24.19.0` VM. This measures local harness time, not Chrome or whole-system CPU, and does not change the true-peak limitation.

### Metadata-assisted boundaries and loudness

Use trustworthy site or media metadata when available, while retaining the PCM fallback. Do not add site-specific assumptions that silently misclassify ordinary pages.

## Promotion rule

A candidate may enter the normal path only when:

1. the claimed improvement is reproduced against current runtime;
2. relevant deterministic invariants pass;
3. contrasting listening fixtures show no material regression;
4. CPU, latency, memory, privacy, and player-control boundaries remain acceptable;
5. the result generalizes beyond the motivating sample;
6. obsolete policy branches and tests are removed rather than retained underneath the new path.

A failed candidate is useful evidence. Keep the result; do not keep the complexity.
