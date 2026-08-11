# First-principles audit

## User job

Prevent a web tab from alternating between unexpectedly loud and inaudibly quiet material while preserving useful dynamics and the user's existing volume intent.

## Non-negotiable facts

1. The extension does not know acoustic loudness at the listener's ear.
2. Chrome normally requires a user invocation before a new tab can be captured. A browser process started with Chromium's exact-ID allowlist can grant the trusted GitHub build an explicit exception; the store runtime cannot depend on it.
3. A web page may replace media elements, use live streams, iframes, or Web Audio.
4. Low RMS does not prove that aggressive amplification is safe.
5. An enabled preference does not prove that PCM is being processed.
6. Client-side extension code is inspectable after distribution.

## Architectural consequences

- Process the mixed tab stream, not individual media elements.
- Keep one owner for audio lifecycle: the offscreen capture session.
- Run time-critical DSP on the AudioWorklet render thread.
- Separate slow loudness consistency from fast peak safety.
- Treat upward gain as conditional and downward protection as the safer default.
- Use fresh signal evidence for product status.
- Keep release and diagnostics builds structurally separate.

## Failure containment

| Failure | Required behavior |
|---|---|
| Worklet cannot load | Report fallback mode and use conservative fallback processing |
| Player volume is unknown/conflicting | Disable upward lift unless the narrow audible fallback is safe |
| Player is muted or volume is zero | Output zero |
| Captured stream ends | Stop and clean the session |
| Store tab has no authorization | Ask for one user invocation; do not claim automatic coverage |
| GitHub Chrome process lacks the exact-ID startup allowlist | Record one truthful denial, stop automatic retries, and keep manual capture available |
| Telemetry is stale | Show waiting/recovery, not active processing |
| Development diagnostics are not enabled | Send nothing to localhost |

## Technical value

The runtime has meaningful engineering depth: full-tab MV3 lifecycle, unified worklet DSP, bounded upward gain, look-ahead limiting, truthful state, multi-tab ownership, and release hygiene. The underlying methods are established and reproducible; they are not an uncopyable scientific secret.

The durable advantage is therefore expected to come from:

- tuning and listening evidence;
- licensed evaluation material and regression fixtures;
- real-site compatibility history;
- low-regression releases and transparent privacy;
- brand, distribution, support, and contributor trust.

## Decision

Open-source the runtime and public tests. Keep private any licensed listening corpus, unreleasable recordings, proprietary calibration datasets, commercial product telemetry, and future product-specific tuning layers. Do not split a DSP library until a second real consumer requires a stable API.
