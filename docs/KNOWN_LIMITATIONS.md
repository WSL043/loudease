# Known limitations

## Browser authorization

- Every new tab requires a user invocation before it can start `tabCapture`.
- After authorization, the captured tab can remain processed while the user switches tabs.
- Other tabs remain outside the extension until the user invokes LoudEase there.
- Chrome internal pages and other protected surfaces cannot be captured.

## Player volume

- Player-volume enforcement depends on fresh, conflict-free media observations.
- Pages with several simultaneous media elements can make the effective player volume ambiguous.
- When state is unsafe to infer, upward lift is disabled or reduced.
- The extension cannot control system, hardware, speaker, or headphone gain.
- LoudEase has no separate master-volume control. Use the website player or operating-system volume for the overall listening level; a fixed master gain would move loud and quiet material together rather than improve balancing.

## DSP

- The limiter is sample-peak based and does not yet estimate oversampled true peak.
- Measurement is K-weighted with gated cumulative programme estimation, but is not a certified BS.1770 implementation.
- There is no speech/music classifier, source separation, denoising, or multiband compression.
- Equal perceived loudness across all content is impossible without sacrificing dynamics and introducing artifacts.
- Full-strength quiet lift can use up to `10 dB` of bounded limiter allowance, so high-crest music may sound intentionally denser and source noise may become more audible.
- Within a loud programme, positive moment-to-moment detail correction is capped at `16 dB` and fades out below the quiet-content floor. This prevents near-silence from becoming a second full-volume programme, but it also means LoudEase will not make every whisper or ambience bed exactly as loud as foreground content.
- A site that changes programmes without changing page or media identity can leave the cumulative reference stale; LoudEase deliberately does not use a rolling target that would chase ordinary programme sections.
- Synthetic fixtures do not prove universal listening preference.

## Compatibility

- Tab-wide capture is more resilient than media-element attachment, but site or Chrome changes can still affect authorization, player-volume hints, or playback.
- The unchanged audio runtime used by `0.8.1` passed the automated YouTube/Bilibili/Douyin 6/6 matrix, the eight-scenario capture matrix, a native Windows endpoint stop-restoration A/B, and one 30-minute Bilibili live endurance run while packaged as 0.8.0. The 0.8.1 release refreshes the product name and metadata; the project-defined two-hour mixed-content run and broader listening remain stable-release gates rather than claims of universal preference. Anonymous headless YouTube unloaded its media element after roughly 45–60 seconds in endurance attempts, so those attempts are recorded as source failures rather than extension passes.
- DRM/protected media behavior depends on Chrome and the site; no bypass is attempted.
- Tampermonkey, Violentmonkey, and Greasy Fork are not supported core distribution channels because userscripts cannot access the whole-tab capture/offscreen pipeline. No weaker page-hook edition is advertised as equivalent.

## Product status

- Version `0.8.1` remains a public beta, not a hearing-protection or medical product.
- The GitHub build contains optional localhost diagnostics and trusted automatic-capture orchestration; the store build removes both.
- Version `1.0.0` requires the gates documented in `docs/VERSIONING.md`.
