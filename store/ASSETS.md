# Store Asset Inventory

The generated files in `store/assets/` are submission assets, not extension runtime files.

## Required

| Asset | Size | File |
| --- | ---: | --- |
| Store icon | 128 x 128 PNG | `assets/icon-128.png` |
| Product screenshot: balancing | 1280 x 800 PNG | `store/assets/screenshot-balancing-1280x800.png` |
| Product screenshot: settings | 1280 x 800 PNG | `store/assets/screenshot-settings-1280x800.png` |
| Product screenshot: one-click onboarding | 1280 x 800 PNG | `store/assets/screenshot-onboarding-1280x800.png` |
| Small promotional tile | 440 x 280 PNG | `store/assets/promo-small-440x280.png` |

## Rules

- Screenshots must show the current product UI, not a concept mockup from an older version.
- Do not add review badges, user counts, platform logos, medical claims, or unverified compatibility claims.
- Keep screenshot text minimal and readable at the uploaded size.
- Keep the promotional tile brand-led; it is not a miniature screenshot or a dense feature list.
- Regenerate and inspect every asset after a material UI or logo change.
- The optional 1400 x 560 marquee image is intentionally deferred until the listing has proven conversion data.

Current listing observation (`2026-09-12`): two screenshots and the small promotional tile are published; no promotional video or marquee image is configured. The third one-click onboarding screenshot was submitted as an all-language asset in a listing-only revision, is waiting for review, and is configured to publish automatically after approval. Its publication begins the first separately dated conversion experiment; do not change another acquisition variable during that matched window.

The source composition is `store/assets-source.html`. Run `npm run assets:store` to render current popup/settings previews and every derived asset at its declared viewport, then validate exact PNG dimensions with `tools/assert_publish_hygiene.js`.
