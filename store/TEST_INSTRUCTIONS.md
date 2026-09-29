# Chrome Web Store test instructions

These instructions are for the `LoudEase` public-beta review package. No account or credentials are required. The extension has no paid feature, remote service, analytics endpoint, or reviewer-only mode.

## Basic review path

1. Open a normal HTTP(S) page with audible HTML5 video or audio. A public YouTube video is sufficient; protected browser pages such as `chrome://` cannot be captured.
2. Start playback. No click on LoudEase is needed: within a few seconds the toolbar icon shows **ON**. (Automatic mode; Chrome may keep the audio context suspended until you have clicked or pressed a key on the page once.)
3. Open **LoudEase** from the toolbar and confirm the popup shows an active state and that the input/output waveform moves while sound is present.
4. Move **Reduce loud sounds** and **Lift quiet sounds**. Close and reopen the popup to confirm that the values persist.
5. Mute the website player or set its volume to zero. LoudEase must not produce audible output. Restore the player volume to continue.
6. Open the extension settings page, change **Target loudness** between Gentle (`-22 dB`), Balanced (`-19 dB`), and Strong (`-16 dB`), then reopen Settings to confirm that the calibrated baseline persists. The page also exposes site rules, appearance, language, and the local-only support report.
7. Untick **Balance this site automatically** in the popup. Processing must stop (the **ON** badge disappears) and the site's ordinary audio must continue unchanged. Tick it again to resume.
8. Optional fallback path: for audio automatic mode declines to attach (cross-origin media without CORS, DRM streams), open the popup on that tab; it offers full-tab capture through the standard Chrome user gesture. Choose **Stop balancing** to end that session.

## Permission behavior

- Automatic mode attaches only to audible `<audio>`/`<video>` elements and needs no capture permission. It never attaches to cross-origin media without CORS or to DRM media, which Chrome would silence.
- `tabCapture` (fallback path) starts only after the reviewer invokes LoudEase on a tab.
- `activeTab` identifies that user-authorized capture target.
- `web_accessible_resources` expose only the two AudioWorklet files the content script loads into the page's audio context.
- `offscreen` owns the local Web Audio and AudioWorklet processing graph required by Manifest V3.
- `storage` saves preferences and per-site strength settings.
- `scripting` plus HTTP(S) host access runs the bundled content script that attaches to media, follows mute/player-volume intent, and restores after navigation. It does not read page text, forms, cookies, credentials, or general click/keyboard activity; the only page events it listens for are media events and a single first click/key press, used solely to let Chrome start its audio context.

All audio processing is local. The store package contains no localhost diagnostics, remote executable code, advertising, analytics, or automatic telemetry.

## Expected limitations

- Automatic mode cannot attach to cross-origin media without CORS, DRM media, pages that build their own Web Audio graph, or `new Audio()` elements never inserted into the page. Chrome requires a user gesture for every tab-capture fallback.
- Browser-internal, protected, and unsupported surfaces cannot be captured.
- Site navigation or player replacement can occasionally require the user to reopen the popup and authorize capture again.
- LoudEase is a listening-comfort tool, not hearing protection, a medical device, or broadcast-standard loudness normalization.
