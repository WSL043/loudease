const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const chromeUserData = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
const defaultProfile = path.join(chromeUserData, 'Default');
const webVolumeExtensionId = 'fpkfdbclggjngebblaaphefkhmefmlig';
const codexChromeExtensionId = 'hehggadaopoacecdllhhajmbjkdcmajg';
const diagnosticsPort = 18765;

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { __error: String(error?.message || error) };
  }
}

function stat(filePath) {
  try {
    const item = fs.statSync(filePath);
    return {
      exists: true,
      mtime: item.mtime.toISOString(),
      size: item.size
    };
  } catch (_) {
    return { exists: false };
  }
}

function extensionState(preferences, id) {
  const item = preferences?.extensions?.settings?.[id];
  if (!item) {
    return { exists: false };
  }
  return {
    exists: true,
    path: item.path || '',
    location: item.location ?? null,
    disableReasons: item.disable_reasons || [],
    manifestVersion: item.manifest?.version || null,
    manifestName: item.manifest?.name || null,
    hasStartedServiceWorker: Boolean(item.has_started_service_worker),
    activeApiPermissions: item.active_permissions?.api || [],
    activeHostPermissions: item.active_permissions?.explicit_host || [],
    grantedHostPermissions: item.granted_permissions?.explicit_host || []
  };
}

function summarizeTab(tab) {
  if (!tab) {
    return null;
  }
  return {
    tabId: tab.tabId,
    url: firstFrameUrl(tab),
    title: tab.title || '',
    mediaTarget: Boolean(tab.mediaTarget),
    diagnosticOnly: Boolean(tab.diagnosticOnly),
    audibleHint: Boolean(tab.audibleHint),
    activeHint: Boolean(tab.activeHint),
    frameUrl: tab.frames?.[0]?.url || '',
    mediaCount: tab.mediaCount,
    processedCount: tab.processedCount,
    activeProcessorCount: tab.activeProcessorCount,
    audibleCount: tab.audibleCount,
    captureActive: tab.captureActive,
    captureState: tab.captureState,
    capturePipelineMode: tab.capturePipelineMode,
    captureContextState: tab.captureContextState,
    captureAudioTrackCount: tab.captureAudioTrackCount,
    captureError: tab.captureError || ''
  };
}

function firstTab(snapshot) {
  const tab = Array.isArray(snapshot?.tabs) ? snapshot.tabs[0] : null;
  return summarizeTab(tab);
}

function firstFrameUrl(tab) {
  if (!tab) {
    return '';
  }
  if (Array.isArray(tab.frames)) {
    const frame = tab.frames.find((item) => item?.url || item?.href);
    if (frame) {
      return String(frame.url || frame.href || '');
    }
  }
  return String(tab.frameUrl || tab.href || tab.url || '');
}

function knownMediaTarget(url) {
  return /(^|\/\/)(www\.)?(douyin|bilibili|youtube)\.com\b|(^|\/\/)live\.(douyin|bilibili)\.com\b|(^|\/\/)youtu\.be\b/i.test(String(url || ''));
}

function isCaptureProcessing(tab) {
  return Boolean(tab?.captureActive)
    && tab?.captureState === 'processing'
    && tab?.capturePipelineMode === 'programme-leveler-v4'
    && tab?.captureContextState === 'running'
    && ['leveler-worklet', 'worklet', 'analyser-fallback'].includes(tab?.meterMode)
    && Number(tab?.meterFrameAgeMs ?? Infinity) < 1000
    && Number(tab?.captureAudioTrackCount || 0) > 0;
}

function isPageProcessing(tab) {
  return Number(tab?.activeProcessorCount || 0) > 0 || Number(tab?.processedCount || 0) > 0;
}

function isAudioProcessing(tab) {
  return isCaptureProcessing(tab) || isPageProcessing(tab);
}

function hasObservedAudibleMedia(tab) {
  return Number(tab?.audibleCount || 0) > 0
    || Boolean(tab?.audibleHint)
    || Number(tab?.mediaCount || 0) > 0;
}

