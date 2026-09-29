// Install test-only observation into the existing disposable developer build.
// Never rewrites production source or adds permissions / automatic capture.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { instrument } = require('./real_quality_meter');
const root = path.resolve(__dirname, '..');
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
function replaceOnce(source, anchor, value) {
  if (source.split(anchor).length !== 2) throw new Error('Missing or ambiguous instrumentation anchor');
  return source.replace(anchor, value);
}
function transform(files) {
  const result = { ...files };
  result['offscreen/leveler-worklet.js'] = instrument(files['offscreen/leveler-worklet.js']);
  result['offscreen/index.js'] = replaceOnce(files['offscreen/index.js'],
    '  handleLevelerMessage(message) {', `  handleLevelerMessage(message) {
    if (message.type === 'quality-audit') {
      if (!this.personalAuditId) this.personalAuditId = crypto.randomUUID();
      this.personalAuditRows ||= [];
      this.personalAuditDropped ||= 0;
      this.personalAuditSequence = (this.personalAuditSequence || 0) + 1;
      if (this.personalAuditBusy) { this.personalAuditDropped++; return; }
      this.personalAuditRows.push({ ...message, tabId: this.tabId,
        sessionId: this.personalAuditId, sequence: this.personalAuditSequence,
        transportDropped: this.personalAuditDropped, receivedAt: Date.now() });
      if (this.personalAuditRows.length >= 10) {
        const rows = this.personalAuditRows.splice(0);
        this.personalAuditBusy = true;
        chrome.runtime.sendMessage({ type: 'WVB_PERSONAL_QUALITY_BATCH', rows })
          .then(r => { if (!r?.ok) this.personalAuditDropped += rows.length; })
          .catch(() => { this.personalAuditDropped += rows.length; })
          .finally(() => { this.personalAuditBusy = false; });
      }
      return;
    }`);
  result['background.js'] = replaceOnce(files['background.js'],
    "    if (message.type === 'WVB_GET_SETTINGS') {", `    if (message.type === 'WVB_PERSONAL_QUALITY_BATCH') {
      if (!localDiagnosticsEnabled || sender.id !== chrome.runtime.id
          || sender.url !== chrome.runtime.getURL('offscreen/index.html')
          || !Array.isArray(message.rows) || message.rows.length > 10) return { ok: false };
      const response = await fetch('http://127.0.0.1:18765/quality', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schema: 1, rows: message.rows }),
        signal: AbortSignal.timeout(2000), cache: 'no-store'
      });
      return { ok: response.ok };
    }
    if (message.type === 'WVB_GET_SETTINGS') {`);
  // Restrict ordinary diagnostics to test sites and scalar technical fields.
  result['background.js'] = replaceOnce(result['background.js'],
    'body: JSON.stringify(diagnosticsSnapshot()),', `body: JSON.stringify((() => {
        const snapshot = diagnosticsSnapshot();
        return { version: snapshot.version, now: snapshot.now,
          localDiagnosticsEnabled, localDiagnosticsAvailable,
          tabs: snapshot.tabs.flatMap(tab => {
            let site; try { site = new URL(tab.url).hostname; } catch { return []; }
            if (!['www.youtube.com', 'www.bilibili.com', 'live.bilibili.com', 'www.douyin.com'].includes(site)) return [];
            return [{ site, ...Object.fromEntries(Object.entries(tab).filter(([key, value]) =>
              typeof value === 'number' || typeof value === 'boolean'
              || (['captureState', 'capturePipelineMode', 'captureContextState', 'kWeightingMode'].includes(key) && typeof value === 'string'))) }];
          }) };
      })()),`);
  return result;
}
function stage() {
  const destination = path.join(root, 'dist', 'github-dev');
  const names = ['background.js', 'offscreen/index.js', 'offscreen/leveler-worklet.js'];
  const files = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]));
  const outputs = transform(files);
  // Preflight every file before writing any file. Permit only baseline or this exact observer.
  for (const name of names) {
    const current = fs.readFileSync(path.join(destination, name), 'utf8');
    if (current !== files[name] && current !== outputs[name]) throw new Error(`Preserving unexpected developer changes: ${name}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  for (const key of ['permissions', 'host_permissions']) {
    if (JSON.stringify(manifest[key]) !== JSON.stringify(sourceManifest[key])) throw new Error('Unexpected manifest permissions');
  }
  for (const name of names) fs.writeFileSync(path.join(destination, name), outputs[name]);
  const evidence = { schema: 1, stagedAt: new Date().toISOString(), destination,
    scope: 'local test only; identical PCM observer; no standards-compliant LUFS claim',
    files: names.map(name => ({ name, sourceSha256: hash(files[name]), observedSha256: hash(outputs[name]) })) };
  fs.writeFileSync(path.join(root, 'tmp', 'personal-quality-stage.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
if (require.main === module) stage();
module.exports = { transform, replaceOnce };
