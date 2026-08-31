# Installing LoudEase

LoudEase is a Chrome extension. Ordinary users do not deploy a server, run a database, or install Node.js. The supported public installation path is the Chrome Web Store.

## Chrome Web Store

Install LoudEase from its [Chrome Web Store listing](https://chromewebstore.google.com/detail/gdkaclfjhmenjhoemdkjlpafdhengjog). Chrome handles installation and updates.

## Manual beta sideload for trusted testers

Chrome documents unpacked extensions as a Developer-mode workflow for trusted code. Use this route only for testing a specific verified package, not as ordinary-user distribution.

Requirements:

- Chrome 116 or newer;
- the extracted verified LoudEase release directory;
- permission to use Developer mode on the Chrome installation.

Steps:

1. Download `loudease-store.zip` from the selected LoudEase GitHub prerelease. This is the same stripped package prepared for Chrome Web Store submission; it contains no localhost diagnostics.
2. Extract it to a permanent folder. Do not select the ZIP itself and do not delete the extracted folder after loading it.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Select **Load unpacked** and choose the extracted directory that contains `manifest.json`.
6. Pin LoudEase if desired, then open it once on each new tab you want to balance.

No local web server or diagnostics receiver is required. Chrome may show the normal warning used for developer-mode extensions.

Updates are not automatic. Replace the contents of the same extracted directory with the next verified ZIP, click **Reload** for LoudEase on `chrome://extensions`, and reload affected web pages. Managed browsers may disable Developer mode or unpacked extensions through enterprise policy.

See Chrome's [extension distribution guidance](https://developer.chrome.com/docs/extensions/how-to/distribute) for the difference between Web Store distribution and trusted unpacked development use.

## Build from source

This route is for contributors and maintainers.

Requirements:

- Chrome 116 or newer;
- Node.js 20 or newer;
- npm.

```bash
git clone https://github.com/WSL043/loudease.git
cd loudease
npm run build:dev
```

Load `dist/github-dev` through `chrome://extensions` as described above.

The project currently has no external runtime dependencies, so no package-install step is required. Use `npm run build:store` only to inspect the stripped store target. Use `npm run package:store` only when preparing a reviewed release candidate. The optional localhost diagnostics receiver is contributor tooling and is not part of normal installation.

When contributor diagnostics are needed, start `python tools/diagnostics_receiver.py` first and then enable the sender in LoudEase settings. The setting now reports **Receiver connected** only after the loopback endpoint answers; enabling the sender alone is not proof that a receiver exists.

## Why there is no Monkey/userscript build

Tampermonkey and Violentmonkey run userscripts in or alongside page contexts. Even [`document-start`](https://violentmonkey.github.io/api/metadata-block/#run-at) means "as early as possible" and does not guarantee execution before every page script. More importantly, userscripts do not receive Chrome's extension-only [`chrome.tabCapture`](https://developer.chrome.com/docs/extensions/reference/api/tabCapture), an extension offscreen document, or the complete tab audio mix. Reimplementing LoudEase there would be a different, weaker page-hook product with predictable iframe, MSE/Web Audio, protected-player, navigation, and startup-leak gaps.

For that reason, Greasy Fork is not a second LoudEase distribution channel. Its [publication rules](https://greasyfork.org/en/help/code-rules) are compatible with transparent source, but they cannot supply the missing browser capability. A future userscript would be limited to an independent site-UI helper and would not claim LoudEase audio processing.

## Using the extension

1. Open a normal `http` or `https` page that is playing audio.
2. Open LoudEase to authorize the current tab.
3. Confirm that the waveform is moving and a current dB value is shown.
4. Adjust **Reduce loud sounds** or **Lift quiet sounds** only when the defaults do not fit the material.

Chrome requires a user gesture before `tabCapture` can start on a new tab. After authorization, LoudEase can continue processing that tab while another tab is active. LoudEase does not modify browser shortcuts or install a native helper.
