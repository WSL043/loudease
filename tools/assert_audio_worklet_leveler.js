const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const offscreen = fs.readFileSync(path.join(root, 'offscreen', 'index.js'), 'utf8');
const workletPath = path.join(root, 'offscreen', 'leveler-worklet.js');
const worklet = fs.readFileSync(workletPath, 'utf8');
const checks = [
  ['leveler worklet exists', fs.existsSync(workletPath)],
  ['production loads unified worklet first', /createLevelerNode\(\)/.test(offscreen) && /offscreen\/leveler-worklet\.js/.test(offscreen)],
  ['unified graph bypasses main-thread meter gain and limiter', /this\.source\.connect\(this\.leveler\)/.test(offscreen) && /this\.leveler\.connect\(this\.playerGain\)/.test(offscreen)],
  ['legacy graph remains fallback', /if \(this\.levelerMode !== 'worklet'\)/.test(offscreen) && /createMeterNode\(\)/.test(offscreen) && /createLimiterNode\(\)/.test(offscreen)],
  ['runtime controls use port messages', /this\.leveler\.port\.postMessage/.test(offscreen) && /this\.port\.onmessage/.test(worklet)],
  ['render path uses fixed buffers', /new Float64Array\(HISTORY_SIZE\)/.test(worklet) && /new Float32Array\(DELAY_LENGTH\)/.test(worklet)],
  ['render path avoids wall clocks timers DOM and network', !/Date\.now|setTimeout|document\.|fetch\(|XMLHttpRequest/.test(worklet)],
  ['worklet owns loudness gain and limiting', /finishFrame\(\)/.test(worklet) && /targetGainDb/.test(worklet) && /limiterGain/.test(worklet)],
  ['worklet uses robust quiet-window loudness', /LIFT_LOUDNESS_PERCENTILE = 0\.5/.test(worklet) && /percentileLast\(this\.energyHistory, 5, LIFT_LOUDNESS_PERCENTILE\)/.test(worklet)],
  ['worklet strong lift stays explicitly bounded', /MAX_LIFT_DB = 34/.test(worklet) && /LIFT_LIMITER_BUDGET_DB = 15/.test(worklet) && /effectiveLiftBudget/.test(worklet)],
  ['worklet assists only measured limiter-bound quiet output', /REALIZED_LIFT_ASSIST_RATIO = 0\.5/.test(worklet) && /realizedLiftAssistDb/.test(worklet) && /limiterReductionDb/.test(worklet)],
  ['diagnostics are returned by the worklet', /type: 'state'/.test(worklet) && /handleLevelerMessage/.test(offscreen)]
];
let failed = false;
for (const [name, ok] of checks) { if (ok) console.log(`OK   ${name}`); else { console.error(`FAIL ${name}`); failed = true; } }
if (failed) process.exit(1);
