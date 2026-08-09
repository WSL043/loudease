# Audio DSP

This document describes the `programme-leveler-v4` controller used by LoudEase version `0.7.1`.

## Design goal

LoudEase should make different web programmes feel closer in average loudness while retaining a smaller, useful amount of dynamics inside each programme. Enabling the extension should not push ordinary content several decibels below its unprocessed average.

The controller is intentionally not a broadcast normalizer and does not claim exact standards compliance. It borrows the useful measurement model from ITU-R BS.1770 / EBU R128, then applies a low-latency receiver-side control policy suitable for live browser audio.

## Processing graph

```text
tabCapture
  -> K-weighted and raw measurement
  -> gated programme estimator
  -> one programme-centred gain law
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

`content/bridge.js` hashes the current page URL and active media-source identity locally. Only the short fingerprint is forwarded as `programmeKey`; the URL or source is not exposed as the key. The last active identity is retained while media is paused, so pause/resume does not create a false boundary. A navigation or a genuinely different active source changes the key. When that happens, the estimator, momentary history, inherited gain, and limiter state are reset before the new programme is learned.

Resetting inherited gain is important. Carrying a large lift from a quiet video into the next loud video creates exactly the first-block leak that the controller is meant to prevent.

When a site hides programme changes behind an unchanged URL and media identity, the estimator cannot know that a boundary occurred. That remains an explicit limitation rather than a reason to make the programme baseline continuously chase the audio.

## Single gain law

Let:

- `T = -19 dB` be the current product loudness centre;
- `P` be gated programme loudness;
- `M` be 400 ms momentary loudness;
- `C` and `L` be the normalized cut and lift slider strengths.

The controller forms two terms:

```text
programme correction = T - P
dynamic correction   = -0.72 * (M - P)
target gain          = programme correction + dynamic correction
```

Each term has a 1 dB deadband. Negative corrections use `C`; positive corrections use `L`. The programme term moves different sources toward a common centre. The dynamic term reduces disruptive contrast inside a programme without forcing every moment to exactly `T`.

The `-19 dB` centre is a LoudEase product calibration, not an EBU or platform mandate. A reproducible sweep compares `-20`, `-19`, `-18`, and `-16 dB` centres with the lift needed to keep the same quiet boundary. Across two ordinary reference levels, `-19 dB` minimizes the worst enabled/bypass error at about `1.25 dB`; `-20 dB` reaches about `2.19 dB` and `-18 dB` about `2.25 dB`. Any future change to `T` must beat this sweep and a controlled listening corpus rather than being inferred from the first seconds of one programme.

## Cold start and confidence

Upward gain is asymmetric by design:

- before the first 400 ms programme block, upward gain is zero;
- confidence ramps across accepted blocks;
- confidence reaches 1 after nine blocks, at roughly 1.2 seconds for continuous signal;
- downward fast protection does not wait for confidence.

Perfect first-frame upward normalization is impossible without metadata or pre-analysis: a quiet opening can be either an under-mastered programme or intentional dynamics. LoudEase therefore protects immediately, but waits for evidence before lifting.

## Fast protection and limiter

The 20 ms fast path cuts material above `T + 3 dB` even before programme confidence exists.

The sample-rate limiter has 5 ms look-ahead. During a detected onset or programme jump, its temporary ceiling is derived from the quieter of:

- `T + 6 dB`, and
- the recent output peak plus 3 dB.

The temporary ceiling follows the cut slider and lasts 40 ms. This replaces the old absolute `-24 dBFS` transition ceiling, which prevented a leak by audibly collapsing the first block. The ordinary sample ceiling remains `-3 dBFS`, adjusted downward when reliable player volume is below 100%.

The controller bounds downward gain to 24 dB and upward gain to 25 dB. Upward gain is additionally limited by captured-domain peak headroom plus a 10 dB limiter allowance. Hard clipping remains a last-resort guard and is expected to stay at zero in deterministic tests.

## Gain smoothing

One linked gain envelope is used for all channels:

- cut attack: 20 ms;
- cut release: 250 ms;
- lift attack: 180 ms;
- lift release: 600 ms;
- maximum upward movement: 3 dB per 20 ms frame.

Signal-gate hysteresis opens near `-62 dB` and closes near `-68 dB`. Gain is held through pauses up to one second so speech gaps do not reset the first following syllable; after that it returns toward unity without erasing the programme estimate.

## Player-volume boundary

When player volume is known and reliable, loudness measurement is compensated into the source domain. Peak headroom remains in the captured/output domain, and the limiter ceiling already includes the player attenuation. This prevents double-counting player volume.

The same source therefore receives approximately the same DSP gain decision at full and quarter player volume, while quarter volume still remains about 12.04 dB quieter at the output. Mute and zero volume remain hard boundaries. Unknown or conflicting player volume blocks upward gain unless the existing WebAudio-only audible fallback is valid.

## Deterministic evidence

`tools/programme_leveler_experiment.js` compares the production worklet with an independent implementation of the same policy and retains the measured legacy reference:

- worst enabled/bypass delta across the two ordinary calibration levels: about `1.25 dB` (the old controller's retained typical reference was `-7.76 dB`);
- five steady input levels: v4 output range about `2.21 dB`;
- 12.04 dB internal contrast: old about `0.40 dB`, v4 about `3.13 dB`;
- quiet-to-loud first 20 ms: old peak `-24 dBFS` and RMS `-27.75 dB`; v4 peak about `-13 dBFS` and RMS about `-18.98 dB`;
- production and independent model differ by less than `0.05 dB` on the asserted steady, dynamics, and onset metrics;
- deterministic steady fixtures report zero hard-clipped samples.

These results prove implementation invariants and the claimed structural improvement. They do not replace randomized listening tests on real dialogue, music, live speech, advertisements, and ambience.

## Deliberately excluded

The default path does not include a speech/music neural classifier, multiband compression, a rolling target, or full-path oversampling. Those features add failure modes and CPU cost. They should be considered only as isolated candidates that beat this controller on the evaluation contract.
