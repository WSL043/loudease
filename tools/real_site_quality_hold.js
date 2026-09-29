const fs = require('fs');
const { canonical, advancingNewVideo } = require('./real_site_transition');

module.exports = async function qualityHold(options, api) {
  const { popupCdp, pageCdp, offscreenCdp, targetPrefix, pageUrl, initialStatus } = options;
  const { evaluateValue, readPopupCaptureStatus, readExternalMediaState, sleep, reportPath } = api;
  const perVideoMs = Number(process.env.WVB_QUALITY_VIDEO_MS || 120000);
  if (!Number.isFinite(perVideoMs) || perVideoMs < 10000 || perVideoMs > 600000) throw new Error('Invalid video duration');
  const start = Date.now();
  const data = { schema: 1, mode: 'page-link-click-same-tab', generatedAt: new Date().toISOString(),
    perVideoMs, samples: [], measurements: [], transitions: [], failures: [], passed: false,
    measurement: 'same internal K-weighted channel-mean energy on input and actual output; not certified LUFS',
    targetDb: -19, toleranceDb: 2, initialUrl: pageUrl };
  data.browserUserAgent = await evaluateValue(pageCdp, 'navigator.userAgent');
  let status = initialStatus;
  let segment = 0;
  let segmentStart = Date.now();
  const visited = new Set();
  visited.add(canonical(pageUrl));
  const save = () => { data.durationMs = Date.now() - start; fs.writeFileSync(reportPath, `${JSON.stringify(data, null, 2)}\n`); };
  const playerDetails = () => evaluateValue(pageCdp, `(() => ({
    error: Array.from(document.querySelectorAll('.ytp-error-content-wrap, ytd-enforcement-message-view-model, .yt-playability-error-supported-renderers')).map(e => e.innerText).join(' ').slice(0,2000),
    autoplay: document.querySelector('.ytp-autonav-toggle-button')?.getAttribute('aria-checked'),
    pageVideoId: document.querySelector('#movie_player')?.getVideoData?.()?.video_id || null
  }))()`);
  const disableAutoplay = () => evaluateValue(pageCdp, `(() => {
    const toggle = document.querySelector('.ytp-autonav-toggle-button');
    if (toggle?.getAttribute('aria-checked') === 'true') { toggle.click(); return 'clicked-off'; }
    return toggle?.getAttribute('aria-checked') || 'not-present';
  })()`, { userGesture: true });
  const drain = async () => {
    const result = await evaluateValue(offscreenCdp, `({ rows: (globalThis.__qualityAudit || []).splice(0), dropped: globalThis.__qualityAuditDropped || 0 })`);
    for (const row of result.rows) data.measurements.push({ ...row, segment, atMs: row.receivedAt - start });
    data.droppedMeasurements = result.dropped;
    if (result.dropped) throw new Error('Measurement queue overflow');
  };
  const record = async () => {
    status = await readPopupCaptureStatus(popupCdp, targetPrefix, pageUrl);
    const media = await readExternalMediaState(pageCdp);
    const details = await playerDetails();
    data.samples.push({ atMs: Date.now() - start, segment, status, media, details });
    if (!status?.captureActive || status.captureContextState !== 'running' || status.silentSink !== true || Number(status.meterFrameAgeMs ?? Infinity) >= 1000) data.failures.push({ segment, atMs: Date.now() - start, reason: 'capture-not-live' });
    if (Number(status.workletHardClippedSamples || 0) > 0) data.failures.push({ segment, atMs: Date.now() - start, reason: 'hard-clipping' });
    if (Date.now() - segmentStart > 15000 && Number(status.lastSignalAgeMs ?? Infinity) > 10000) data.failures.push({ segment, atMs: Date.now() - start, reason: 'source-signal-stale', details });
    await drain();
    save();
    return media;
  };
  try {
    data.autoplayAction = await disableAutoplay();
    await drain();
    while (true) {
      const media = await record();
      if (Date.now() - segmentStart >= perVideoMs) {
        if (segment === 2) break;
        const links = await evaluateValue(pageCdp, `Array.from(document.querySelectorAll('a[href]')).filter(a => a.getBoundingClientRect().width > 0).map(a => ({href:a.href,text:(a.innerText || a.getAttribute('title') || '').slice(0,250)}))`);
        const link = links.find(a => { try { return new URL(a.href).origin === new URL(pageUrl).origin && canonical(a.href) && !visited.has(canonical(a.href)); } catch (_) { return false; } });
        if (!link) throw new Error('No distinct observed video link for manual switch');
        visited.add(canonical(link.href));
        const transition = { atMs: Date.now() - start, from: media, link, beforeStatus: status };
        data.transitions.push(transition);
        await drain();
        segment++;
        segmentStart = Date.now();
        console.log(`[quality] click video=${segment + 1} ${link.href}`);
        transition.clicked = await evaluateValue(pageCdp, `((href) => {
          const a = Array.from(document.querySelectorAll('a[href]')).find(a => a.href === href);
          if (!a) return false;
          a.target = '_self'; a.click(); return true;
        })(${JSON.stringify(link.href)})`, { userGesture: true });
        if (!transition.clicked) throw new Error('Observed link disappeared before click');
        // Do not repeatedly force play or turn all helper media audible.
        let ready = false;
        let previousPlayback = null;
        const switchStart = Date.now();
        while (Date.now() - switchStart < 30000) {
          await sleep(500);
          const next = await record();
          if (advancingNewVideo(media, previousPlayback, next, link.href)) {
            transition.playbackReadyMs = Date.now() - switchStart;
            transition.afterMedia = next;
            ready = true; break;
          }
          previousPlayback = next;
        }
        if (!ready) throw new Error('Clicked video did not start in 30 seconds; no forced-play recovery');
        transition.autoplayAction = await disableAutoplay();
        segmentStart = Date.now();
      }
      await sleep(500);
    }
    data.passed = data.transitions.length === 2 && data.failures.length === 0 && data.measurements.length > 100;
    save();
    if (!data.passed) throw new Error(`Quality capture continuity failed; preserved ${reportPath}`);
    // Keep detailed observations in their file, not in repeated console/status
    // payloads (the matrix runner intentionally has a bounded output buffer).
    return { hold: { passed: true, mode: data.mode, durationMs: data.durationMs,
      requestedDurationMs: 3 * perVideoMs, reportPath, measurementCount: data.measurements.length,
      transitionCount: data.transitions.length }, latestStatus: status };
  } catch (error) {
    data.error = String(error?.message || error); save(); throw error;
  }
};
