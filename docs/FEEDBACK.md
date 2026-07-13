# Feedback and quality improvement

LoudEase currently has no developer-operated telemetry service. Feedback is voluntary, user-initiated, and separated from audio processing.

## Current private beta

The private beta uses three channels:

1. Chrome Web Store reviews for public ratings and short product impressions after a store listing exists.
2. The Chrome Web Store Support Hub for questions, bug reports, and feature requests after support is enabled in the publisher dashboard.
3. GitHub Issue Forms for reproducible engineering reports from invited testers and, later, public contributors.

The extension can create a redacted support report in **Settings -> Support & diagnostics**. Copying or downloading that report is an explicit local action. The extension does not submit it automatically.

Do not put private URLs, account information, tokens, browsing history, personal recordings, or unlicensed media in a store review or public GitHub issue. Security vulnerabilities belong in a private GitHub Security Advisory.

## What each channel is for

| Channel | Good for | Not suitable for |
|---|---|---|
| Store review | Overall satisfaction and discoverability | Debug logs, private details, or back-and-forth support |
| Store Support Hub | User questions and ordinary support; Chrome supplies extension, browser, and OS versions | Automatic DSP measurements or audio samples |
| GitHub Issue Form | Reproducible bugs, compatibility reports, and feature proposals | Sensitive browsing data or copyrighted recordings |
| Voluntary private submission | A specific sample the user has the right to share | Background collection or general telemetry consent |

## Future opt-in quality measurement

Automatic quality measurement is not implemented. It must not be added until a backend, threat model, retention policy, deletion design, store disclosure, and in-product consent flow have all been reviewed.

The safest initial schema is unlinkable, coarse, and operational:

- extension version, browser major version, and coarse operating-system family;
- capture result and enumerated failure code;
- bucketed startup latency and audio-context interruption count;
- bucketed gain, limiter activation, overshoot, and hard-clip statistics;
- an explicit quality rating selected by the user.

Automatic reports must not include a persistent installation identifier, IP address stored by the application, URL, hostname, page title, platform name, tab identifier, account identifier, raw PCM, recording, free-form page content, or a sequence that reconstructs browsing activity. A platform may be named only when the user deliberately selects it in a manual feedback form.

Consent must be off by default, separate from normal settings, written in plain language, versioned, and as easy to withdraw as it is to grant. Refusing or withdrawing must not reduce the extension's core functionality.

## European users

Do not assume that a random identifier or a stripped IP address makes telemetry anonymous. A persistent installation identifier, IP address, or event sequence that can single out a device may remain personal or pseudonymous data.

Before collecting from users in the EEA, the United Kingdom, or another regulated region, document the controller, legal basis, processors, hosting and transfer locations, retention, access controls, withdrawal route, and applicable data-subject rights. Configure infrastructure so application logs do not retain IP addresses or request bodies beyond the documented purpose. Processor agreements and any required cross-border safeguards must be reviewed before launch.

The first telemetry release requires a separate privacy and legal review. This document is an engineering boundary, not legal advice.

## Backend boundary

GitHub is a manual feedback tracker, not an anonymous telemetry endpoint. The extension must never contain a GitHub access token.

If aggregate quality measurement is introduced later, use a narrowly scoped HTTPS endpoint with server-side schema allowlisting, request limits, restricted access, short raw retention, documented processors, and auditable deletion or irreversible aggregation. The public client schema may be open source while collected records and private evaluation data remain access-controlled.
