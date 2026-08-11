# Extension builds

The repository has two deterministic, allowlist-based targets:

- `npm run build:dev` writes `dist/github-dev` and retains developer diagnostics plus the trusted allowlisted auto-protection path.
- `npm run build:store` writes and verifies the stripped `dist/store` directory.
- `npm run package:store` also writes `dist/loudease-store.zip` with sorted paths, stored entries, and a fixed timestamp.
- `npm run test:release` rebuilds and verifies the store target.

`dist/loudease-store.zip` is the only installable release archive. Attach that exact verified file to GitHub Releases and submit the same file to the Chrome Web Store. Never publish `dist/github-dev` or an ad hoc archive of it; the development tree intentionally retains localhost diagnostics.

Only `manifest.json`, `background.js`, the release notices (`LICENSE`, `NOTICE`, `TRADEMARKS.md`), and runtime files below `assets`, `content`, `monitor`, `offscreen`, `popup`, `shared`, and `_locales` are eligible. Tests, temporary output, tools, other documentation, source-only files, logs, archives, keys, secrets, and Git metadata are never copied.

## Development-only marker contract

Store removal is explicit. The build does not infer development-only code from names or arbitrary regular expressions. The existing marker name is retained for compatibility, but it now encloses both contributor diagnostics and the GitHub-only automatic-capture orchestration.

Wrap every complete development-only JavaScript or CSS block with comments on their own lines:

```js
/* WVB_DEV_DIAGNOSTICS_START */
// Complete declarations, handlers, calls, or timers removable as one unit.
/* WVB_DEV_DIAGNOSTICS_END */
```

Use equivalent HTML comments around complete DOM fragments:

```html
<!-- WVB_DEV_DIAGNOSTICS_START -->
<!-- Complete local-diagnostics UI fragment. -->
<!-- WVB_DEV_DIAGNOSTICS_END -->
```

Markers must be balanced and cannot overlap. Each block must remain syntactically removable, including its commas and surrounding control flow.

JSON has no comments, so the explicit removal contract lives outside the runtime manifest in `tools/build-config.json`:

```json
{
  "markers": { "start": "WVB_DEV_DIAGNOSTICS_START", "end": "WVB_DEV_DIAGNOSTICS_END" },
  "host_permissions": ["http://127.0.0.1/*"],
  "assets": [],
  "locale_message_keys": ["localDiagnosticsLabel", "localDiagnosticsHelp", "diagnosticsOn", "diagnosticsOff"]
}
```

The store builder verifies and removes those exact host permissions, removes exact allowlisted paths named in `assets`, and deletes the contract property. The store build fails if the contract is absent, a marker is unbalanced, a listed permission is absent, or any localhost string survives.

The development build also contains a test-only silent-output switch used by isolated Chrome E2E. It routes the offscreen `AudioContext` to `{ type: 'none' }` while keeping the DSP graph live. Every declaration, message field, status field, and storage key for this switch must stay inside the same development markers. The store verifier rejects `e2eSilentSink`, `E2E_SILENT_SINK`, and its storage key if any survive packaging.

The GitHub build's automatic-capture code must also remain inside complete removable marker blocks. It may call the existing `startTabCapture()` path only; it must not introduce a second PCM graph. `tools/assert_github_auto_capture.js` builds the store target and rejects any surviving automatic-capture symbol or startup-allowlist instruction.

## Main integration checklist

1. In `background.js`, mark all declarations, state, preference loading, option handling, local fetch/timer code, and message branches used only by local diagnostics. Keep general in-extension diagnostics outside the blocks if the store UI still uses them.
2. In `monitor/index.html`, mark the complete local diagnostics control and explanatory text.
3. In `monitor/index.js`, mark local-only element bindings, option state, toggle implementation, event listener, and messages that depend on the removed control. Every block must be independently removable.
4. Keep `http://127.0.0.1/*` in the development manifest and list it only in `tools/build-config.json` for store removal. The manifest remains valid Chrome metadata without custom build keys.
5. Run `npm run test:release`, then load `dist/store` as an unpacked extension for a smoke test.
