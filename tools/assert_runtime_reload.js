const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function ok(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${message}`);
}

const background = read('background.js');

ok(!background.includes('chrome.runtime.reload()'), 'webpage status cannot trigger chrome.runtime.reload');
ok(!background.includes('function scheduleRuntimeReload'), 'runtime reload scheduler was removed');
ok(!background.includes('runtimeReloadScheduled'), 'runtime reload state was removed');
ok(!background.includes("runtime:reload-suppressed"), 'runtime reload suppression event was removed with the scheduler');
ok(!background.includes("newer-page-engine"), 'legacy newer-page-engine reload path was removed');
ok(!background.includes("mixed-runtime-status"), 'mixed-runtime reload path was removed');
ok(!background.includes('RUNTIME_RELOAD_DELAY_MS'), 'runtime reload delay constant was removed');
