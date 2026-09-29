# Personal Chrome measurement workflow

This is a local, unpublished test workflow. Browser connection and 64.524 seconds
of four-session diagnostics were verified on 2026-09-22. That first record contains
control gains and continuity only, not comparable input/output loudness. Preserve
`tmp/personal-chrome-connection-20260922-185310.jsonl` as the original evidence.

## Instrumented developer copy

`node tools/stage_personal_quality.js` applies the existing `real_quality_meter`
observer only to `dist/github-dev`. Source runtime files are unchanged. The script
rejects unexpected developer-file edits before writing, preserves permissions and
capture authorization, and records input/output hashes in
`tmp/personal-quality-stage.json`. Do not rebuild this directory during a live run.

The observer uses matching internal K-weighted channel-mean energy on actual input
and rendered worklet output, with 400 ms and 3 s windows reported every 100 ms.
The meter is not certified LUFS. Its output tap precedes downstream mute/startup
gates. PCM parity at 44.1/48/96 kHz and bypass equality are tested by
`node tools/real_quality_meter_tests.js`.

Rows contain numeric meters, a random capture-session ID, tab ID, sequence and
timestamps. No PCM, titles, URLs, account IDs or browser history are forwarded.
Ordinary diagnostics are restricted to the four test-site hosts and scalar
technical fields. The existing opt-in local-diagnostics setting gates forwarding.
Only messages from this extension's offscreen document are accepted. No extension
UI is accessed through this path, and it cannot start capture or change settings.

## Receiver and completeness

Run `python -u tools/personal_quality_receiver.py --tab-ids ID1 ID2 ID3` on `127.0.0.1:18765` after
stopping the old receiver. It writes append-only `quality.jsonl` and `status.jsonl`
under a timestamped ignored directory, plus a sanitized latest-status file. The
old diagnostic artifacts remain untouched. The receiver rejects malformed meter
arrays, non-finite values and oversized batches. Do not upload the local records.

Transport batches contain ten records. Pending-send backpressure or failures are
counted explicitly, not silently treated as valid coverage. Up to nine final rows
can remain buffered when capture stops; there is no final-delivery guarantee.
Use `node tools/personal_quality_integrity.js` to detect sequence gaps, duplicate
or reordered records, reported loss, session boundaries and audio-clock gaps.
Its nominal duration is not eligible programme duration. A partial final line or
invalid record is an error, not something the reader silently discards.

As of 2026-09-23, exact test-tab IDs from the official browser listing are
required. The receiver discards quality rows and status tabs outside that set;
`scope.json` records the permitted IDs. Earlier collection scoped ordinary status
by hostname but omitted the corresponding quality-row restriction. A later
out-of-scope numeric batch exposed that gap; it is not part of any quality score.
Do not reuse a prior run's IDs after tab replacement.

The user must reload the developer extension manually and explicitly restart
capture on each test tab. The official browser tool blocks extension pages. Never
use an alternative browser surface or raw protocol to bypass that block.

## Remaining real-site qualification

Select three actual videos on each platform using observed page controls in the
official Chrome tool. Aim for two minutes after confirmed new-media readiness per
video, and require at least one minute of eligible data. Record canonical public
video URL/title separately through the authorized browser workflow, paired with
timestamped visible media observations, errors, pause/mute/volume and transitions.
Do not mistake an SPA URL change for a new playing video or count paused windows.

Analyze both meters with the same reliable player-volume compensation. Exclude
initial/reset/volume-change warmup, unknown volume, mute, pause and near-silence.
Retain transport gaps and all failed attempts. Report quiet/loud energy groups,
gain and limiting, experimental -19 +/-2 dB occupancy, and transition observations.
Source readiness and first in-band intervals are not permanent loudness settling.
Zero hard clips do not establish true-peak compliance. Listening and native-output
restoration require separate evidence. The offline limiter candidate is not shipped.

Preparation checks: `node tools/personal_quality_tests.js`,
`python tools/personal_quality_receiver_tests.py`,
`node tools/personal_quality_integrity_tests.js`, and existing PCM-meter tests.
The measured results and remaining acceptance gaps are recorded separately in
[PERSONAL_CHROME_RESULTS_20260922.md](PERSONAL_CHROME_RESULTS_20260922.md).

## Personal-page volume verification

The high-level page snapshot omitted `HTMLMediaElement.volume`, and YouTube's
initial extension metadata reported unknown volume. A visible 100% slider is not
sufficient: ads had different actual media volume. Those original windows remain
excluded. Supplementary observations use the official browser client's tab-scoped
CDP capability, read-only `Runtime.evaluate` on the already authorized HTTPS video
page, to read only media state and volume. This does not access extension pages or
bypass their policy block. Matching volume at both advancing page observations
can supply the normalization factor when extension metadata is missing. Conflicts
with known extension volume are excluded. Full navigation subsequently restored
known YouTube metadata; this does not establish a repaired root cause.

`node tools/analyze_personal_quality.js` produces `analysis.json` in the current
run directory. It rejects observation gaps above 15 seconds, paused/hidden media,
ads observed in this run (all under 120 seconds), stale/non-running capture status,
closed startup gates, volume conflicts, warmup, transport gaps and near-silence.
The 120-second duration filter is specific to the first run's known long videos;
it is not a general ad detector. The candidate run encountered a 130.821-second
ad and therefore requires matching each page's confirmed `expectedDuration`.
Candidate metadata also requires the observer's numeric source fingerprint.
For the unreleased dynamic-policy retest, `run-metadata.json` must additionally
specify `dynamicsAmount: 0.92`; the analyzer rejects rows whose effective loaded
policy is missing or differs. The observer reports this scalar from the running
worklet's loaded policy, and the receiver keeps only numeric diagnostic fields.
Page observations are normally 10 seconds apart, so short
events between observations may remain unseen. Instrumented meters precede output
gates, and status sampling does not prove physical speaker output or listening.

The receiver now requests an exclusive Windows port. During this run the old
receiver process survived its terminal interruption, delaying initial delivery;
the exact old process was identified and stopped before scored windows. Both
initial reported loss and a later ten-row Douyin transport gap are retained.
