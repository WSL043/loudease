// Compare the loaded policy with the exact pre-change counterfactual in the production worklet.
const fs=require('fs');
const path=require('path');
const assert=require('assert/strict');
const {render}=require('./transition_crest_experiment');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'offscreen/leveler-worklet.js'),'utf8');
const candidate=fs.readFileSync(path.join(root,'shared/programme-leveler-policy.js'),'utf8');
assert.equal(candidate.split('dynamicsAmount: 0.92').length,2,'candidate policy anchor');
const previous=candidate.replace('dynamicsAmount: 0.92','dynamicsAmount: 0.86');
const four=t=>(Math.sin(2*Math.PI*211*t)+Math.sin(2*Math.PI*419*t)+Math.sin(2*Math.PI*839*t)+Math.sin(2*Math.PI*1679*t))/4;
const tone=t=>Math.sin(2*Math.PI*997*t);
const fixtures={
  moderate:t=>(t<4?.6:.11)*four(t),
  quietBed:t=>(t<4?.6:.002)*four(t),
  quietProgramme:t=>.025*tone(t),
  loudProgramme:t=>.8*four(t),
  quietToLoud:t=>(t<4?.01:.8)*tone(t)
};
const records=[];
for(const rate of [44100,48000,96000])for(const cap of [1,.44]){
  for(const [name,fixture]of Object.entries(fixtures)){
    const before=render(source,fixture,rate,cap,previous);
    const after=render(source,fixture,rate,cap,candidate);
    records.push({rate,cap,name,before,after});
    assert.equal(after.hardClips,0,`${rate} ${cap} ${name} hard clipping`);
    assert(after.peakDb<=-2.99,`${rate} ${cap} ${name} sample ceiling`);
    if(name==='moderate'){
      assert(after.outputDb-before.outputDb>.5,`${rate} ${cap} moderate lift`);
      assert(after.outputDb>=-21&&after.outputDb<=-17,`${rate} ${cap} moderate output`);
    } else if(name==='quietBed'){
      assert(Math.abs(after.outputDb-before.outputDb)<.3,`${rate} ${cap} floor-qualified quiet bed`);
      assert(after.targetGainDb<0,`${rate} ${cap} quiet bed not new programme`);
    } else if(name==='quietProgramme'||name==='loudProgramme'){
      assert(Math.abs(after.outputDb-before.outputDb)<.3,`${rate} ${cap} steady programme`);
    } else if(name==='quietToLoud'){
      assert(after.stepPeakDb<=-12.9,`${rate} ${cap} onset protection`);
    }
  }
}
const destination=path.join(root,'tmp/transition-crest-candidate/dynamics-policy-regression.json');
fs.mkdirSync(path.dirname(destination),{recursive:true});
fs.writeFileSync(destination,JSON.stringify({at:new Date().toISOString(),note:'Generated signals; no real audio or listening acceptance',records},null,2));
console.log(`PASS ${records.length} production-worklet cases: moderate lift, floor-qualified bed, programme centres, onset, player cap and rates`);
