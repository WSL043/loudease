# Audio DSP

This document describes the `programme-leveler-v4` controller used by LoudEase version `0.8.1`.

## Design goal

LoudEase should make different web programmes feel closer in average loudness while retaining a smaller, useful amount of dynamics inside each programme. Enabling the extension should not push ordinary content several decibels below its unprocessed average.

The controller is intentionally not a broadcast normalizer and does not claim exact standards compliance. It borrows the useful measurement model from ITU-R BS.1770 / EBU R128, then applies a low-latency receiver-side control policy suitable for live browser audio.

## Processing graph

```text
tabCapture
  -> K-weighted and raw measurement
  -> gated programme estimator
  -> programme baseline + bounded detail + fast protection
  -> one linked gain smoother
  -> 5 ms look-ahead adaptive limiter
  -> player mute boundary
  -> destination
```

The normal path is entirely inside `offscreen/leveler-worklet.js`. The offscreen main thread sends settings and media state; it is not part of the 20 ms control loop. The fallback path uses the same policy functions from `shared/programme-leveler-policy.js` with lower timing guarantees.

## Measurement

- Raw samples provide peak safety.
- A K-weighting biquad approximation provides loudness energy.
- Frames are 20 ms.
- Momentary loudness uses 400 ms.
- Short-term loudness uses 3 seconds for diagnostics.
- A programme block is added every 100 ms once 400 ms of history exists.

The programme estimator is a constant-memory loudness histogram. It applies an absolute `-70 dB` gate and a relative gate 10 dB below the current ungated programme estimate. The gated energy mean is the programme reference `P`.

This measurement continues for the programme, but it is not a 10–30 second rolling median. A rolling window would eventually mistake a quiet introduction, loud chorus, or action sequence for a new baseline and slowly pump the whole programme.

## Programme boundaries

`content/bridge.js` hashes the current page URL and audible media-source identity locally. Muted and zero-volume helper elements are excluded because they do not contribute to captured programme audio. Only the short fingerprint is forwarded as `programmeKey`; the URL or source is not exposed as the key. The last audible identity is retained while media is paused or muted, so pause/resume and temporary helper overlays do not create a false boundary. A navigation or a genuinely different audible source changes the key. When that happens, the estimator, momentary history, inherited gain, and limiter state are reset before the new programme is learned.

Resetting inherited gain is important. Carrying a large lift from a quiet video into the next loud video creates exactly the first-block leak that the controller is meant to prevent.

When a site hides programme changes behind an unchanged URL and media identity, the estimator cannot know that a boundary occurred. That remains an explicit limitation rather than a reason to make the programme baseline continuously chase the audio.

## One policy with three bounded decisions

Let:

- `T` be the selected product loudness centre (`-19 dB` by default, adjustable from `-22` to `-16 dB`);
- `P` be gated programme loudness;
- `M` be 400 ms momentary loudness;
- `C` and `L` be the normalized cut and lift slider strengths.

The controller forms a stable baseline and a smaller within-programme term:

```text
programme correction = T - P
dynamic correction   = -0.86 * (M - P)
target gain          = programme correction + dynamic correction
```

Each term has a 1 dB deadband. Negative corrections use `C`; positive corrections use `L`. The programme term moves different sources toward a common centre and is retained as the baseline through silence. Positive dynamic correction is a detail aid, not a second normalizer: it is capped at `16 dB` at full lift strength and fades from full eligibility at `-40 dB` to zero at `-48 dB`. The larger audible-detail allowance closes more of the gap inside a loud programme without granting any positive detail correction to near-silence. The negative dynamic term and the independent fast path may still reduce loud material.

The distinction matters on live streams. Before this bound, a programme measured near `-14 dB` followed by a `-60 dB` quiet bed could request the global `+25 dB` maximum, then reverse when speech or effects returned. The resulting 30-plus-decibel gain travel was heard as a long loud/quiet wave. With the current policy, that bed receives no positive detail term; only the stable programme baseline remains. An entire genuinely quiet programme can still receive the full bounded programme correction.

The fast protector independently limits the result when a 20 ms/100 ms measurement exceeds `T + 3 dB`. These decisions feed one target and one linked stereo envelope, so there are not separate compressors fighting each other.

