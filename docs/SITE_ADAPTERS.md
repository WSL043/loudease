# Site compatibility

LoudEase does not use per-site PCM adapters. The main audio stream comes from `tabCapture`, so HTML media replacement and page Web Audio do not require a new processing graph.

## Generic bridge

`content/bridge.js` provides site-independent hints:

- media count and playback state;
- player mute and volume;
- conflicting simultaneous media state;
- frame and navigation freshness.

These hints enforce player intent and improve status. They do not carry audio samples.

## Release baseline

The public beta must keep current-version evidence for:

- YouTube video;
- YouTube live;
- Bilibili video;
- Bilibili live;
- Douyin video;
- Douyin live.

These rows are the initial regression baseline, not the complete global product scope.

## Global compatibility expansion

The generic capture architecture should be validated by playback technology, not by adding brand-specific PCM code. The next representative groups are:

- global video and live: YouTube Music, Twitch, TikTok, Vimeo, Dailymotion, Kick, Facebook Video, and Instagram Reels;
- web music: Spotify Web Player, Apple Music, SoundCloud, Deezer, and TIDAL;
- protected streaming: at least one current-version run from Netflix, Prime Video, or Disney+ before making any protected-streaming claim;
- Japan: Niconico and ABEMA;
- Korea: CHZZK and SOOP;
- Russian-language services: VK Video, Rutube, and Yandex Music;
- Europe: representative regional broadcasters such as BBC iPlayer, ARD/ZDF, or France.tv when accounts and geography permit;
- other major regions: JioHotstar, Shahid, and Globoplay when accounts and geography permit.

Extended rows are evidence targets, not promises that every service is already supported. Account, subscription, DRM, and regional restrictions must be recorded as test constraints rather than bypassed.

Each tested scenario must record Chrome version, extension version, capture state, worklet mode, signal freshness, input/output level, current gain, limiter overshoot, hard-clipped samples, source switches, mute, player volume, and run duration.

## When a site-specific adapter is justified

Add site-specific logic only when all of the following are true:

1. a current-version real-site reproduction proves the generic bridge is insufficient;
2. the missing state materially affects mute, player-volume safety, or capture recovery;
3. the logic can be narrowly scoped and tested without reading unrelated page data;
4. the host permission already exists for the single audio-balancing purpose;
5. the adapter has an owner and regression scenario.

Do not add selectors merely to display the site's brand, scrape metadata, or claim compatibility without processing evidence.
