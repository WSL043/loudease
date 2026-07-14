# LoudEase support

LoudEase support is public by default and organized by the kind of evidence needed. All ordinary reports and proposals are submitted through GitHub Issue Forms. There is no automatic telemetry service and no guaranteed response time.

## Choose a channel

| Need | Use |
|---|---|
| Reproducible extension bug | [Bug report](https://github.com/WSL043/loudease/issues/new?template=bug.yml) |
| Pumping, distortion, weak lift, or other listening problem | [Audio quality report](https://github.com/WSL043/loudease/issues/new?template=audio-quality.yml) |
| Result from a website, stream, source switch, or tab switch | [Compatibility check](https://github.com/WSL043/loudease/issues/new?template=compatibility.yml) |
| Short listening impression | [Listening feedback](https://github.com/WSL043/loudease/issues/new?template=feedback.yml) |
| Focused product proposal | [Feature request](https://github.com/WSL043/loudease/issues/new?template=feature.yml) |
| Security vulnerability | [Private security advisory](https://github.com/WSL043/loudease/security/advisories/new) |

Chrome Web Store reviews are useful for public product impressions after the listing exists, but they are not a debugging channel. Store support and GitHub links will be enabled only when their corresponding public surfaces are ready.

## Before submitting

- Search open and closed issues for the same symptom.
- Confirm the problem on the current version with other audio-processing extensions disabled.
- Include the extension version, Chrome version, operating system, two strength values, and the shortest reproducible sequence.
- State whether mute, zero player volume, source switching, and tab switching were involved.
- Paste only the relevant fields from the redacted support report after reviewing it.

Do not submit private URLs, page titles, account details, tokens, browsing history, personal recordings, copyrighted programme audio, or unredacted diagnostics. Audio samples are accepted only when the submitter owns them or has explicit permission to share them.

## What happens next

WSL043 reviews reports by safety impact, reproducibility, scope, and evidence. A report may be closed when it cannot be reproduced and lacks enough information to distinguish a LoudEase defect from a website, Chrome, another extension, or the source material.

DSP constants are not changed from one subjective report. Audio behavior changes require a reproducible signal, repeatable measurements, or multiple consistent listening reports plus regression coverage.

See [Feedback and quality improvement](docs/FEEDBACK.md), [Data governance](docs/DATA_GOVERNANCE.md), and [Security](SECURITY.md) for the privacy and disclosure boundaries.
