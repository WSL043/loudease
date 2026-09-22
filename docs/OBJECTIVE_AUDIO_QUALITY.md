# Objective audio evaluation: research and implementation

Research checked 2026-09-22. Data can reject defects and rank specific tradeoffs;
it does not establish a universal preference or the acoustic level at an ear.

## Primary research and its application

- [Audio Precision: THD versus THD+N](https://www.audioprecision.com/blog/thd-and-thdn-similar-but-not-the-same)
  distinguishes harmonic distortion from residual noise/distortion. Our tone
  diagnostic removes a least-squares fundamental and measures the remaining
  digital energy. It includes modulation, not just harmonics, and is not a
  calibrated, bandwidth-specified hardware THD+N measurement.
- [BBC R&D WHP 310](https://downloads.bbc.co.uk/rd/pubs/whp/whp-pdf-files/WHP310.pdf)
  investigates listener-side compression and environmental context. Application:
  retain user control and evaluate dynamics, not just average level. We do not
  copy its microphone-based environment sensing or add microphone permission.
- [Google ViSQOL](https://github.com/google/visqol) provides full-reference quality
  estimation. Its audio mode expects 48 kHz and downmixes channels; scores need
  aggregation across examples. It is a possible separate corpus diagnostic,
  not installed or run here. Intentional dynamics changes need a suitable
  reference; similarity to bypass alone cannot reward the desired leveling.
- [EBU Tech 3343, 2023](https://tech.ebu.ch/docs/tech/tech3343.pdf)
  distinguishes programme and dialogue loudness for cinematic adaptation.
  Application: separately score dialogue/effect contrast and background lift;
  do not replace the browser target with a delivery-standard number or assume
  the captured mix supplies isolated dialogue or future programme analysis.

## Executable diagnostics

`node tools/candidate_quality_metrics.js` evaluates 100/997/8000 Hz at three
amplitudes at 48 kHz. It renders four seconds with full dynamics, fits the final
second, records residual energy, RMS, sample crest and 20 ms RMS spread, and
requires byte-identical PCM between fused and reference candidate kernels.
The metric self-test uses a pure phase-shifted tone and a clipped counterexample.
The normal suite runs that calibration; the full sweep is a separate command.

On this run all nine comparisons match exactly. The worst settled residual is
about -91.92 dB relative to output energy; largest short-window spread is about
0.026 dB. These are fixture results, not audibility thresholds. Non-integer
cycles in a 20 ms window contribute to the 997 Hz spread, so it is not pure
pumping. Sample crest is not reconstructed true crest. This sweep deliberately
does not measure frequency response: the leveler changes gain across different
K-weighted programme levels.

## Separate acceptance dimensions

| Dimension | Evidence now | Remaining work |
|---|---|---|
| Peak integrity | Both reconstruction filters, finite-edge and control tests | Diverse decoded/encoded real material |
| Added signal error | Tone residual; optimized/reference PCM equality | Spectrum and intermodulation under active limiting |
| Stable loudness | Existing programme/volume tests; short-window diagnostics | Dialogue/effects, transient recovery and gain-envelope distributions |
| Quiet passages | Existing quiet-bed/floor and mute tests | Legally usable noisy speech and ambience corpus |
| Stereo | Both-channel PCM equality and linked-ratio tests | Perceptual spatial checks; mono quality scores are insufficient |
| Cost | Matched Chrome render trials and four silent real-time contexts | Render-deadline/CPU profiling on low-power devices |

The residual sweep does not qualify codec artifacts, speech intelligibility,
listening fatigue, or long-duration performance. A corpus must have documented
usage rights; keep private recordings out of the repository and never upload
captured user PCM. See [DSP evaluation contract](DSP_EVALUATION.md).
