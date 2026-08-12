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

When contributor diagnostics are needed, start `python tools/diagnostics_receiver.py` first and then enable the sender in LoudEase settings. The setting now reports **Receiver connected** only after the loopback endpoint answers; enabling the sender alone is not proof that a receiver exists.

## Trusted GitHub automatic protection

This optional maintainer workflow removes the repeated per-tab click without installing a native helper. It is deliberately absent from `dist/store` and from the public Web Store runtime.

1. Build and load `dist/github-dev` from a permanent path.
2. On Windows, preview the shortcut update without writing anything:

   ```powershell
   powershell -NoProfile -File tools/enable_auto_protection.ps1 -WhatIf
   ```

3. Double-click `Enable-LoudEase-AutoProtection.cmd`, or run the PowerShell script without `-WhatIf`. It derives the unpacked extension ID from the exact `dist/github-dev` path, replaces an older LoudEase allowlist argument instead of duplicating it, and updates current-user Start Menu and existing taskbar shortcuts. It does not close Chrome or install a background helper.
4. Exit every Chrome window so no previous Chrome process remains, then start Chrome with an updated shortcut. Chrome reads this grant only when the browser process starts; opening the flagged shortcut while an unflagged Chrome process is already running does not retrofit the grant.
5. Open a maintained YouTube, Bilibili, or Douyin page. LoudEase should enter capture before playback without opening the popup. Two protected tabs restored or opened together share one offscreen creation attempt and may run independent capture sessions.

For a custom permanent unpacked path, pass `-ExtensionPath`. To remove the argument later, run:

```powershell
powershell -NoProfile -File tools/enable_auto_protection.ps1 -Disable
```

The equivalent manual route remains available: open `chrome://extensions`, copy LoudEase's exact 32-character ID, then edit the Chrome shortcut and append:

   ```text
   --allowlisted-extension-id=your_32_character_extension_id
   ```

   A typical complete target looks like:

   ```text
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --allowlisted-extension-id=abcdefghijklmnopqrstuvwxyzabcdef
   ```

The switch does not block or disable other extensions. It names one extension ID that Chromium may treat as pre-authorized for tab capture. Only use it with a reviewed unpacked build at a stable path. Removing the argument and fully restarting Chrome restores the normal per-tab click requirement.

The Chrome Web Store package uses the same DSP but physically strips this automatic orchestration. A store extension ID could be written into a local Chrome command line in theory, but LoudEase does not ship or claim that unsupported public workflow.

## Why there is no Monkey/userscript build

Tampermonkey and Violentmonkey run userscripts in or alongside page contexts. Even [`document-start`](https://violentmonkey.github.io/api/metadata-block/#run-at) means "as early as possible" and does not guarantee execution before every page script. More importantly, userscripts do not receive Chrome's extension-only [`chrome.tabCapture`](https://developer.chrome.com/docs/extensions/reference/api/tabCapture), an extension offscreen document, or the complete tab audio mix. Reimplementing LoudEase there would be a different, weaker page-hook product with predictable iframe, MSE/Web Audio, protected-player, navigation, and startup-leak gaps.

For that reason, Greasy Fork is not a second LoudEase distribution channel. Its [publication rules](https://greasyfork.org/en/help/code-rules) are compatible with transparent source, but they cannot supply the missing browser capability. A future userscript would be limited to an independent site-UI helper and would not claim LoudEase audio processing.

## Using the extension

1. Open a normal `http` or `https` page that is playing audio.
2. Open LoudEase to authorize the current tab.
3. Confirm that the waveform is moving and a current dB value is shown.
4. Adjust **Reduce loud sounds** or **Lift quiet sounds** only when the defaults do not fit the material.

Chrome normally requires a user gesture before `tabCapture` can start on a new tab. After authorization, LoudEase can continue processing that tab while another tab is active. The trusted GitHub workflow above is the only maintained no-helper exception and requires the browser-startup allowlist.