The `-19 dB` default is a LoudEase product calibration, not an EBU or platform mandate. A reproducible sweep compares `-20`, `-19`, `-18`, and `-16 dB` centres with the lift needed to keep the same quiet boundary. Across two ordinary reference levels, `-19 dB` minimizes the worst enabled/bypass error at about `1.24 dB`; `-20 dB` reaches about `2.18 dB` and `-18 dB` about `2.23 dB`. Users may trade that neutrality for a gentler or stronger centre in advanced settings. The selected target is bounded to `-22` through `-16 dB`, and the positive programme cap moves with it from `22` through `28 dB`; the limiter allowance, player-volume boundary, and maximum cut do not expand.

## Cold start and confidence

Upward gain is asymmetric by design:

- before the first 400 ms programme block, upward gain is zero;
- confidence ramps across accepted blocks;
- confidence reaches 1 after 12 accepted blocks, at roughly 1.5 seconds for continuous signal;
- downward fast protection does not wait for confidence.

Perfect first-frame upward normalization is impossible without metadata or pre-analysis: a quiet opening can be either an under-mastered programme or intentional dynamics. LoudEase therefore protects immediately, but waits for evidence before lifting. The shorter ramp is intentionally calibrated for short-form feeds; the quiet-content floor, peak budget, and limiter remain unchanged safety boundaries.

## Fast protection and limiter

The 20 ms fast path cuts material above `T + 3 dB` even before programme confidence exists.

The sample-rate limiter has 5 ms look-ahead. During a detected onset or programme jump, its temporary ceiling is fixed at `T + 6 dB`, follows the cut slider, and lasts 40 ms. It deliberately does not follow the recent output peak: a quiet preceding passage must not pull the next onset ceiling downward and create limiter pumping. This replaces both the old absolute `-24 dBFS` transition ceiling and the later recent-peak-dependent variant. The ordinary sample ceiling remains `-3 dBFS`, adjusted downward when reliable player volume is below 100%.

The controller bounds downward gain to 24 dB and upward gain to 25 dB. Upward gain is additionally limited by captured-domain peak headroom plus a 10 dB limiter allowance. Hard clipping remains a last-resort guard and is expected to stay at zero in deterministic tests.

## Gain smoothing

One linked gain envelope is used for all channels:

- cut attack: 20 ms;
- cut release: 250 ms;
- lift attack: 180 ms;
- lift release: 120 ms;
- maximum upward movement: 3 dB per 20 ms frame.

Signal-gate hysteresis opens near `-62 dB` and closes near `-68 dB`. Gain is held through pauses up to one second so speech gaps do not reset the first following syllable; after that dynamic movement returns toward the bounded programme baseline rather than unity. This avoids changing the average enabled baseline merely because a stream contained silence.

## Player-volume boundary

When player volume is known and reliable, loudness measurement is compensated into the source domain. Peak headroom remains in the captured/output domain, and the limiter ceiling already includes the player attenuation. This prevents double-counting player volume.

The same source therefore receives approximately the same DSP gain decision at full and quarter player volume, while quarter volume still remains about 12.04 dB quieter at the output. Mute and zero volume remain hard boundaries. Unknown or conflicting player volume blocks upward gain unless the existing WebAudio-only audible fallback is valid.

## Deterministic evidence

`tools/programme_leveler_experiment.js` compares the production worklet with an independent implementation of the same policy and retains the measured legacy reference:

- worst enabled/bypass delta across the two ordinary calibration levels: about `1.24 dB` (the old controller's retained typical reference was `-7.76 dB`);
- five steady input levels: v4 output range about `2.34 dB`;
- 12.04 dB internal contrast: old about `0.40 dB`, v4 about `3.14 dB`;
- quiet-to-loud first 20 ms: old peak `-24 dBFS` and RMS `-27.75 dB`; v4 peak about `-13 dBFS` and RMS about `-18.98 dB`;
- production and independent model differ by less than `0.05 dB` on the asserted steady, dynamics, and onset metrics;
- deterministic steady fixtures report zero hard-clipped samples.

These results prove implementation invariants and the claimed structural improvement. They do not replace randomized listening tests on real dialogue, music, live speech, advertisements, and ambience.

The live quiet-bed regression first establishes a loud programme, then renders three seconds near the signal floor and returns to loud content. It rejects the former `+25 dB` rise and verifies that the gain leaves the detail state before the loud programme resumes.

## Deliberately excluded

The default path does not include a speech/music neural classifier, multiband compression, a rolling target, or full-path oversampling. Those features add failure modes and CPU cost. They should be considered only as isolated candidates that beat this controller on the evaluation contract.
