# Privacy Policy

LoudEase processes audio locally. Audio samples are not uploaded, sold, used for advertising, or sent to an analytics service.

## Data used by the extension

The extension uses the minimum information needed to connect and control tab audio:

- the active tab identifier and URL, used to authorize capture and select per-site settings;
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
- `activeTab`, `tabs`: identify the active tab, track authorized capture sessions, and recover status.
- `scripting` and HTTP(S) host access: install or restore the lightweight media/player-state observer after navigation.

Permissions are used only for the extension's single purpose: balancing audio in user-authorized web tabs.

## Network behavior

The store build does not upload audio, browsing activity, diagnostics, settings, or analytics. It does not load remote executable code.

No remote telemetry is currently implemented. Any future opt-in quality measurement requires a new privacy review, prominent in-product consent, updated store disclosures, and the release gates in [docs/DATA_GOVERNANCE.md](docs/DATA_GOVERNANCE.md).

Current feedback channels and the future collection boundary are documented in [docs/FEEDBACK.md](docs/FEEDBACK.md). GitHub issues and store support are user-initiated support routes, not background telemetry.

## Contact

Use the repository's issue tracker for ordinary privacy questions. Report security vulnerabilities privately according to [SECURITY.md](SECURITY.md). Do not post personal browsing history, private URLs, account data, or unredacted diagnostics in a public issue.
