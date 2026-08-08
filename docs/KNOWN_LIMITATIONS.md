# Known limitations

## Browser authorization

- Chrome requires a user invocation before a new tab can start `tabCapture`.
- The extension cannot silently capture every future tab or guarantee that no unauthorized tab plays first.
- Chrome internal pages and other protected surfaces cannot be captured.

## Player volume

- Player-volume enforcement depends on fresh, conflict-free media observations.
- Pages with several simultaneous media elements can make the effective player volume ambiguous.
- When state is unsafe to infer, upward lift is disabled or reduced.
- The extension cannot control system, hardware, speaker, or headphone gain.

## DSP

- The limiter is sample-peak based and does not yet estimate oversampled true peak.
- Measurement is K-weighted and dual-window but is not a complete BS.1770 integrated LUFS implementation.
- There is no speech/music classifier, source separation, denoising, or multiband compression.
- Equal perceived loudness across all content is impossible without sacrificing dynamics and introducing artifacts.
- Full-strength quiet lift can use up to `15 dB` of bounded peak compression, so high-crest music may sound intentionally denser and source noise may become more audible.
- Synthetic fixtures do not prove universal listening preference.

## Compatibility

- Tab-wide capture is more resilient than media-element attachment, but site or Chrome changes can still affect authorization, player-volume hints, or playback.
- Current-version long-duration evidence must be refreshed for YouTube, Bilibili, and Douyin before Chrome Web Store submission.
- DRM/protected media behavior depends on Chrome and the site; no bypass is attempted.

## Product status

- Version `0.7.1` is a beta, not a hearing-protection or medical product.
- The GitHub build contains optional localhost diagnostics; the store build removes them.
- Version `1.0.0` requires the gates documented in `docs/VERSIONING.md`.
