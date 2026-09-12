async function waitForExtensionPage(cdp, { url, extensionId, requiredApis }, { timeoutMs = 8000, pollMs = 50 } = {}) {
  await cdp.command('Runtime.enable');
  const startedAt = Date.now();
  let last = null;
  // A target URL can be visible before its extension execution context exists.
  // Poll from the driver so document replacement cannot destroy the waiter.
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await cdp.command('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => ({
          url: globalThis.location?.href || '',
          readyState: globalThis.document?.readyState || '',
          extensionId: globalThis.chrome?.runtime?.id || '',
          apisReady: ${JSON.stringify(requiredApis)}.every((path) => typeof path.split('.').reduce((value, key) => value?.[key], globalThis.chrome) === 'function')
        }))()`
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      last = result.result?.value || null;
      if (last?.url === url && last.extensionId === extensionId && last.apisReady
          && ['interactive', 'complete'].includes(last.readyState)) return last;
    } catch (error) {
      if (!/Cannot find (?:default execution )?context|Execution context was destroyed|Inspected target navigated/i.test(String(error.message))) throw error;
      last = { contextTransition: String(error.message) };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Extension page readiness timed out for ${url}: ${JSON.stringify(last)}`);
}

module.exports = { waitForExtensionPage };
