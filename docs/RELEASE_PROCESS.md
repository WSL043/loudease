# Release process

This process keeps the source tree, GitHub Release, extension package, and public claims aligned. It is intentionally manual at the irreversible steps.

## Prepare a candidate

1. Start from a clean `main` synchronized with `origin/main`.
2. Set the same version in `manifest.json` and `package.json`.
3. Move verified changes from `Unreleased` into a dated changelog section.
4. Update screenshots, compatibility statements, known limitations, permissions, privacy, and store copy when behavior changed.
5. Run:

```bash
npm ci
npm test
npm run test:slider
npm run test:release
npm run package:store
npm run audit
```

6. Load `dist/store` in a clean Chrome profile and perform the current release smoke test.

## Publish the stable release

1. Commit the reviewed release state and wait for CI on `main` to pass.
2. Create an annotated stable tag such as `v1.0.0` at that exact commit.
3. Create a non-draft, non-prerelease GitHub Release from the tag and attach the verified store package and checksum.
4. Download the artifact from GitHub, verify it again, and confirm the release is visible as the latest stable release.

Do not clean up Beta records before these checks succeed. A stable tag alone is not enough; the published stable GitHub Release must exist and must not be marked draft or prerelease.

## Clean the public release surface

Preview the cleanup:

```bash
npm run release:cleanup-beta -- --stable-tag v1.0.0
```

The command lists the matching GitHub Prerelease records and `vX.Y.Z-beta.N` tags. It does not change anything by default.

After verifying the list, execute the cleanup:

```bash
npm run release:cleanup-beta -- --stable-tag v1.0.0 --execute --confirm DELETE-BETA-RELEASES
```

Execution is allowed only after the tool verifies a published, non-prerelease stable release and its remote tag. It deletes matching GitHub Beta Release records, remote Beta tags, and matching local tags. The operation is rerunnable if a network failure interrupts it.

This cleanup intentionally does not rewrite commit history or remove GitHub Actions history. Existing recipients keep every license right they already received. Before the repository becomes public, consolidate Beta sections in `CHANGELOG.md` and remove private-beta language from the READMEs so the first public presentation is stable and understandable.

## Chrome Web Store submission

Submit only the verified `dist/loudease-store.zip`. The GitHub development build includes opt-in local diagnostics and is not the store artifact. Record the uploaded package checksum, store version, submission date, permission disclosure, and review result in the maintainer's private release notes.

If the store review requires a code or permission change, prepare a new candidate. Do not modify an already published Git tag or silently replace a release artifact.
