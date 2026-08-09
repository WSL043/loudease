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

Use verse/chorus, dialogue/effect, transient-rich, and sparse-ambience sequences. Record input and output contrast, gain distribution, transient attenuation, and recovery.

The desired result is a smaller disruptive range, not a flat waveform.

### Cold start and jumps

Use silence-to-loud, quiet-to-loud, normal-to-loud, and source-boundary transitions. Record the first 5, 20, and 40 ms; limiter samples; hard clips; and recovery trajectory.

Downward protection must act before upward programme confidence exists. Upward normalization must not guess from the first samples.

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
  -> programme correction
  + relative within-programme correction
  -> one asymmetric smoother
  -> adaptive 5 ms look-ahead limiter
```

`tools/programme_leveler_experiment.js` retains the same legacy measurements and renders both the production worklet and an independent model. At full strength:

- the selected `-19 dB` centre minimizes worst enabled/bypass error across the two ordinary calibration levels to about `1.25 dB`;
- five steady programme outputs span about `2.21 dB`;
- a 12.04 dB internal contrast retains about `3.13 dB` instead of `0.40 dB`;
- the quiet-to-loud first 20 ms changes from the old `-24 dBFS` peak / `-27.75 dB` RMS to about `-13 dBFS` peak / `-18.98 dB` RMS;
- production and independent-model asserted metrics differ by less than `0.05 dB`;
- deterministic steady fixtures have zero hard-clipped samples.

An explicit source-boundary experiment also shows why cumulative measurement needs a real reset signal. A 10–30 second rolling baseline was rejected as the primary model because it would eventually chase programme sections.

## Candidate roadmap

These are hypotheses, not promised features:

### Quiet-signal confidence

Test cheap persistence, stationarity, crest, or spectral-flatness evidence against quiet dialogue, music, hiss, and ambience. Promote only if false noise lift falls without suppressing wanted quiet content.

### Detector-only true peak

Test 4x detector oversampling without oversampling the full audio path. Promote only if it catches inter-sample overshoot at acceptable render cost.

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
