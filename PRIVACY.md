# Privacy Policy

LoudEase processes audio locally. Audio samples are not uploaded, sold, used for advertising, or sent to an analytics service.

## Data used by the extension

The extension uses the minimum information needed to connect and control tab audio:

- identifiers and URLs for active, audible, recognized-media, or user-authorized HTTP(S) tabs, used locally for observer recovery, capture ownership, and per-site settings; the lightweight observer is injected only for audible, recognized-media, captured, or explicitly opened tabs, and audio capture still starts only after the user invokes LoudEase for a tab;
- whether a page contains audio/video elements and whether they are playing;
- player mute and volume state, used to respect the player's current intent;
- extension enabled state, two strength values, and per-site settings;
- local DSP status such as input/output level, gain, limiter state, and capture health.

## Audio processing

After the user invokes the extension, Chrome's `tabCapture` API provides an audio `MediaStream` for that tab. The stream is processed in the extension's local offscreen document and AudioWorklet, then played to the local output device. PCM audio samples do not leave this graph.

## Storage

Settings are stored with `chrome.storage.sync`. Chrome may synchronize those settings through the user's Google account according to the user's Chrome Sync configuration. The project does not operate a separate settings server.

## Development diagnostics

The GitHub development build contains an opt-in localhost diagnostics switch. It is off by default. When the user explicitly enables it, the extension can send tab URL, title, and processing state to `127.0.0.1:18765` on the same computer for debugging.

The Chrome Web Store build removes the localhost host permission, diagnostics setting, related messages, symbols, and network code. It is not merely disabled at runtime.

## Permissions

- `tabCapture`: obtain audio from a tab after the user invokes the extension.
- `offscreen`: run the local Web Audio graph outside the service worker.
- `storage`: save settings.
- `activeTab`: grant temporary access to the tab the user invokes LoudEase on so Chrome can authorize it as the `tabCapture` target.
- `scripting` and HTTP(S) host access: install or restore the lightweight media/player-state observer after navigation.
- HTTP(S) host access also lets the extension identify the current page, apply its site rule, and track the authorized tab without requesting the broader `tabs` permission separately.

Permissions are used only for the extension's single purpose: balancing audio in user-authorized web tabs.

## Network behavior

The store build does not upload audio, browsing activity, diagnostics, settings, or analytics. It does not load remote executable code.

No remote telemetry is currently implemented. The optional support report is generated locally and excludes URLs, hostnames, inferred platform names, page titles, tab identifiers, account identifiers, event timestamps, and audio. It leaves the browser only if the user chooses to paste and submit it to a support channel.

Any future opt-in quality measurement requires a dedicated HTTPS endpoint, a new privacy review, prominent in-product consent, updated store disclosures, and the release gates in [docs/DATA_GOVERNANCE.md](docs/DATA_GOVERNANCE.md).

Current feedback channels and the future collection boundary are documented in [docs/FEEDBACK.md](docs/FEEDBACK.md). GitHub issues and store support are user-initiated support routes, not background telemetry.

## Chrome Web Store Limited Use

LoudEase's use of information received from Chrome APIs complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-policy/), including the Limited Use requirements.

Information accessed through Chrome APIs is used only to provide LoudEase's single purpose: balancing audio in tabs the user authorizes. It is not transferred to third parties except when necessary to provide that user-facing purpose, comply with applicable law, or address security abuse. It is not used for advertising, creditworthiness, lending, or unrelated analytics. Human access is not permitted except when the user deliberately includes redacted information in a support request or when another Limited Use exception applies.

## Contact

Use the repository's issue tracker for ordinary privacy questions. Report security vulnerabilities privately according to [SECURITY.md](SECURITY.md). Do not post personal browsing history, private URLs, account data, or unredacted diagnostics in a public issue.
