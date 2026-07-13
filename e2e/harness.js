(function initHarness() {
  const statusElement = document.getElementById('status');
  const params = new URLSearchParams(location.search);
  const targetPrefix = params.get('targetPrefix') || 'http://127.0.0.1:';

  function setStatus(status) {
    window.__WVB_E2E_STATUS__ = status;
    statusElement.textContent = JSON.stringify(status, null, 2);
  }

  function send(message) {
    return chrome.runtime.sendMessage(message);
  }

  async function findTargetTab() {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => {
      const url = String(item.url || '');
      return item.id && url.startsWith(targetPrefix);
    });
    if (!tab) {
      throw new Error(`No target tab matches ${targetPrefix}`);
    }
    return tab;
  }

  function getStreamId(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
        const error = chrome.runtime.lastError;
        if (error || !streamId) {
          reject(new Error(error?.message || 'tabCapture did not return a stream id'));
          return;
        }
        resolve(streamId);
      });
    });
  }

  async function getDiagnostics(tabId) {
    const diagnostics = await send({ type: 'WVB_GET_DIAGNOSTICS' });
    const tab = diagnostics.tabs.find((item) => Number(item.tabId) === Number(tabId));
    return { diagnostics, tab };
  }

  async function waitForCapture(tabId) {
    const startedAt = Date.now();
    let latest = null;
    while (Date.now() - startedAt < 8000) {
      latest = await getDiagnostics(tabId);
      if (
        latest.tab?.captureActive &&
        latest.tab?.capturePipelineMode === 'leveler-v1' &&
        Number(latest.tab?.signalTickCount || latest.tab?.capture?.signalTickCount || 0) > 0
      ) {
        return latest;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return latest;
  }

  async function start() {
    try {
      setStatus({ phase: 'finding-target' });
      const tab = await findTargetTab();
      await chrome.tabs.update(tab.id, { active: true });
      setStatus({ phase: 'requesting-stream-id', tabId: tab.id, tabUrl: tab.url });
      const streamId = await getStreamId(tab.id);
      setStatus({ phase: 'starting-capture', tabId: tab.id, hasStreamId: Boolean(streamId) });
      const response = await send({
        type: 'WVB_START_TAB_CAPTURE',
        tabId: tab.id,
        tabUrl: tab.url,
        streamId
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'WVB_START_TAB_CAPTURE failed');
      }
      const result = await waitForCapture(tab.id);
      setStatus({
        phase: result?.tab?.captureActive ? 'capture-active' : 'capture-timeout',
        response,
        tab: result?.tab || null,
        recentEvents: (result?.diagnostics?.events || []).slice(0, 12)
      });
    } catch (error) {
      setStatus({ phase: 'error', error: String(error?.message || error) });
    }
  }

  async function stop() {
    try {
      const tab = await findTargetTab();
      const response = await send({ type: 'WVB_STOP_TAB_CAPTURE', tabId: tab.id });
      const result = await getDiagnostics(tab.id);
      setStatus({
        phase: 'stopped',
        response,
        tab: result.tab || null,
        recentEvents: (result.diagnostics?.events || []).slice(0, 12)
      });
    } catch (error) {
      setStatus({ phase: 'error', error: String(error?.message || error) });
    }
  }

  document.getElementById('start').addEventListener('click', start);
  document.getElementById('stop').addEventListener('click', stop);
  setStatus({ phase: 'ready', targetPrefix });
})();
