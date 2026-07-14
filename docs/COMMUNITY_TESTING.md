# Community testing guide

LoudEase does not expect one person to validate every platform, content type, and long-running session. Community testing is split into small checks that can be reproduced and compared over time.

## Before you start

- Use the beta build identified by the maintainer or the latest public prerelease, and record the extension version, source commit when available, and build target.
- Use a normal Chrome profile or a dedicated test profile. Disable other audio-processing extensions for the test.
- Do not publish private URLs, account data, tokens, browsing history, personal recordings, or copyrighted audio samples.
- A visual popup state is useful evidence, but listening and player-control behavior are still required.

## 10-minute platform check

Choose one website and one media type. You do not need to test every item in the project matrix.

1. Start playback and authorize the tab from the LoudEase popup.
2. Confirm the waveform moves and the dB value updates while sound is present.
3. Move **Reduce loud sounds** and **Lift quiet sounds**, close the popup, and confirm the values remain unchanged when it is reopened.
4. Set the player volume to zero or mute it. LoudEase must not produce audible output.
5. Restore player volume, switch to the next video, episode, stream, or source, and confirm processing resumes without a page refresh.
6. Switch to another tab for at least 15 seconds. The authorized tab should remain processed.
7. Return to the tab and note any silence, duplicate audio, interruption, stale status, or reconnection request.

Submit the result with the [compatibility form](https://github.com/WSL043/loudease/issues/new?template=compatibility.yml), including successful checks as well as failures. A confirmed success on a new platform is useful evidence.

## 20-minute listening comparison

Choose one category: dialogue, music, live speech, an advertisement transition, sparse ambience, or transient-heavy content.

Compare LoudEase off and on at the same player and system volume. Listen for:

- sudden loudness that remains uncomfortable;
- quiet detail that remains difficult to hear;
- pumping, breathing, repeated level changes, or delayed gain movement;
- distortion, crackling, harsh peaks, or flattened transients;
- noise or low-frequency ambience being lifted during near-silence;
- mute or player-volume limits being ignored.

Use the [audio-quality form](https://github.com/WSL043/loudease/issues/new?template=audio-quality.yml). Describe the content category rather than posting media you do not have permission to share.

## Optional endurance check

Long runs are useful but not required from every tester. If you can leave one authorized tab playing for 30 minutes or longer, record:

- source or track switches;
- tab switches and computer sleep/wake events;
- stale status or unexpected reconnection;
- dropouts, duplicated audio, excessive CPU use, or video stutter;
- whether mute and player-volume boundaries still work at the end.

## Translation review

Review only a language you use confidently. Check the popup, settings, diagnostic report, and Chrome extension description for mixed languages, clipped text, unnatural terminology, and untranslated fallback strings. Open a focused [bug report](https://github.com/WSL043/loudease/issues/new?template=bug.yml) with the language and exact screen.

## Maintainer triage

Maintainers should label reports by platform and failure class, reproduce the smallest reliable case, and avoid changing DSP constants from a single subjective report. Algorithm changes need a reproducible signal or multiple consistent listening reports plus the automated evidence required by [CONTRIBUTING.md](../CONTRIBUTING.md).

Raw audio, private evaluation corpora, and user browsing data are not accepted into the public repository. See [Feedback and quality improvement](FEEDBACK.md) and [Data governance](DATA_GOVERNANCE.md).
