# Public launch checklist

LoudEase stays private until the stable candidate, public repository, and Chrome Web Store claims all match verified evidence. This checklist prepares a clean public presentation without rewriting Git history.

## Stable candidate while private

1. Freeze a reviewed commit on `main` and update `manifest.json`, `package.json`, and `CHANGELOG.md` to the same stable version.
2. Remove private-beta wording from the two READMEs and consolidate Beta changelog entries into the stable release notes.
3. Run the complete verification and build sequence in [Release process](RELEASE_PROCESS.md).
4. Create and verify the stable GitHub Release while the repository is still private.
5. Preview the Beta cleanup. Execute it only after the stable release and its artifacts have been verified.
6. Confirm the Releases page exposes only the stable release and no Beta tags remain.

The cleanup removes GitHub Prerelease records and their Beta tags. It does not rewrite commits, erase CI history, revoke licenses already received, or pretend private development did not happen. Preserving commit provenance is safer for contributors and future maintenance.

## Repository opening

Immediately before changing visibility:

- run an all-history secret scan and confirm no private samples, URLs, logs, archives, keys, or credentials are tracked;
- verify the license, notices, trademark boundary, DCO, governance, support, security, privacy, and contribution documents;
- verify current light/dark screenshots and English/Chinese READMEs against the release build;
- set the repository description, topics, social preview, support route, and security contact;
- keep Issues enabled and enable Discussions only when a maintainer is ready to moderate them.

Immediately after making the repository public:

- enable branch protection or a ruleset for `main` with required CI, blocked force pushes, and CODEOWNERS review where the GitHub plan supports it;
- confirm GitHub Actions, Issue Forms, Security Advisories, links, badges, and release downloads work for a signed-out visitor;
- create a small, evidence-backed set of starter issues instead of publishing an unbounded roadmap;
- do not advertise platforms outside the verified test matrix.

## Chrome Web Store

The store package is a separate release surface. Complete the permission justification, privacy fields, support URL, localized listing copy, current screenshots, promotional tile, and store-package verification before submission. A public GitHub release does not by itself make the store build ready.

The canonical readiness decision remains [Release readiness review](RELEASE_READINESS_REVIEW.md).
