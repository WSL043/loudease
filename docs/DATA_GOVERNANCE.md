# Data Governance

LoudEase is open-source software, but its source license does not make private test material, listening labels, or operational data public. This document defines the boundary for release and future product work.

## Current release

- Audio processing is local. PCM audio is not uploaded.
- The store build sends no telemetry, analytics, browsing activity, diagnostics, settings, or audio to a developer-operated server.
- User-created support reports are previewed and exported only after an explicit copy, download, or "copy and open GitHub" action. Opening GitHub does not submit the report.
- The development build can send diagnostics only to an explicitly enabled localhost receiver. That code is removed from the store package.

These statements are release invariants. A change that introduces remote collection must not ship under the current privacy policy.

## Private test corpus

Private recordings, licensed media excerpts, listening-test labels, tuning notes, and derived feature datasets must stay outside the public repository. The canonical repository-local staging directories are ignored by Git:

- `private-corpus/`
- `private-data/`
- `test-data/private/`

Public tests should use synthetic signals, generated fixtures, or media with clearly documented redistribution rights. Contributors must not attach copyrighted programme audio, private streams, account data, or browsing history to public issues or pull requests.

## Future quality telemetry

Telemetry is not implemented. It may be considered only after all of these gates are complete:

1. It is off by default and requires a clear, separate opt-in inside the extension UI.
2. The consent screen names every collected field, purpose, retention period, and deletion route before collection starts.
3. Raw PCM, page titles, full URLs, query strings, fragments, browsing history, account identifiers, and free-form page content are prohibited.
4. Collection is limited to data needed to measure balancing reliability and listening quality.
5. Transport uses HTTPS, server access is restricted, retention is bounded, and deletion is testable.
6. `PRIVACY.md`, Chrome Web Store disclosures, the public schema, and the backend threat model are updated before release.
7. Store-package verification proves that telemetry remains absent when the feature is not included.

Potentially acceptable opt-in fields include extension version, browser major version, coarse operating-system family, capture outcome code, DSP implementation mode, binned gain and limiter statistics, hard-clip count, and an explicit user quality rating. Automatic measurement must not infer or transmit a platform, hostname, URL, tab identifier, persistent installation identifier, or browsing sequence. A platform may be named only when the user deliberately selects it in a manual feedback form.

The collection design and channel boundaries are defined in [FEEDBACK.md](FEEDBACK.md). GitHub issues are a manual support route, not a telemetry backend.

## Voluntary audio submissions

Audio samples require a separate workflow from telemetry. A future submission flow must require the user to choose a specific clip, confirm they have permission to provide it, review what will be uploaded, and agree to a stated retention and use policy. General telemetry consent is never consent to upload audio.

## Publication boundary

The public project may publish aggregate compatibility results and synthetic regression fixtures. Private corpus contents, individual listening records, and internal tuning experiments are not required to be published. Any public dataset release is a separate, deliberate licensing decision.
