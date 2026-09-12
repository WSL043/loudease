# Public beta status

Snapshot date: `2026-09-12`.

LoudEase `0.8.2` is published publicly in the Chrome Web Store. The public listing and Developer Dashboard both report version `0.8.2`, four weekly users, public distribution, and no ratings or support requests.

On `2026-09-12`, a listing-only revision added the third, one-click onboarding screenshot for all languages. It is waiting for Chrome Web Store review and is configured to publish automatically after approval. The extension package, summary, permissions, and runtime were not changed by this submission.

For the dashboard's `2026-08-12` through `2026-09-09` reporting window:

- installs: `25`;
- uninstalls: `0`;
- store-listing page views: `20`;
- Chrome Web Store impressions: `8`;
- weekly users: `4`;
- enabled versus disabled: all reported installations are enabled;
- region and language: Japan and Japanese account for all reported weekly users;
- operating system: Windows `52%`, other `48%`.

These are aggregate installation and listing metrics, not evidence that four people actively used the audio processor. Chrome Web Store documentation states that the Users report captures installations rather than extension activity. The maintainer confirmed that the all-Japan/Japanese users can be explained by the maintainer's own account and test environment. The project therefore has `0` confirmed independent external users at this snapshot; this is an evidence statement, not proof that nobody else ever installed it.

The item is free, publicly discoverable, and selected for all available Chrome Web Store regions. Low adoption is therefore not explained by a restricted distribution setting. The privacy form also matches the shipped local-processing model: no remote code, Website content and Web history disclosed for on-device processing, and no extension analytics or background telemetry.

The GitHub repository and `v0.8.2-beta.1` prerelease are public. The release targets the tested source commit `c13a0d42793f412d19bab7af79a2400017a57c1b` and contains the verified `574,617`-byte store ZIP with SHA-256 `6C212FAEAC5D428A878CCAEAA7BDAF611BFB999F60E8387CF90DCB9B351422F9`. Its asset download count was `0` immediately after publication, so it is not yet adoption evidence.

Chrome Web Store-managed GA4 listing analytics was enabled on `2026-09-12` to measure acquisition without adding code, identifiers, or telemetry to the extension. Store-page analytics and extension runtime telemetry are separate boundaries: the former is Google-managed aggregate listing measurement; the latter remains absent.

## Next measurement checkpoint

Before interpreting the beta as having organic users, record a later snapshot that shows at least one of the following:

- a region or language that cannot be explained by maintainer testing;
- a voluntary store rating, support request, or GitHub issue from an independent user;
- a stable increase in weekly installations after a separately attributable listing or outreach change.

Do not add hidden extension telemetry to answer this question. Store-managed aggregate metrics and explicit, user-initiated feedback remain the approved measurement paths.

## First discovery experiment

The first controlled acquisition change is the one-click onboarding screenshot submitted on `2026-09-12`. Start its matched 14-day post-change window when the dashboard reports that revision as published. Keep the runtime package, summary, product name, other screenshots, and outreach fixed during that window.

The next candidate is this English summary:

> Normalize Chrome tab volume: lift quiet dialogue, tame loud surprises, and keep audio processing on your device.

The candidate is `112` characters, includes the common task phrase "Chrome tab volume", states two concrete benefits, and keeps the local-processing distinction. The dashboard derives the summary from the packaged manifest, so testing this copy requires a future package/version update such as `0.8.3`; it is not a listing-only edit. Do not add keyword lists or change the title merely to repeat search terms.

For each experiment, record the submission and publication dates and compare one matched 14-day window before and after it. Use store impressions, listing-page views, installs, uninstalls, weekly users, ratings, support contacts, and store-managed GA4 acquisition dimensions. At this scale, treat the result as directional unless the change clearly exceeds maintainer/test traffic. Change only one acquisition variable per window.
