# Extension builds

The repository has two deterministic, allowlist-based targets:

- `npm run build:dev` writes `dist/github-dev` and retains developer diagnostics.
- `npm run build:store` writes and verifies the stripped `dist/store` directory.
- `npm run package:store` also writes `dist/loudease-store.zip` with sorted paths, stored entries, and a fixed timestamp.
- `npm run test:release` rebuilds and verifies the store target.

Only `manifest.json`, `background.js`, and runtime files below `assets`, `content`, `monitor`, `offscreen`, `popup`, `shared`, and `_locales` are eligible. Tests, temporary output, tools, documentation, source-only files, logs, archives, keys, secrets, and Git metadata are never copied.

## Development diagnostics marker contract

Store removal is explicit. The build does not infer diagnostics code from names or arbitrary regular expressions.

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

## Main integration checklist

1. In `background.js`, mark all declarations, state, preference loading, option handling, local fetch/timer code, and message branches used only by local diagnostics. Keep general in-extension diagnostics outside the blocks if the store UI still uses them.
2. In `monitor/index.html`, mark the complete local diagnostics control and explanatory text.
3. In `monitor/index.js`, mark local-only element bindings, option state, toggle implementation, event listener, and messages that depend on the removed control. Every block must be independently removable.
4. Keep `http://127.0.0.1/*` in the development manifest and list it only in `tools/build-config.json` for store removal. The manifest remains valid Chrome metadata without custom build keys.
5. Run `npm run test:release`, then load `dist/store` as an unpacked extension for a smoke test.