function diagnosticsReceiverState() {
  const command = [
    '$rows = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 18765 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess);',
    'if ($rows.Count -eq 0) { "[]" } else { $rows | ConvertTo-Json -Compress }'
  ].join(' ');
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      timeout: 2000,
      windowsHide: true
    }).trim();
    const parsed = output ? JSON.parse(output) : [];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return {
      port: diagnosticsPort,
      listening: rows.length > 0,
      listeners: rows.map((row) => ({
        localAddress: row.LocalAddress || '',
        localPort: Number(row.LocalPort) || diagnosticsPort,
        state: String(row.State || ''),
        owningProcess: Number(row.OwningProcess) || null
      }))
    };
  } catch (error) {
    return {
      port: diagnosticsPort,
      listening: false,
      error: String(error?.message || error)
    };
  }
}

const manifestPath = path.join(root, 'manifest.json');
const manifest = readJson(manifestPath);
const preferences = readJson(path.join(defaultProfile, 'Preferences'));
const securePreferences = readJson(path.join(defaultProfile, 'Secure Preferences'));
const diagnosticsPath = path.join(root, 'tmp', 'latest-diagnostics.json');
const diagnostics = readJson(diagnosticsPath);

const diagnosticsAgeMs = diagnostics?.now ? Date.now() - Number(diagnostics.now) : null;
const diskVersion = manifest.version || null;
const diagnosticsVersion = diagnostics.version || null;
const diagnosticsCurrent = diagnosticsAgeMs != null && diagnosticsAgeMs <= 10000;
const topDiagnosticTab = Array.isArray(diagnostics?.tabs) ? diagnostics.tabs[0] : null;
const topDiagnosticUrl = firstFrameUrl(topDiagnosticTab);
const diagnosticTabs = Array.isArray(diagnostics?.tabs) ? diagnostics.tabs : [];
const knownMediaDiagnosticTabs = diagnosticTabs.filter((tab) => tab?.mediaTarget || knownMediaTarget(firstFrameUrl(tab)));
const knownMediaDiagnosticTab = knownMediaDiagnosticTabs.find(hasObservedAudibleMedia) || knownMediaDiagnosticTabs[0];
const processingKnownMediaTabs = knownMediaDiagnosticTabs.filter(isAudioProcessing);
const observedUnprocessedMediaTabs = knownMediaDiagnosticTabs.filter((tab) => hasObservedAudibleMedia(tab) && !isAudioProcessing(tab));
const realAudioProcessingProven = diagnosticsCurrent && processingKnownMediaTabs.length > 0;
const diagnosticsVersionMatchesManifest = Boolean(diskVersion && diagnosticsVersion && diskVersion === diagnosticsVersion);
const diagnosticsFromKnownMediaTarget = Boolean(knownMediaDiagnosticTab);
const receiver = diagnosticsReceiverState();
const report = {
  checkedAt: new Date().toISOString(),
  extensionRoot: root,
  manifest: {
    path: manifestPath,
    stat: stat(manifestPath),
    version: manifest.version || null,
    name: manifest.name || null,
    hostPermissions: manifest.host_permissions || [],
    permissions: manifest.permissions || []
  },
  chromeProfile: {
    userData: chromeUserData,
    defaultProfile,
    preferencesStat: stat(path.join(defaultProfile, 'Preferences')),
    securePreferencesStat: stat(path.join(defaultProfile, 'Secure Preferences')),
    webVolumeInPreferences: extensionState(preferences, webVolumeExtensionId),
    webVolumeInSecurePreferences: extensionState(securePreferences, webVolumeExtensionId),
    codexChromeInPreferences: extensionState(preferences, codexChromeExtensionId),
    codexChromeInSecurePreferences: extensionState(securePreferences, codexChromeExtensionId)
  },
  diagnostics: {
    path: diagnosticsPath,
    stat: stat(diagnosticsPath),
    receiver,
    version: diagnostics.version || null,
    versionMatchesManifest: diagnosticsVersionMatchesManifest,
    localDiagnosticsAvailable: Boolean(diagnostics.localDiagnosticsAvailable),
    ageMs: diagnosticsAgeMs,
    stale: !diagnosticsCurrent,
    firstTab: firstTab(diagnostics),
    firstTabUrl: topDiagnosticUrl,
    firstTabIsKnownMediaTarget: diagnosticsFromKnownMediaTarget,
    knownMediaTab: summarizeTab(knownMediaDiagnosticTab),
    knownMediaTabs: knownMediaDiagnosticTabs.map(summarizeTab),
    knownMediaProcessingTabs: processingKnownMediaTabs.map(summarizeTab),
    observedUnprocessedMediaTabs: observedUnprocessedMediaTabs.map(summarizeTab),
    latestEvent: Array.isArray(diagnostics.events) ? diagnostics.events[0] : null
  },
  interpretation: {
    diskVersion,
    runtimeDiagnosticsVersion: diagnosticsVersion,
    diagnosticsIsCurrent: diagnosticsCurrent,
    diagnosticsVersionMatchesManifest,
    reloadExtensionRequired: Boolean(diagnosticsVersion && diskVersion && diagnosticsVersion !== diskVersion),
    localDiagnosticsReceiverListening: receiver.listening,
    diagnosticsFromKnownMediaTarget,
    realAudioProcessingProven,
    observedKnownMediaWithoutProcessing: diagnosticsCurrent && observedUnprocessedMediaTabs.length > 0,
    codexChromeLikelyEnabled: extensionState(securePreferences, codexChromeExtensionId).disableReasons.length === 0,
    userChromeRuntimeVersionProven: diagnosticsCurrent && diagnosticsVersionMatchesManifest,
    userChromeTargetTabProven: diagnosticsCurrent && diagnosticsFromKnownMediaTarget,
    nextAction: !receiver.listening
      ? `Start tools/diagnostics_receiver.py on http://127.0.0.1:${diagnosticsPort}/loudease, then re-run this audit.`
      : diagnosticsVersion && diskVersion && diagnosticsVersion !== diskVersion
        ? `Reload the unpacked extension in chrome://extensions/?id=${webVolumeExtensionId}; disk=${diskVersion}, runtime=${diagnosticsVersion}`
        : diagnosticsCurrent && !diagnosticsFromKnownMediaTarget
          ? 'Open or activate the actual Douyin/Bilibili tab, then check whether it appears as a knownMediaTab.'
          : diagnosticsCurrent && processingKnownMediaTabs.length === 0 && observedUnprocessedMediaTabs.length > 0
            ? 'Known media is visible/audible but not processing. Use the popup full-tab capture button on the target tab, then re-run this audit.'
          : diagnosticsCurrent
            ? 'Runtime version and diagnostic target look aligned; audio processing is proven only if knownMediaProcessingTabs is non-empty.'
            : 'Receiver is listening but diagnostics did not refresh; wake the extension popup or reload the unpacked extension, then re-run this audit.'
  },
  warnings: [
    !receiver.listening
      ? `Local diagnostics receiver is not listening on 127.0.0.1:${diagnosticsPort}.`
      : '',
    receiver.listening && !diagnosticsCurrent
      ? `Local diagnostics receiver is listening, but diagnostics are stale or not being posted by the active extension.`
      : '',
    diagnosticsVersion && diskVersion && diagnosticsVersion !== diskVersion
      ? `Runtime diagnostics version ${diagnosticsVersion} does not match disk version ${diskVersion}.`
      : '',
    diagnosticsCurrent && !diagnosticsFromKnownMediaTarget
      ? `Fresh diagnostics point to ${topDiagnosticUrl || 'an unknown/non-media tab'}, not Douyin/Bilibili.`
      : '',
    diagnosticsCurrent && observedUnprocessedMediaTabs.length > 0
      ? `Known media observed but not processing in tab(s): ${observedUnprocessedMediaTabs.map((tab) => tab.tabId).join(', ')}.`
      : ''
  ].filter(Boolean)
};

console.log(JSON.stringify(report, null, 2));
