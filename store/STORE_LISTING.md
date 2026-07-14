# Chrome Web Store Listing

This document contains copy-ready fields for the LoudEase store submission. The repository remains private during beta, so public URLs must be verified before submission.

## Default listing

**Product name**

LoudEase

**Summary**

Balances loud and quiet web audio locally while respecting mute and player volume.

**Single purpose**

Make audio in user-authorized browser tabs more comfortable by reducing sudden loud sections and conservatively lifting quiet detail while respecting mute and the player's current volume.

**Category**

Accessibility

**Detailed description**

LoudEase makes uneven web audio easier to listen to.

Open the extension on a tab to authorize local audio balancing. LoudEase then analyzes that tab's audio in real time, reduces sudden loud sections, and gently lifts quiet detail. It keeps the original sound hierarchy instead of forcing every moment to the same level.

What it does:

- reduces sudden loud sections with a fast safety path;
- lifts quiet detail conservatively, with headroom protection;
- respects page mute and the player's current volume;
- keeps authorized tabs balanced when you switch to another tab;
- works with ordinary video, music, live streams, and other tab audio;
- processes PCM audio locally with Web Audio and AudioWorklet;
- includes no advertising, analytics, or remote executable code.

Chrome requires a user gesture before a new tab can be captured. Open LoudEase once on each new tab you want to balance. Authorization remains attached to that tab across normal navigation until capture stops or the tab closes.

Audio quality varies with source material and listening equipment. LoudEase is a listening-comfort tool, not hearing protection or a medical device.

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
