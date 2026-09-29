// Local-only real-site navigation evidence. No audio or browsing data is uploaded.
const fs = require('fs');

module.exports = async function switchHold(options, api) {
  const { popupCdp, pageCdp, targetPrefix, pageUrl, initialStatus } = options;
  const { evaluateValue, readPopupCaptureStatus, readExternalMediaState, prepareExternalMedia, sleep, reportPath } = api;
  const started = Date.now();
  const samples = [];
  const transitions = [];
  const failures = [];
  const visited = new Set([pageUrl]);
  const pool = new Set();
  let latestStatus = initialStatus;
  let pending = null;
  let segment = 0;
  let lastSwitch = -Infinity;
  const evidence = { passed: false, mode: 'same-tab-full-navigation', requestedDurationMs: 180000, samples, transitions, failures };
  const save = () => fs.writeFileSync(reportPath, `${JSON.stringify({ ...evidence, durationMs: Date.now() - started }, null, 2)}\n`);
  const discover = async () => {
    const links = await evaluateValue(pageCdp, `Array.from(document.querySelectorAll('a[href]')).map(a => a.href)`);
    for (const raw of links || []) {
      try {
        const url = new URL(raw);
        if (url.origin !== new URL(pageUrl).origin) continue;
        let canonical = '';
        if (url.hostname.endsWith('youtube.com') && url.pathname === '/watch' && url.searchParams.get('v')) canonical = `${url.origin}/watch?v=${url.searchParams.get('v')}`;
        if (url.hostname.endsWith('bilibili.com') && /^\/video\/BV\w+/.test(url.pathname)) canonical = `${url.origin}${url.pathname.match(/^\/video\/BV\w+/)[0]}/`;
        if (url.hostname.endsWith('douyin.com') && /^\/video\/\d+/.test(url.pathname)) canonical = `${url.origin}${url.pathname.match(/^\/video\/\d+/)[0]}`;
        if (canonical) pool.add(canonical);
      } catch (_) { /* Ignore unrelated/invalid page links. */ }
    }
  };
  await discover();
  const initialMedia = await readExternalMediaState(pageCdp);
  evidence.initialMedia = initialMedia;
  if (initialMedia?.url) visited.add(initialMedia.url);
  try {
    while (Date.now() - started < 180000) {
      const elapsed = Date.now() - started;
      if (segment < 2 && elapsed >= (segment + 1) * 60000) {
        await discover();
        const next = [...pool].find(url => !visited.has(url) && url.replace(/\/$/, '') !== pageUrl.replace(/\/$/, ''));
        if (!next) throw new Error('No distinct public video link available; cannot claim a three-video pass');
        visited.add(next);
        segment += 1;
        lastSwitch = Date.now();
        const transition = { segment, atMs: lastSwitch - started, url: next, before: latestStatus };
        transitions.push(transition);
        console.log(`[switch] segment=${segment + 1} atMs=${transition.atMs} ${next}`);
        await pageCdp.command('Page.navigate', { url: next });
        pending = prepareExternalMedia(pageCdp, 30000).then(result => {
          transition.playback = result;
          transition.playbackReadyMs = Date.now() - lastSwitch;
          if (!(result?.playingCount > 0)) failures.push({ segment, reason: 'new-video-not-playing', result });
        }).catch(error => { failures.push({ segment, reason: String(error) }); });
      }
      latestStatus = await readPopupCaptureStatus(popupCdp, targetPrefix, pageUrl);
      const media = await readExternalMediaState(pageCdp);
      const sample = { atMs: Date.now() - started, segment, status: latestStatus, media };
      samples.push(sample);
      if (!latestStatus?.captureActive || latestStatus.captureContextState !== 'running' || latestStatus.silentSink !== true || Number(latestStatus.meterFrameAgeMs ?? Infinity) >= 1000) failures.push({ atMs: sample.atMs, reason: 'capture-not-live' });
      if (Number(latestStatus.workletHardClippedSamples || 0) > 0 || Number(latestStatus.workletMaxHardClipOvershoot || 0) > 1e-9) failures.push({ atMs: sample.atMs, reason: 'hard-clipping' });
      if (Date.now() - lastSwitch > 15000 && Number(latestStatus.lastSignalAgeMs ?? Infinity) > 10000) failures.push({ atMs: sample.atMs, reason: 'no-fresh-input-outside-navigation-grace' });
      save();
      await sleep(Math.min(Date.now() - lastSwitch < 10000 ? 250 : 1000, Math.max(1, 180000 - (Date.now() - started))));
    }
    if (pending) await pending;
    evidence.passed = transitions.length === 2 && failures.length === 0;
    evidence.durationMs = Date.now() - started;
    save();
    if (!evidence.passed) throw new Error(`Real-site switching failed: ${failures.length} observations; see ${reportPath}`);
    return { hold: evidence, latestStatus };
  } catch (error) {
    evidence.error = String(error?.message || error);
    save();
    throw error;
  }
};
