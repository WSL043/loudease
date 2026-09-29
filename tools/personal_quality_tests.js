const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { transform, replaceOnce } = require('./stage_personal_quality');
async function main() {
  const root = path.resolve(__dirname, '..');
  const files = Object.fromEntries(['background.js', 'offscreen/index.js', 'offscreen/leveler-worklet.js']
    .map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]));
  const output = transform(files);
  assert.throws(() => replaceOnce('x x', 'x', 'y'));
  const branch = output['offscreen/index.js'].split('  handleLevelerMessage(message) {')[1]
    .split("    if (message.type === 'configured'")[0];
  let ack;
  const calls = [];
  const handler = vm.runInNewContext(`(function(message){${branch}})`, {
    crypto: { randomUUID: () => '00000000-0000-0000-0000-000000000001' },
    chrome: { runtime: { sendMessage: x => { calls.push(x); return new Promise(resolve => { ack = resolve; }); } } }
  });
  const session = { tabId: 12 };
  for (let i = 0; i < 10; i++) handler.call(session, { type: 'quality-audit', audioSeconds: i / 10 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rows.length, 10);
  assert.equal(calls[0].rows[9].sequence, 10);
  handler.call(session, { type: 'quality-audit' });
  assert.equal(session.personalAuditDropped, 1, 'backpressure must be reported');
  ack({ ok: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.personalAuditDropped, 11, 'failed batches must be reported');
  handler.call(session, { type: 'quality-audit' });
  assert.equal(session.personalAuditRows[0].transportDropped, 11);
  assert.equal(session.personalAuditRows[0].sequence, 12);
  const guard = output['background.js'].split("    if (message.type === 'WVB_PERSONAL_QUALITY_BATCH') {")[1]
    .split("    if (message.type === 'WVB_GET_SETTINGS') {")[0];
  const fetches = [];
  const forward = vm.runInNewContext(`(async function(message,sender){${guard})`, {
    localDiagnosticsEnabled: true,
    chrome: { runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p } },
    AbortSignal, fetch: async (...args) => { fetches.push(args); return { ok: true }; }
  });
  assert.equal((await forward({ rows: [] }, { id: 'test', url: 'https://example.com/' })).ok, false);
  assert.equal(fetches.length, 0);
  await forward({ rows: calls[0].rows }, { id: 'test', url: 'chrome-extension://test/offscreen/index.html' });
  assert.equal(fetches[0][0], 'http://127.0.0.1:18765/quality');
  console.log('PASS bounded batches, explicit loss, sender boundary, fixed loopback destination');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
