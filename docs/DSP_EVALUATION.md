# DSP evaluation contract

LoudEase is optimized for comfortable web listening, not for maximizing standards compliance or forcing every source to one loudness. This document defines how a DSP candidate earns its way into the runtime.

## Product objective

A candidate should improve one or more of these outcomes without materially regressing the others:

- reduce disruptive loudness jumps and short peaks;
- recover genuinely quiet detail when headroom exists;
- preserve useful programme dynamics and transient character;
- avoid pumping, breathing, noise-floor lift, clipping, and stereo movement;
- respect mute and player-volume intent;
- keep latency and browser CPU cost low enough for continuous use.

There is no single universal score. A candidate may improve one axis and still be rejected because it causes an unacceptable regression elsewhere.

## Comparison states

Use only the states required to settle the claim:

- **current baseline** — the released or current-main leveler under the same fixture and settings;
- **candidate** — the proposed algorithm or parameter change;
- **bypass** — useful when measuring coloration, latency, or false-positive processing;
- **specialized candidate** — a content-specific strategy that should not become the default unless it generalizes.

Run baseline and candidate with the same PCM input, sample rate, channel layout, player-volume state, strength settings, and evaluation code.

## Deterministic fixture families

Every DSP change should run the relevant subset and any new fixture needed to expose its claimed improvement.

### Loud-jump protection

Inputs:

- steady quiet -> sudden loud tone/noise;
- repeated bursts with varied crest factor;
- clustered transients;
- loud programme followed by normal programme.

Record:

- peak before protection takes effect;
- gain-reduction onset time;
- maximum output sample peak / true peak when available;
- limiter-active samples;
- hard-clipped samples;
- recovery time and gain trajectory after the event.

### Quiet-detail lift

Inputs:

- low-level speech-like/high-crest signal;
- low-level dense music-like signal;
- full-volume and reduced-player-volume versions of the same source;
- silence and near-noise-floor material.

Record:

- requested and realized lift;
- peak and instantaneous headroom;
- player-volume invariance of the source decision;
- false lift during silence/noise;
- gain-velocity and settling behavior.

A player-volume-scaled copy of the same source should produce an equivalent source classification when player-volume state is reliable. Peak safety is evaluated in the actual captured/output domain.

### Dynamics preservation

Inputs:

- speech with natural pauses;
- music with verse/chorus contrast;
- sparse ambience plus occasional foreground events;
- transient-rich material.

Record:

- input and output loudness range over the fixture;
- time spent near maximum lift/cut;
- gain-change distribution;
- transient attenuation outside the stated protection goal.

The desired result is a narrower disruptive range, not a flat waveform or constant loudness.

### State boundaries

Verify:

- mute and zero player volume;
- unknown/conflicting player-volume state;
- settings changing while audio is live;
- source/navigation changes;
- capture start/stop and worklet fallback;
- mono/stereo linked gain.

## Controlled listening set

Synthetic fixtures prove invariants but cannot determine listening preference. Maintain a legally usable evaluation set covering at least:

- normal dialogue;
- very quiet/high-crest dialogue;
- music with preserved dynamics;
- live speech;
- advertisement or creator-to-creator loudness jumps;
- dense transient material;
- sparse ambience / background noise.

For listening comparisons:

1. level-match only when the question requires it;
2. randomize A/B order where practical;
3. judge comfort, intelligibility, dynamics, pumping/breathing, noise lift, and transient damage separately;
4. keep the current baseline in the comparison;
5. record disagreement rather than collapsing it into an invented aggregate score.

## Performance budget

Audio quality improvements are not free if they make normal browsing expensive. For candidates that add FFTs, oversampling, classification, or more history, measure:

- AudioWorklet processing time or representative CPU utilization;
- allocations on the render path;
- additional algorithmic latency;
- memory retained per capture session;
- behavior with multiple captured tabs.

Avoid per-render-block allocation in the production worklet.

## Candidate roadmap

These are hypotheses to test, not pre-approved features.

### A. Adaptive programme reference

Keep the existing fast protection and slow quiet-lift structure, but derive a bounded bias from a robust longer-term loudness distribution (for example median/quantiles over tens of seconds). The purpose is to adapt to materially different programmes or creators without chasing every moment.

Promotion condition: meaningfully reduce source-to-source jumps while preserving within-programme dynamics and avoiding slow pumping.

### B. Better quiet-signal confidence

Before adding a speech classifier, test low-cost evidence such as crest factor, persistence/stationarity, and noise-like behavior to prevent hiss or sparse ambience from receiving unnecessary lift.

Promotion condition: reduce false quiet lift without suppressing genuinely quiet dialogue or music.

### C. Oversampled true-peak detector

Add detector-path oversampling (4x at 48 kHz is the standards-aligned starting point) while keeping the audio path and latency as small as possible. Do not add oversampling merely to change a displayed number; it must reduce inter-sample overshoot or allow safer limiter behavior under real fixtures.

Promotion condition: catch peaks missed by the sample-peak detector with acceptable render-thread cost and no material extra latency.

### D. Single policy kernel

The primary AudioWorklet and fallback currently implement equivalent control policy in different code. Prefer generating or sharing one policy kernel, or strengthen deterministic equivalence tests until that is practical.

Promotion condition: remove drift risk without adding render-thread dependencies or changing proven behavior.

## What is not automatically better

Do not promote a change merely because it introduces:

- a fixed broadcast LUFS target;
- full-program integrated loudness in a short interactive control loop;
- multiband compression;
- a speech/music classifier;
- a neural model;
- more aggressive maximum gain;
- more limiter activity.

Those may be useful in a specific candidate, but each adds failure modes and must beat the current baseline on the product objective.

## Promotion rule

A DSP candidate may enter the normal path only when:

1. its claimed improvement is reproduced with before/after evidence;
2. the relevant deterministic invariants still pass;
3. no material listening-quality regression is found in contrasting fixtures;
4. CPU, latency, privacy, and player-control boundaries remain acceptable;
5. the result generalizes beyond the exact sample that motivated the change.

A failed candidate is a successful experiment if it narrows the design space. Keep the evidence; do not keep the complexity.
