# Chrome Web Store Listing

This document contains copy-ready fields for the LoudEase store submission. During private preparation, public URLs must be verified before submission.

## Default listing

**Product name**

LoudEase Beta

**Summary**

Public beta that balances loud and quiet web audio locally while respecting mute and player volume.

**Single purpose**

Make audio in user-authorized browser tabs more comfortable by reducing sudden loud sections and applying bounded, strength-controlled lift to genuine quiet passages while respecting mute and the player's current volume.

**Category**

Accessibility

**Detailed description**

LoudEase Beta makes uneven web audio easier to listen to while the first public release gathers compatibility and listening feedback.

Open the extension on a tab to authorize local audio balancing. LoudEase then analyzes that tab's audio in real time, reduces sudden loud sections, and lifts genuine quiet passages according to the selected strength. Lower settings preserve more original dynamics; full strength targets closer program-level consistency.

What it does:

- reduces sudden loud sections with a fast safety path;
- lifts genuine quiet passages with a bounded, strength-scaled peak-compression budget;
- respects page mute and the player's current volume;
- keeps authorized tabs balanced when you switch to another tab;
- works with ordinary video, music, live streams, and other tab audio;
- processes PCM audio locally with Web Audio and AudioWorklet;
- includes no advertising, analytics, or remote executable code.

Chrome requires a user gesture before a new tab can be captured. Open LoudEase once on each new tab you want to balance. LoudEase keeps processing while Chrome keeps that tab-capture session live, and the popup shows when reconnection is needed.

To respect in-player mute and volume and recover an authorized session after navigation, a lightweight local observer handles the page URL plus media playback, mute, and volume state only in audible, recognized-media, captured, or explicitly opened HTTP(S) tabs. Merely being active is not enough. It does not read page text, forms, cookies, or credentials. Browsing and audio data are not sent to the developer.

Audio quality varies with source material and listening equipment. LoudEase is a listening-comfort tool, not hearing protection or a medical device.

This is a public beta. Core capture, mute, player-volume, multi-tab, source-switching, limiter, and baseline site paths are covered by automated release checks, but site behavior and listening preference still vary. Please use the support route to report compatibility or audio-quality issues without including private URLs or browsing data.

## URLs

These URLs must be publicly reachable before store submission.

- Homepage: `https://github.com/WSL043/loudease`
- Support: `https://github.com/WSL043/loudease/issues/new/choose`
- Privacy policy: `https://github.com/WSL043/loudease/blob/main/PRIVACY.md`

While the repository is private, these links are not usable by store reviewers or ordinary users. Do not submit the store listing until the repository is public or the same pages are hosted at another public HTTPS location.

## Distribution and localization

- Default language: English
- Initial distribution: all Chrome Web Store regions where the product is allowed
- UI locales already bundled: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Russian, German, French, Spanish, Brazilian Portuguese, and Arabic
- Store listing localization: English is source-ready; copy-ready drafts for the other 10 UI locales are tracked in `store/LOCALIZATION_STATUS.md` and must not be published before native or fluent review

Do not claim support for a named site unless current-version evidence exists for its video and live-audio paths. Use the broader claim "ordinary web tab audio" until the public compatibility matrix supports stronger wording.

Developer registration and account-owner steps are tracked separately in `store/ACCOUNT_SETUP.md`. They require WSL043 to accept the agreements, pay the registration fee, verify the account, and enable two-step verification.

## Submission notes

- Remote code: No
- Paid product: No
- In-app purchases: No
- Advertising: No
- Analytics or background telemetry: No
- Support reports: Generated locally and submitted only when the user chooses
- Parallel beta listing: If a beta and stable listing coexist, label the beta name and description clearly as `BETA` or `DEVELOPMENT BUILD`.
