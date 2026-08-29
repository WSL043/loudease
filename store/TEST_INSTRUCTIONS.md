# Chrome Web Store test instructions

These instructions are for the `LoudEase Beta` public-review package. No account or credentials are required. The extension has no paid feature, remote service, analytics endpoint, or reviewer-only mode.

## Basic review path

1. Open a normal HTTP(S) page with audible HTML5 video or audio. A public YouTube video is sufficient; protected browser pages such as `chrome://` cannot be captured.
2. Start playback, open **LoudEase Beta** from the Chrome toolbar, and use the popup action to authorize that tab.
3. Confirm that the popup changes from a connecting state to an active state and that the input/output waveform moves while sound is present.
4. Move **Reduce loud sounds** and **Lift quiet sounds**. Close and reopen the popup to confirm that the values persist.
5. Mute the website player or set its volume to zero. LoudEase must not produce audible output. Restore the player volume to continue.
6. Open the extension settings page to inspect the current site rule, global defaults, appearance, language, and the local-only support report.
7. Choose **Stop balancing** in the popup. The capture session must end and the website's ordinary audio output must resume.

## Permission behavior

- `tabCapture` starts only after the reviewer invokes LoudEase on a tab.
- `activeTab` identifies that user-authorized capture target.
- `offscreen` owns the local Web Audio and AudioWorklet processing graph required by Manifest V3.
- `storage` saves preferences and per-site strength settings.
- `scripting` plus HTTP(S) host access restores the lightweight media-state observer after navigation and preserves mute/player-volume intent. It does not read page text, forms, cookies, credentials, or general click/keyboard activity.

All audio processing is local. The store package contains no localhost diagnostics, remote executable code, advertising, analytics, or automatic telemetry.

## Expected limitations

- Chrome requires a user gesture for every newly captured tab.
- Browser-internal, protected, and unsupported surfaces cannot be captured.
- Site navigation or player replacement can occasionally require the user to reopen the popup and authorize capture again.
- LoudEase Beta is a listening-comfort tool, not hearing protection, a medical device, or broadcast-standard loudness normalization.
