# Chrome Web Store Listing

This document contains the canonical Chrome Web Store copy for LoudEase. Version `0.8.2` is publicly listed; re-verify these fields and URLs before every update.

## Default listing

**Product name**

LoudEase: Auto Volume Normalizer

(localized through `appStoreName`; the in-popup product name stays `LoudEase`)

**Summary** (132 characters maximum)

Auto volume normalizer: tames loud ads and sudden peaks, lifts quiet dialogue, on any tab. Works automatically, no clicks.

**Single purpose**

Make web audio more comfortable by reducing sudden loud sections and applying bounded, strength-controlled lift to genuine quiet passages while respecting mute and the player's current volume.

**Category**

Tools

Rationale: the `Accessibility` category has almost no organic browsing traffic and is not where people look for volume tools. The comparable volume-normalizer listings are in `Tools`. Category does not change search ranking, but it decides which browse lists the item appears in. The change is made in the Developer Dashboard, not in the package.

**Detailed description**

LoudEase is an automatic volume normalizer for Chrome. It pulls loud ads and sudden peaks down and lifts quiet dialogue, so you stop reaching for the volume control.

Install it and play something. No clicks, no setup. LoudEase balances audible video and audio on ordinary web pages by itself, and the toolbar icon shows ON while it is working.

WHAT YOU GET
- Loud ads, jump scares and peaks come down (fast protection plus a 5 ms look-ahead limiter)
- Quiet dialogue and quiet videos come up (bounded, strength-controlled lift)
- Steadier volume from one video, stream or creator to the next
- Your mute and player volume stay in charge; LoudEase never overrides them
- Three calibrated targets (Gentle, Balanced, Strong), per-site rules, and a per-site off switch
- 100% on-device processing with Web Audio and AudioWorklet: no accounts, no ads, no analytics
- 11 interface languages

HOW IT DIFFERS FROM A VOLUME BOOSTER
A booster makes everything louder, peaks included. LoudEase measures programme loudness and moves loud and quiet passages toward a common level, so you choose the overall volume with the player as usual.

WORKS WITH
HTML5 video, music and live streams on ordinary web pages. Verified with no clicks on YouTube and Bilibili. Some audio cannot be attached automatically because Chrome protects it (cross-origin media without CORS, DRM streams, pages that build their own audio graph). There, open LoudEase once on that tab to use full-tab capture instead.

PRIVACY
Audio is processed on your device and never recorded or uploaded. A lightweight local observer reads only page media state (playing, muted, volume) and never page text, forms, cookies or credentials. No advertising, analytics or remote code.

LoudEase is a listening-comfort tool, not hearing protection or a medical device. It is a public beta: please report compatibility or audio-quality problems through the support link without including private URLs.

## URLs

These URLs are public and must remain reachable for store users and reviewers.

- Homepage: `https://github.com/WSL043/loudease`
- Support: `https://github.com/WSL043/loudease/issues/new/choose`
- Privacy policy: `https://github.com/WSL043/loudease/blob/main/PRIVACY.md`

## Distribution and localization

- Default language: English
- Initial distribution: all Chrome Web Store regions where the product is allowed
- UI locales already bundled: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Russian, German, French, Spanish, Brazilian Portuguese, and Arabic
- Store listing localization: English is source-ready; copy-ready drafts for the other 10 UI locales are tracked in `store/LOCALIZATION_STATUS.md` and must not be published before native or fluent review

Do not claim support for a named site unless current-version evidence exists. The named claim above (YouTube and Bilibili, no clicks) is backed by `node tools/e2e_auto_mode.js --url <page>`; re-run it before each release and use the broader claim "ordinary web audio" if it fails.

Developer registration and account-owner requirements remain documented in `store/ACCOUNT_SETUP.md` for future publisher maintenance.

## Submission notes

- Remote code: No
- Paid product: No
- In-app purchases: No
- Advertising: No
- Extension analytics or background telemetry: No
- Chrome Web Store listing analytics: Google-managed GA4 enabled; no analytics code is bundled in the extension
- Support reports: Generated locally and submitted only when the user chooses
- Parallel beta listing: If a beta and stable listing coexist, label the beta name and description clearly as `BETA` or `DEVELOPMENT BUILD`.
