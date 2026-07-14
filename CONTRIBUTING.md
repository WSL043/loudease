# Contributing to LoudEase

Thanks for helping improve LoudEase. The project is a beta audio processor, so changes should be narrow, reproducible, and honest about what was tested.

## Contribution license

By submitting a contribution, you confirm that you have the right to provide it and agree that it will be distributed under GPL-3.0-only. Contributors retain copyright in their work. A contribution does not grant the project a separate right to relicense it for a proprietary product; any future relicensing agreement must be explicit, optional, and separate from ordinary contribution.

Every commit in a pull request must include a Developer Certificate of Origin sign-off:

```text
Signed-off-by: Your Name <your.email@example.com>
```

Use `git commit -s` to add it. The sign-off certifies the statements in [DCO](DCO); it is not a copyright assignment. Do not submit copied code, media, generated output, employer-owned material, or other content whose origin and license you cannot document. The LoudEase name and logo remain subject to [TRADEMARKS.md](TRADEMARKS.md).

## Issues

Use the closest issue template when one is available and complete every relevant field. A useful bug report includes:

- extension version and whether it came from `dist/github-dev`, `dist/store`, or another build;
- Chrome version, operating system, page URL or a minimal local test page, and media type;
- exact steps, expected behavior, and observed behavior;
- whether the tab was explicitly connected from the extension popup;
- relevant diagnostics with timestamps, secrets and private browsing data removed;
- a short recording or input/output evidence when the problem is audible.

Feature requests should state the user problem, explain why current controls do not solve it, and call out any new Chrome permissions, host access, data collection, or network behavior they might require. Do not post security vulnerabilities or sensitive browsing data in public issues; follow `SECURITY.md` instead.

Use the audio-quality issue form for pumping, distortion, weak quiet lift, excessive reduction, transient loss, or unstable loudness. The feedback channel and privacy boundaries are documented in [docs/FEEDBACK.md](docs/FEEDBACK.md).

## Community testing

You do not need to run the entire compatibility matrix. The [community testing guide](docs/COMMUNITY_TESTING.md) separates platform checks, listening comparisons, endurance checks, and translation review into small tasks. Use the compatibility form for both successful and failed site checks so maintainers can distinguish verified behavior from untested targets.

Keep each report focused on one platform and media type. Do not infer broad support from one successful page, and do not change DSP constants from one subjective report without reproducible evidence.

## Development workflow

Use Node.js 20 or newer. Keep runtime code compatible with Chrome 116 or newer.

```bash
npm run build:dev
npm test
npm run test:dsp
```

Load `dist/github-dev` as an unpacked extension for interactive checks. Before proposing release-related changes, also run:

```bash
npm run test:release
```

Use `npm run build:store` only for the stripped store target. Development diagnostics must follow the explicit marker and allowlist contract in `docs/BUILD.md`; do not invent another stripping mechanism.

## DSP changes and regressions

Every DSP change must identify the signal-processing hypothesis and include evidence that can be reproduced. Add or update the smallest relevant automated test, then report:

- the input fixture or generated signal and its level, duration, and sample rate;
- before-and-after input/output loudness or level measurements;
- peak output, limiter activity, hard-clipped sample count, and maximum overshoot;
- gain envelope or settling/recovery behavior for steps, bursts, silence, and source switches;
- listening-test material and audible artifacts checked, such as pumping, breathing, distortion, or lost transients.

Run `npm run test:dsp` for DSP work. Changes affecting capture, switching, player-volume limits, or persistence also need the corresponding local E2E scenario and, where applicable, real-site evidence. A screenshot of the popup alone is not DSP evidence. Do not turn a local test-page result into a broad real-site compatibility claim.

## Permissions and privacy

Permission expansion must never be silent. Any change to `permissions`, `host_permissions`, content-script matches, captured data, storage, or network destinations requires:

- an explicit explanation in the pull request;
- the minimum scope needed for the feature;
- updated privacy and public documentation;
- tests for development/store build separation when relevant;
- reviewer approval focused on permission and data-flow impact.

Do not add remote code, analytics, telemetry, secrets, browsing-history collection, or audio upload. Test fixtures and diagnostics must not contain private URLs, titles, tokens, profiles, or recordings without clear redistribution rights.

Do not commit copyrighted programme audio or private test recordings. Use synthetic or redistributable fixtures in public tests; keep maintainer-owned listening corpora under the ignored directories defined in [docs/DATA_GOVERNANCE.md](docs/DATA_GOVERNANCE.md).

## Pull requests

Keep pull requests focused and describe the user-visible behavior, risk, and verification performed. Add tests for regressions and update documentation when behavior, limitations, permissions, privacy, build output, or supported environments change. All checks should pass from a clean checkout; note any real-site or hardware checks that could not be run.

Contributing does not grant repository access, maintainer status, release authority, or ownership of the official project. See [GOVERNANCE.md](GOVERNANCE.md).
