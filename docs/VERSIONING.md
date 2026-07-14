# Versioning and release evidence

LoudEase versions describe the evidence and compatibility boundary of a build. They do not count edits or attempts.

## Version format

- `manifest.json` and `package.json` use Chrome-compatible numeric versions such as `0.8.0` or `1.0.0`.
- GitHub tags may add a SemVer prerelease suffix such as `v0.8.0-beta.1`.
- Documentation, package metadata, release assets, and runtime diagnostics must identify the same source commit and product version.

## Private beta: 0.7.x

The current private series may continue receiving focused fixes without creating a release for every commit. A maintenance commit on `main` does not automatically bump the version, create a tag, or publish a package.

Before the repository becomes public, stale private prereleases may be removed once, using the exact approval boundary in `docs/PUBLISHING.md`.

## Public beta: 0.8.x or 0.9.x

Create one public GitHub prerelease only after:

1. automated tests and the stripped store build pass from a clean checkout;
2. the current build has direct evidence for the baseline YouTube, Bilibili, and Douyin video/live paths;
3. mute, zero player volume, tab switching, source switching, slider persistence, and multi-tab capture have current-version evidence;
4. the public README, installation steps, privacy policy, issue forms, known limitations, license, asset provenance, and checksums are complete;
5. there is no unresolved P0/P1 audio interruption, uncontrolled gain, mute bypass, cross-tab ownership, or release-package defect.

The first public beta tag should be new and unambiguous, for example `v0.8.0-beta.1`. Do not expose the obsolete private prereleases as the public launch sequence.

## Stable release: 1.0.0

Promote to `1.0.0` only when the project has evidence, whether collected by WSL043 or reproducibly contributed by the community, for all of the following:

1. no open P0/P1 audio interruption, uncontrolled gain, mute bypass, capture ownership, or privacy defect;
2. representative endurance evidence covering mixed content and the baseline platform matrix;
3. controlled on/off listening evidence for dialogue, music, live speech, quiet material, and strong transients, with pumping, distortion, clipping, lost transients, settling, and recovery reviewed;
4. compatibility claims restricted to current-version evidence, with unsupported or protected surfaces documented honestly;
5. the store package contains no localhost diagnostics, remote executable code, secrets, development markers, or undeclared data flow;
6. Chrome Web Store listing, permissions, privacy fields, screenshots, support route, account setup, and test instructions are complete;
7. public CI, installation instructions, issue forms, security policy, license, source archive, and the checksum of the single stripped release ZIP match the release commit.

Do not promote a major version because the project has accumulated many edits or appears feature-complete. Stable means that the published evidence and support boundary are coherent.

## Public history

Once a beta is public, retain its release and tag. The stable release becomes **Latest** and the beta remains a prerelease in project history. Rewriting public release history is reserved for legal or security incidents, not cosmetic cleanup.
