const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { instrument } = require('./real_quality_meter.js');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'offscreen/leveler-worklet.js'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'shared/programme-leveler-policy.js'), 'utf8');
function create(code, rate) {
  let Processor;
  const context = vm.createContext({sampleRate: rate, AudioWorkletProcessor: class {constructor(){this.messages=[];this.port={postMessage:m=>this.messages.push(m)};}}, registerProcessor: (_, p) => {Processor=p;}});
  vm.runInContext(policy, context); vm.runInContext(code, context);
  const p = new Processor();
  p.configure({type:'configure',settings:{enabled:true,cutStrength:100,liftStrength:100,respectPlayerVolume:true},playerVolumeReliable:true,playerVolumeCap:1,playerMuted:false,programmeKey:'a'});
  return p;
}
for (const rate of [44100,48000,96000]) {
  const original=create(source,rate), observed=create(instrument(source),rate);
  for(let b=0;b<Math.ceil(rate*4/128);b++) {
    if(b===300) for(const p of [original,observed]) p.configure({type:'configure',programmeKey:'b',playerVolumeCap:0.5,playerVolumeReliable:true});
    const input=[Float32Array.from({length:128},(_,i)=>0.1*Math.sin(2*Math.PI*997*(b*128+i)/rate)),Float32Array.from({length:128},(_,i)=>0.2*Math.sin(2*Math.PI*8300*(b*128+i)/rate))];
    const a=[new Float32Array(128),new Float32Array(128)],z=[new Float32Array(128),new Float32Array(128)];
    original.process([input],[a]);observed.process([input],[z]);
    assert.deepEqual(a,z,'measurement must preserve exact stereo PCM');
  }
  const states=observed.messages.filter(x=>x.type==='quality-audit');
  assert(states.length>=39);
  assert(states.every(x=>x.momentary.every(Number.isFinite)&&x.shortTerm.every(Number.isFinite)));
  assert(states.every(x=>x.dynamicsAmount===0.92),'observer reports the effective loaded policy');
  console.log(`PASS ${rate} Hz stereo PCM parity and finite observer reports`);
}
// Disabled leveler has identical steady input/output energy after its 5 ms delay.
const bypass=create(instrument(source),48000);
bypass.configure({type:'configure',settings:{enabled:false}});
for(let b=0;b<1600;b++) { const x=Float32Array.from({length:128},(_,i)=>0.05*Math.sin(2*Math.PI*1000*(b*128+i)/48000));bypass.process([[x,x]],[[new Float32Array(128),new Float32Array(128)]]); }
const last=bypass.messages.filter(x=>x.type==='quality-audit').at(-1);
assert(Math.abs(last.shortTerm[0]-last.shortTerm[1])<0.001);
console.log('PASS equal measurement domain under bypass');
