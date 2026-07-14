# Installing LoudEase

LoudEase is a Chrome extension. Ordinary users do not deploy a server, run a database, or install Node.js. The supported public installation path is the Chrome Web Store.

## Chrome Web Store

After the public store release, install LoudEase from its Chrome Web Store listing. Chrome handles installation and updates.

The store listing is not public during the private beta.

## Manual beta sideload for trusted testers

Chrome documents unpacked extensions as a Developer-mode workflow for trusted code. Use this route only for invited or public beta testing before the store release, not as ordinary-user distribution.

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

## Using the extension

1. Open a normal `http` or `https` page that is playing audio.
2. Open LoudEase to authorize the current tab.
3. Confirm that the waveform is moving and a current dB value is shown.
4. Adjust **Reduce loud sounds** or **Lift quiet sounds** only when the defaults do not fit the material.

Chrome requires a user gesture before `tabCapture` can start on a new tab. After authorization, LoudEase can continue processing that tab while another tab is active.
