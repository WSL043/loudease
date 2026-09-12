const assert = require('node:assert/strict');
const vm = require('node:vm');
const { waitForExtensionPage } = require('./cdp_extension_ready.js');

const url = 'chrome-extension://fixture/popup/index.html';
const expected = { url, extensionId: 'fixture', requiredApis: ['tabs.query', 'runtime.sendMessage'] };
function page(overrides = {}) {
  return { location: { href: url }, document: { readyState: 'complete' }, chrome: { runtime: { id: 'fixture', sendMessage() {} }, tabs: { query() {} } }, ...overrides };
}
function driver(contexts) {
  return {
    calls: 0,
    async command(method, params) {
      if (method === 'Runtime.enable') return {};
      assert.equal(method, 'Runtime.evaluate');
      const context = contexts[Math.min(this.calls++, contexts.length - 1)];
      if (context instanceof Error) throw context;
      return { result: { value: vm.runInNewContext(params.expression, context) } };
    }
  };
}

(async () => {
  const cdp = driver([
    page({ location: { href: 'about:blank' }, chrome: {} }),
    page({ document: { readyState: 'loading' } }),
    page({ chrome: { runtime: { id: 'fixture', sendMessage() {} } } }),
    new Error('Execution context was destroyed.'),
    page()
  ]);
  assert.equal((await waitForExtensionPage(cdp, expected, { pollMs: 0 })).extensionId, 'fixture');
  assert.equal(cdp.calls, 5);
  console.log('OK   extension waiter survives initial document, missing APIs, and context replacement');

  for (const context of [page({ location: { href: 'https://example.test/' } }), page({ chrome: { runtime: { id: 'wrong-extension', sendMessage() {} }, tabs: { query() {} } } }), page({ chrome: {} })]) {
    await assert.rejects(waitForExtensionPage(driver([context]), expected, { timeoutMs: 10, pollMs: 0 }), /readiness timed out/);
  }
  console.log('OK   wrong page, wrong extension, and permanently missing APIs remain failures');
  const broken = driver([new Error('CDP socket disconnected')]);
  await assert.rejects(waitForExtensionPage(broken, expected), /socket disconnected/);
  assert.equal(broken.calls, 1);
  console.log('OK   non-navigation errors propagate without retrying the scenario');
})().catch((error) => { console.error(error); process.exitCode = 1; });
