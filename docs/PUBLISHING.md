# Publishing LoudEase

This workflow keeps development flexible without presenting obsolete private builds as public product history.

## Phase 1: private preparation

Keep the repository private while completing:

- Chrome Web Store developer registration and two-step verification;
- final store package, privacy fields, screenshots, support route, and test instructions;
- fluent review of every localized store listing selected for the initial launch; unreviewed drafts remain unpublished and do not block an English-only listing;
- current-version automated, runtime, endurance, and listening evidence;
- one explicit decision about stale private prereleases.

Current private cleanup candidates:

| Release | Tag |
|---|---|
| LoudEase 0.7.0 Beta 1 | `v0.7.0-beta.1` |
| LoudEase 0.7.1 Beta 1 | `v0.7.1-beta.1` |
| LoudEase 0.7.1 Beta 2 | `v0.7.1-beta.2` |

These records must not be made public as the launch history. Deleting a release or tag is destructive and requires the maintainer to approve this exact list first. Removing a GitHub record does not revoke the license granted with a copy that was already distributed.

## Phase 2: one public GitHub beta

When the public-beta gates pass:

1. Remove only the approved stale private release objects and matching tags.
2. Make the repository public and recheck every public URL, issue form, badge, license notice, and asset.
3. Create one new prerelease from a reviewed `main` commit.
4. Use a SemVer-compatible manifest version such as `0.8.0`; use a prerelease tag such as `v0.8.0-beta.1` for GitHub.
5. Run `npm run package:store`, attach the resulting `dist/loudease-store.zip` and its SHA-256 checksum, identify the source commit, and mark the GitHub release as **Pre-release**.
6. State the tested platforms, known limitations, privacy boundary, installation steps, and feedback route without claiming universal compatibility.

The first Chrome Web Store submission may use this same public-beta build when real-user compatibility and listening feedback are needed before `1.0.0`. Its name and description must clearly say `BETA`, and the listing must not imply that the stable-release evidence gates have passed.

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

## Maintainer actions that are never automated

- paying the Chrome Web Store registration fee;
- accepting developer agreements or policy terms;
- enabling or changing account security;
- deleting remote releases or tags;
- making the repository public;
- submitting or publishing a store item;
- changing the official version, release channel, or product identity.

Automation may prepare files and verify packages, but WSL043 performs these account and publication actions.
