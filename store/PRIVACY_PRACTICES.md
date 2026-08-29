# Chrome Web Store Privacy Practices

Use this as the source of truth when completing the Chrome Web Store Privacy practices form. Re-check the dashboard wording at submission time because form labels can change.

## Single purpose

LoudEase balances audio in browser tabs explicitly authorized by the user. It reduces sudden loud sections, applies bounded strength-controlled lift to genuine quiet passages, and enforces mute and player-volume boundaries.

## Permission justifications

| Permission | Store justification |
| --- | --- |
| `storage` | Saves the enabled state, appearance and language choices, two balance strengths, and per-site rules. Settings use Chrome Sync when the user has Sync enabled; LoudEase operates no settings server. |
| `activeTab` | Grants temporary access to the tab on which the user invokes LoudEase. Chrome uses that user-authorized tab as the target of `tabCapture`; the grant is not used to read unrelated tabs. |
| `scripting` | Restores the lightweight media-state observer after navigation when Chrome did not instantiate the declared content script. It does not inject the DSP engine or remote code. |
| `tabCapture` | Obtains the audio stream for the current tab after the user invokes LoudEase. The stream is processed and played locally. |
| `offscreen` | Hosts the local Web Audio and AudioWorklet graph because an MV3 service worker cannot own the required DOM audio context. |
| `http://*/*`, `https://*/*` | Lets the lightweight observer follow media, mute, player-volume, and SPA navigation state on ordinary web pages so the DSP can preserve user intent. It also provides current-page access needed for per-site rules and authorized-session recovery. No page text, form data, cookies, or credentials are read. |

The store build does not request `tabs`. Matching HTTP(S) host access already exposes the limited tab fields used by the implemented observer and session recovery. `activeTab` remains because it is the explicit user-invocation grant for the `tabCapture` target.

For the `0.8.0` public beta, required HTTP(S) host access is retained because the implemented product supports arbitrary ordinary web-audio pages and must restore its media-state observer after navigation in an already authorized capture session. The observer is still injected only into audible, recognized-media, captured, or explicitly opened tabs, and it is limited to the single audio-balancing purpose described above.

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
- Chrome Sync may synchronize settings according to the user's Google account configuration.
- A support report is generated locally, excludes browsing identity and audio, and leaves the browser only when the user deliberately submits it.
- The public privacy policy contains the affirmative Chrome Web Store Limited Use statement.

## Submission blockers

- The privacy policy and support URL must be public HTTPS pages. The current private GitHub repository does not satisfy that requirement for ordinary users or reviewers.
- Re-run the store package audit immediately before upload and confirm that no localhost diagnostic permission, string, UI, or network code remains.
