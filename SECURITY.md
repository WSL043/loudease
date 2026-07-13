# Security Policy

## Supported versions

Before the first stable release, only the latest public beta is supported. Older unpacked development builds do not receive security backports.

## Reporting a vulnerability

Please use a private GitHub Security Advisory. Include:

- affected version and file;
- minimal reproduction or proof of concept;
- concrete impact on browsing data, audio, permissions, extension state, or local resources;
- whether the issue exists in the GitHub development build, stripped store build, or both.

Do not include private URLs, browsing history, account identifiers, tokens, Chrome profiles, personal recordings, or unredacted diagnostics in a public issue.

## Security boundaries

- Page content, media metadata, URLs, and titles are untrusted input.
- Web pages cannot directly authorize `tabCapture`.
- Page-provided runtime globals do not control extension reload or trust decisions.
- The store build must not contain localhost diagnostics code or permission.
- No remote JavaScript, Wasm, dynamic `eval`, or downloaded executable code is allowed.
- Audio processing remains local.
- Permission expansion requires a documented feature, privacy review, tests, and maintainer approval.

## Disclosure process

We will acknowledge a valid report, reproduce it, assess affected builds, prepare a fix and regression test, and coordinate disclosure. Timing depends on severity and Chrome Web Store review requirements.
