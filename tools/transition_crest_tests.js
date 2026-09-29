const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const {render,baseline}=require('./transition_crest_experiment');
const source=fs.readFileSync(path.resolve(__dirname,'../offscreen/leveler-worklet.js'),'utf8');
const crest=t=>{let y=0;for(let k=1;k<=12;k++)y+=Math.cos(2*Math.PI*151*k*t);return .04*y/12;};
const tone=t=>Math.sin(2*Math.PI*997*t);
const old=render(baseline,crest);
assert(old.outputDb < -25 && old.protectedPercent>99,'retained counterexample must reproduce sustained over-limiting');
const evidence=[];
for(const rate of [44100,48000,96000]){
  for(const cap of [1,.25]){
    const r=render(source,crest,rate,cap);
    assert(r.outputDb>=-21&&r.outputDb<=-17,`steady high-crest target at ${rate}/${cap}: ${r.outputDb}`);
    assert(r.protectedPercent<1,'a stable lifted source must release temporary transition protection');
    assert(r.peakDb<=-3+1e-4 && r.hardClips===0,'ordinary limiter retains player-relative peak ceiling');
    evidence.push({rate,cap,kind:'steady',...r});
  }
  for(const [name,low,high]of [['quiet-to-loud',.01,.8],['below-raw-onset-threshold',.006,.08]]){
    const r=render(source,t=>(t<4?low:high)*tone(t),rate);
    assert(r.stepPeakDb<=-13+1e-4,`${name} first 40ms must remain protected at ${rate}`);
    assert(r.hardClips===0&&r.peakDb<=-3+1e-4);
    evidence.push({rate,cap:1,kind:name,...r});
  }
}
const dir=path.resolve(__dirname,'../tmp/transition-crest-candidate');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'regression.json'),JSON.stringify({old,evidence},null,2));
console.log('PASS sustained-crest output, protection release, quarter-volume boundary and two onset regimes at 44.1/48/96 kHz');
