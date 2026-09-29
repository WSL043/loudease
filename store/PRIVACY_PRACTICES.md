# Chrome Web Store Privacy Practices

Use this as the source of truth when completing or reviewing the Chrome Web Store Privacy practices form. Re-check the dashboard wording before every submission because form labels can change.

Dashboard review (`2026-09-12`): the published item declares no remote code, selects Website content and Web history for local processing, leaves the other data categories unselected, includes all three Limited Use certifications, and points to the public `PRIVACY.md`. Chrome Web Store-managed GA4 is enabled for aggregate listing-page measurement; no GA4 or other analytics code is bundled in the extension. These selections match the rationale below.

## Single purpose

LoudEase balances web audio. It reduces sudden loud sections, applies bounded strength-controlled lift to genuine quiet passages, and enforces mute and player-volume boundaries. It does this automatically for audible media on the page and, where Chrome protects the audio, through user-invoked tab capture.

## Permission justifications

| Permission | Store justification |
| --- | --- |
| `storage` | Saves the enabled state, appearance and language choices, two balance strengths, and per-site rules. Settings use Chrome Sync when the user has Sync enabled; LoudEase operates no settings server. |
| `activeTab` | Grants temporary access to the tab on which the user invokes LoudEase. Chrome uses that user-authorized tab as the target of `tabCapture`; the grant is not used to read unrelated tabs. |
| `scripting` | Injects the bundled automatic-mode content script into pages that were already open when the extension was installed or updated, and restores the media-state observer after navigation. It never injects remote code. |
| `tabCapture` | Obtains the audio stream for the current tab after the user invokes LoudEase. The stream is processed and played locally. |
| `offscreen` | Hosts the local Web Audio and AudioWorklet graph because an MV3 service worker cannot own the required DOM audio context. |
| `http://*/*`, `https://*/*` | Lets the bundled automatic-mode content script attach to audible `<audio>`/`<video>` elements on ordinary web pages and follow their mute, volume, and source state so the DSP preserves user intent. It also provides current-page access needed for per-site rules and capture-session recovery. No page text, form data, cookies, or credentials are read. |
| `web_accessible_resources` (`offscreen/leveler-worklet.js`, `shared/programme-leveler-policy.js`) | Let the content script load the bundled AudioWorklet processor into the page's own audio context. This is the only way to run the processor there under strict page CSP. The files are inert without the extension and contain no page or user data. |

The store build does not request `tabs`. Matching HTTP(S) host access already exposes the limited tab fields used by the implemented observer and session recovery. `activeTab` remains because it is the explicit user-invocation grant for the `tabCapture` target.

HTTP(S) host access is required because automatic mode must attach to media on arbitrary ordinary web pages; there is no fixed site list. The automatic-mode content script does nothing on pages without an audible `<audio>` or `<video>` element and sends no message to the service worker until one plays. Host access is limited to the single audio-balancing purpose described above.

## Remote code declaration

**No.** LoudEase does not load or execute JavaScript, WebAssembly, or other executable code from a remote source. All executable code ships inside the extension package.

## Data disclosure

Chrome requires disclosure even when data is handled only on the user's device.

| Dashboard category | Selection | Explanation |
| --- | --- | --- |
| Website content | Yes | Tab audio samples and media/player state are processed locally to balance sound and enforce mute/volume intent. Audio samples are never uploaded. |
| Web history | Yes | URLs/origins of active, audible, recognized-media, or user-authorized HTTP(S) tabs are handled locally for observer recovery, authorization ownership, and per-site rules. The observer is injected only for audible, recognized-media, captured, or explicitly opened tabs. LoudEase does not read Chrome history or build a historical browsing profile, and audio capture still starts only after the user invokes LoudEase for a tab. |
| User activity | No | LoudEase does not monitor general clicks, keystrokes, cursor movement, scrolling, or network activity. Media play/mute/volume state is disclosed above as website content. |
| Personally identifiable information | No | No names, email addresses, account identifiers, addresses, or government identifiers are collected. |
| Health, financial, authentication, personal communications, location | No | These categories are not accessed or collected. |

## Data-use certifications

- Data is used only for the extension's single purpose.
- Audio, browsing activity, settings, and diagnostics are not sold.
- Data is not used or transferred for personalized advertising.
- Data is not used for creditworthiness or lending.
- The store build sends no analytics or background telemetry.
- Chrome Web Store-managed GA4 measures the store listing separately from the extension runtime and does not change the extension's data flow.
- Chrome Sync may synchronize settings according to the user's Google account configuration.
- A support report is generated locally, excludes browsing identity and audio, and leaves the browser only when the user deliberately submits it.
- The public privacy policy contains the affirmative Chrome Web Store Limited Use statement.

## Submission blockers

- Keep the privacy policy and support URL public over HTTPS for ordinary users and reviewers.
- Re-run the store package audit immediately before every upload and confirm that no localhost diagnostic permission, string, UI, or network code remains.
