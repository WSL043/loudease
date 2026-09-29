const assert = require('node:assert/strict');
const { describeVideo, energyMeanDb } = require('./analyze_balance_objective');

const rows = [
  ...Array.from({ length: 50 }, () => ({ input: -30, output: -25, limiterReductionDb: 0 })),
  ...Array.from({ length: 50 }, () => ({ input: -20, output: -20, limiterReductionDb: 0 })),
  ...Array.from({ length: 10 }, () => ({ input: -50, output: -50, limiterReductionDb: 0 }))
];
const result = describeVideo({ site: 'fixture', segment: 1, title: 'paired levels' }, rows);
assert.equal(result.eligibleSeconds, 11);
assert.equal(result.signalSeconds, 10, 'deep bed is excluded by the relative input gate');
assert.equal(result.inputRangeP10P95Db, 10);
assert.equal(result.outputRangeP10P95Db, 5);
assert.equal(result.inputGroupContrastDb, 10);
assert.equal(result.outputGroupContrastDb, 5);
assert.equal(result.contrastWarning,null);
const inverted = describeVideo({ site: 'fixture', segment: 2, title: 'reversed' }, [
  ...Array.from({ length: 50 }, () => ({ input: -30, output: -19, limiterReductionDb: 0 })),
  ...Array.from({ length: 50 }, () => ({ input: -20, output: -21, limiterReductionDb: 0 }))
]);
assert.equal(inverted.contrastWarning,'reversed');
assert(result.outputCentreDb > result.inputCentreDb, 'centre should move upward with matched output');
assert(Math.abs(energyMeanDb([-20, -20]) + 20) < 1e-9);
console.log('PASS shared input gate, paired contrast and energy centre');
