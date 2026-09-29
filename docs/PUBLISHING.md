# Publishing LoudEase

This workflow keeps development flexible without presenting obsolete private builds as public product history.

Current state (`2026-09-12`): the repository, GitHub prerelease `v0.8.2-beta.1`, and Chrome Web Store version `0.8.2` are public. The GitHub prerelease targets the published source commit and contains the verified store asset; its notes are in `docs/releases/0.8.2-beta.1.md`. A listing-only Chrome Web Store revision adding the third onboarding screenshot is waiting for review and will publish automatically after approval. The phase 1 and phase 2 steps below are retained as release-history policy.

## Phase 1: private preparation (historical)

This phase was used to keep the repository private while completing:

- Chrome Web Store developer registration and two-step verification;
- final store package, privacy fields, screenshots, support route, and test instructions;
- fluent review of every localized store listing selected for the initial launch; unreviewed drafts remain unpublished and do not block an English-only listing;
- current-version automated, runtime, endurance, and listening evidence;
- one explicit decision about stale private prereleases.

Historical private cleanup candidates at the time of launch:

| Release | Tag |
|---|---|
| LoudEase 0.7.0 Beta 1 | `v0.7.0-beta.1` |
| LoudEase 0.7.1 Beta 1 | `v0.7.1-beta.1` |
| LoudEase 0.7.1 Beta 2 | `v0.7.1-beta.2` |

These records were not intended to become the public launch history. Deleting any remaining release or tag is destructive and still requires the maintainer to approve the exact target first. Removing a GitHub record does not revoke the license granted with a copy that was already distributed.

## Phase 2: one public GitHub beta

When the public-beta gates pass:

1. Remove only the approved stale private release objects and matching tags.
2. Make the repository public and recheck every public URL, issue form, badge, license notice, and asset.
3. Create one new prerelease from a reviewed `main` commit.
4. Use a SemVer-compatible manifest version such as `0.8.0`; use a prerelease tag such as `v0.8.0-beta.1` for GitHub.
5. Run `npm run package:store`, attach the resulting `dist/loudease-store.zip` and its SHA-256 checksum, identify the source commit, and mark the GitHub release as **Pre-release**.
6. State the tested platforms, known limitations, privacy boundary, installation steps, and feedback route without claiming universal compatibility.

The Chrome Web Store product name remains **LoudEase** across release channels. Before `1.0.0`, the listing description must clearly disclose that the release is a public beta and must not imply that the stable-release evidence gates have passed.

For a store beta, upload the exact same verified ZIP, complete the listing/privacy/distribution/test fields, and submit it for review only after the public privacy and support URLs plus the developer-account requirements are confirmed. Store review readiness does not promote the product to `1.0.0`.

The beta ZIP is the same stripped package intended for Chrome Web Store submission. Never attach `dist/github-dev` or an ad hoc archive of it; that tree contains contributor-only localhost diagnostics.

Public beta releases are durable history. Do not delete them merely to make the stable page look cleaner.

## Phase 3: stable GitHub and Chrome Web Store

After beta blockers are resolved and the gates in `docs/VERSIONING.md` and `docs/RELEASE_READINESS_REVIEW.md` pass:

1. Update the manifest/package version to `1.0.0` in one reviewed commit.
2. Run the complete release suite and produce one stripped `dist/loudease-store.zip` from that commit.
3. Create the stable GitHub release, attach that ZIP and its checksum, and mark it as **Latest**.
4. Upload the exact same ZIP to the Chrome Web Store, complete listing/privacy/distribution/test fields, and submit for review.
5. Use deferred publishing when launch timing matters; otherwise publish after approval.
6. Verify the public store listing, support route, privacy URL, package version, and update path after publication.

The public beta remains visible below the stable release. This is normal project history, not clutter.

## Maintainer actions that require explicit authorization

- paying the Chrome Web Store registration fee;
- accepting developer agreements or policy terms;
- enabling or changing account security;
- deleting remote releases or tags;
- making the repository public;
- submitting or publishing a store item;
- changing the official version, release channel, or product identity.

Automation may prepare files and verify packages. It may perform an account or publication action only after WSL043 explicitly authorizes the relevant public operation and the exact target has been verified.

## Automated upload (Chrome Web Store API v2)

`tools/publish_store.js` uploads the verified ZIP and submits it for review. The API covers only the package and submission; listing text, category, screenshots and privacy answers stay in the Developer Dashboard.

One-time setup (about 10 minutes, done by the account owner; never share or commit these values):

1. Google Cloud Console: create or pick a project and enable **Chrome Web Store API**.
2. OAuth consent screen: user type **External**, fill the required app fields, add the publisher account as a test user.
3. Credentials: create an OAuth client of type **Web application** with the redirect URI `https://developers.google.com/oauthplayground`. Note the client ID and secret.
4. Open the [OAuth Playground](https://developers.google.com/oauthplayground), click the gear, tick **Use your own OAuth credentials**, paste the client ID and secret, authorize the scope `https://www.googleapis.com/auth/chromewebstore` with the publisher account, then **Exchange authorization code for tokens** and copy the **refresh token**.
5. Developer Dashboard, **Publisher > Settings**: copy the **publisher ID**.

Then, per release, after `npm run package:store`:

```bash
export CWS_CLIENT_ID=... CWS_CLIENT_SECRET=... CWS_REFRESH_TOKEN=... CWS_PUBLISHER_ID=...
node tools/publish_store.js upload      # uploads dist/loudease-store.zip
node tools/publish_store.js status      # wait for a successful upload state
node tools/publish_store.js publish     # submit for review (add --staged to publish manually after approval)
```

Upload and publish are public operations: run them only for the exact ZIP attached to the matching GitHub release.
