const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const stabilityScript = path.join(root, 'tools', 'e2e_stability_smoke.js');

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

const durationMs = String(readArg('duration-ms', process.env.WVB_E2E_HOLD_MS || 30000));
const cycles = String(readArg('cycles', process.env.WVB_E2E_CYCLES || 3));
const sampleMs = String(readArg('sample-ms', process.env.WVB_E2E_HOLD_SAMPLE_MS || 5000));

console.log(`[e2e-long-run] durationMs=${durationMs} cycles=${cycles} sampleMs=${sampleMs}`);

const result = spawnSync(process.execPath, [stabilityScript], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    WVB_E2E_HOLD_MS: durationMs,
    WVB_E2E_CYCLES: cycles,
    WVB_E2E_HOLD_SAMPLE_MS: sampleMs
  }
});

process.exit(result.status || 0);
