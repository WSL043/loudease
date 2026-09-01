# Chrome Web Store submission checklist

Use this checklist with the Chrome Web Store Developer Dashboard for the `0.8.2` public beta. Dashboard wording can change; when it does, preserve the intent recorded here instead of guessing at a different disclosure.

## Account

- [ ] Developer registration is complete and the agreement is accepted.
- [ ] Publisher name is set deliberately.
- [ ] Developer contact email is verified.
- [ ] Google two-step verification is enabled.

## Package

- [ ] Upload the final `dist/loudease-store.zip` produced by `npm run package:store`.
- [ ] Confirm manifest version `0.8.2`, Manifest V3, and 44 verified runtime files.
- [ ] Record the final SHA-256 checksum and source commit.
- [ ] Confirm the package contains no localhost diagnostics, remote executable code, telemetry, credentials, development markers, tests, tools, or source-only files.

## Store listing

- [ ] Use only the English default listing for the first submission; do not publish unreviewed locale drafts.
- [ ] Copy the name, summary, single purpose, category, and description from `store/STORE_LISTING.md`.
- [ ] Upload the 1280 x 800 screenshots and 440 x 280 small promotional tile from `store/assets/`.
- [ ] Use the public homepage, support, and privacy-policy URLs listed in `store/STORE_LISTING.md` only after checking them in a signed-out browser.

## Privacy practices

- [ ] Copy every permission justification from `store/PRIVACY_PRACTICES.md`.
- [ ] Declare remote code: **No**.
- [ ] Disclose **Website content** and **Web history** as locally handled data.
- [ ] Do not select unrelated data categories.
- [ ] Complete every Limited Use certification consistently with `PRIVACY.md`.
- [ ] Reconfirm that required HTTP(S) host access is used only for arbitrary web-audio tabs, per-site rules, media mute/player-volume state, and authorized-session recovery after navigation.

## Distribution and review

- [ ] Free item; no purchases, subscriptions, advertising, or analytics.
- [ ] Public visibility in all eligible Chrome Web Store regions.
- [ ] Paste `store/TEST_INSTRUCTIONS.md`; no reviewer credentials are required.
- [ ] Resolve every dashboard warning before submission or record why it is non-blocking.
- [ ] Submit for review only after the maintainer reviews the final dashboard summary.
- [ ] After approval or publication, verify the public listing, privacy URL, support route, version, install flow, and update path.
