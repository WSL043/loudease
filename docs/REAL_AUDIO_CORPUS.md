# Local real-audio corpus audit

This is a small, deliberately bounded research set, not a listening-quality
certification. No corpus files are shipped or committed. Sources and SHA-256
checksums are pinned in `tools/quality-corpus.json`.

## Provenance and reproduction

- Mandarin and English speech: **Open Speech Repository**. Its
  [conditions](https://www.voiptroubleshooter.com/open_speech/about.html) permit
  research and modification with source attribution. Both originals are 8 kHz
  mono; browser resampling to 48 kHz does not restore missing high frequencies.
- Piano WAV and MP3: **Koz, Sound Tests & Clips**, provided by the author for
  [audio-system testing](https://www.kozco.com/tech/soundtests.html). Use locally
  for that purpose only. No general redistribution license is assumed; the
  recording and its derivatives must not be added to the public repository.

Download the four exact URLs from the manifest into `tmp/quality-corpus/` using
the listed local filenames, then run:

```text
node tools/browser_candidate_audit.js --corpus
```

The command does not download missing files or overwrite a mismatched file.
Every input must match its pinned SHA-256 before Chrome starts. It serves only
the allowlisted fixtures and research modules on loopback. Chrome uses a fresh
headless profile and OfflineAudioContext, with no speaker output. Cleanup closes
the test browser; generated metrics remain in `tmp/browser-corpus-audit.json`.
CI remains network-independent and does not silently download this material.

## Protocol

Chrome decodes each file at 48 kHz; the first eight seconds (or the whole shorter
clip) are used. Each excerpt is independently sample-peak scaled to 0.05, 0.25
and 0.95, with 250 ms silence on either side. This produces twelve controlled
input cases, each rendered through production, fused candidate and scalar
candidate: 36 renders. Stereo is retained; mono is duplicated to two channels.
These scaled inputs are experiments, not the recordings' original mastering.

Both channels are measured with 8x and 16x reconstruction, including finite
record edges. Safety gates require finite, non-silent candidate output, sample
peak within the existing ceiling, estimated true peak below full scale, a drained
audio delay and byte-identical fused/scalar output. Candidate/production RMS
differences use 20 ms windows aligned for the existing 5 ms delay. Reporting of
active-window differences excludes the initial two seconds and input RMS below
-45 dBFS. The latter is only an energy threshold, not a speech/noise classifier.
All input/output windows remain in the report, including excluded ones.

The report retains maximum and 95th-percentile differences, event times and the
count above 1 dB. These are diagnostics, not listening acceptance thresholds.
Short-window differences can reflect intentional limiting or controller recovery,
not just distortion. The WAV and MP3 are independently evaluated; they are not
sample-aligned for codec quality scoring.

## Initial observations, 2026-09-22

All twelve candidate safety/parity cases passed in Chrome 152. The maximum
estimated candidate true peak was about -3.00 dBTP. The fused optimization did
not change PCM for any material. The existing synthetic counterexamples remain
necessary: ordinary-content passes do not close production's known peak gap.

Candidate/production differences are not zero. Mandarin reached about 0.76 dB
and piano about 0.28 dB in the eligible 20 ms windows. Loud English reached
1.30 dB of extra reduction at 7.84 s of its excerpt; at 7.94 s the difference
returned to zero. This is a retained investigation point, not proof of an audible
defect or a reason to weaken peak protection. It also prevents claiming that
limiter behavior is universally transparent based on the earlier tone sweep.
Each case's 95th-percentile absolute difference was below 0.35 dB. Exactly one
eligible window exceeded 1 dB across the twelve cases. The report keeps this in
`reviewFindings`, separately from hard safety failures.

Not covered: real background-noise separation, full-band speech, dense music,
long-form programme changes, wider codec/rate combinations, acoustic output or
human preference. No runtime gain/limiter parameters were changed by this audit.
