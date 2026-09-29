const assert = require('assert/strict');
const { inspect } = require('./personal_quality_integrity');
const row = (sequence, extra = {}) => ({tabId:1,sessionId:'a',sequence,audioSeconds:sequence/10,receivedAt:sequence*100,transportDropped:0,...extra});
assert.equal(inspect([{rows:[row(1),row(2),row(3)]}])[0].contiguous,true);
assert.equal(inspect([{rows:[row(1),row(3)]}])[0].gaps,1);
assert.equal(inspect([{rows:[row(1),row(1)]}])[0].duplicatesOrReordered,1);
assert.equal(inspect([{rows:[row(1,{transportDropped:1})]}])[0].contiguous,false);
assert.equal(inspect([{rows:[row(1),row(2,{sessionId:'b'})]}]).length,2);
console.log('PASS gap, duplicate, reported-loss and session-boundary checks');
