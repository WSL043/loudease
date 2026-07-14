# Maintainer triage

This guide turns community reports into reproducible work without treating every symptom or preference as an algorithm change.

## Intake states

Every report should move through one of these states:

1. **Needs evidence**: the report is missing a version, environment, reproduction, or fresh runtime state.
2. **Reproduced**: a maintainer or independent reporter confirmed the same mechanism.
3. **Root cause identified**: the failing ownership, capture, state, DSP, UI, permission, or packaging path is known.
4. **Fix ready**: the smallest relevant regression test fails before the fix and passes after it.
5. **Verified**: automated checks pass and any required real-site or listening evidence is recorded.

Do not label a plausible explanation as a confirmed root cause. Keep observed facts, inferences, and blocked verification separate.

## Priority

| Priority | Examples | First action |
|---|---|---|
| P0 | Mute or zero-volume bypass, uncontrolled gain, privacy leak, remote code, credential exposure | Disable the affected release path, preserve evidence, and use the security process when appropriate |
| P1 | Audio stops or duplicates, widespread capture failure, cross-tab ownership error, store build contains development diagnostics | Reproduce on the current build and add a focused regression before release |
| P2 | Single-platform compatibility defect, setting persistence failure, audible pumping or distortion with a reproducible sample class | Confirm scope and compare against the current DSP and site matrix |
| P3 | Translation, documentation, visual polish, or low-impact enhancement | Accept when focused and consistent with product scope |

Severity is based on impact and scope, not report volume or tone.

## Evidence rules

- Popup screenshots prove UI state, not audio processing or sound quality.
- A successful local test page does not prove a public platform is compatible.
- DSP changes need signal characteristics, input/output level evidence, peak and limiter behavior, and artifact checks.
- Website failures need the platform, media type, current extension version, capture state, source-switch behavior, and player-boundary result.
- Private media, private URLs, account information, and unlicensed recordings must stay out of public issues.

Use synthetic or redistributable fixtures for public regressions. Maintainer-owned listening material stays in the ignored private data paths described in [Data governance](DATA_GOVERNANCE.md).

## Contribution review

A pull request must be focused, DCO-signed, and explicit about permissions, privacy, capture lifecycle, DSP impact, and store-build impact. Reviewers should reject unrelated refactors, compatibility claims without evidence, silent permission expansion, telemetry, remote executable code, and copied media without redistribution rights.

Maintainer access is earned through sustained, technically sound work and is appointed by the Project Lead under [Governance](../GOVERNANCE.md). Contributors do not need maintainer access to report, test, translate, review, or submit pull requests.
