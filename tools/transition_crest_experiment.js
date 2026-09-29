// Local candidate experiment. Never changes the installed build or runtime source.
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {instrument}=require('./real_quality_meter');
const root=path.resolve(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'offscreen/leveler-worklet.js'),'utf8');
const anchor='const liftedJump = this.currentGainDb > 0.01 && futurePeak > dbToLinear(this.adaptiveTransitionCeilingDb);';
const replacement='const liftedJump = this.currentGainDb > 0.01 && futurePeak > dbToLinear(this.adaptiveTransitionCeilingDb)\n        && rawInputPeak > this.previousInputFramePeak * PROGRAMME_JUMP_RATIO;';
// Preserve a reproducible pre-fix counterfactual after the narrow fix lands.
const baseline=runtime.includes(replacement)?runtime.replace(replacement,anchor):runtime;
function candidate(source){
  if(source.split(anchor).length!==2)throw Error('Unexpected baseline; refusing candidate patch');
  return source.replace(anchor,replacement);
}
function create(source,rate,cap=1,policySource){
  let Processor;
  const ctx=vm.createContext({sampleRate:rate,AudioWorkletProcessor:class{constructor(){this.messages=[];this.port={postMessage:m=>this.messages.push(m)};}},registerProcessor:(_,p)=>{Processor=p;}});
  vm.runInContext(policySource||fs.readFileSync(path.join(root,'shared/programme-leveler-policy.js'),'utf8'),ctx);
  vm.runInContext(instrument(source),ctx);
  const p=new Processor();
  p.configure({type:'configure',settings:{enabled:true,cutStrength:100,liftStrength:100,respectPlayerVolume:true},playerVolumeCap:cap,playerVolumeReliable:true,playerMuted:false,programmeKey:'fixture'});
  if(!p.configured)throw Error('Fixture processor not configured');
  return p;
}
const db=x=>20*Math.log10(Math.max(1e-12,x));
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
function render(source,fixture,rate=48000,cap=1,policySource){
  const p=create(source,rate,cap,policySource),input=new Float32Array(128),output=new Float32Array(128);
  let peak=0,stepPeak=0,protectedBlocks=0,steadyBlocks=0,hardClips=0;
  for(let n=0;n<rate*8;n+=128){
    for(let j=0;j<128;j++)input[j]=cap*fixture((n+j)/rate);
    p.process([[input]],[[output]]);
    if(n/rate>=4){steadyBlocks++;if(p.transitionProtectionSamples>0)protectedBlocks++;}
    for(let j=0;j<128;j++){const v=Math.abs(output[j]);if(!Number.isFinite(v))throw Error('Nonfinite PCM');peak=Math.max(peak,v);if((n+j)/rate>=4&&(n+j)/rate<4.04)stepPeak=Math.max(stepPeak,v);}
  }
  const states=p.messages.filter(m=>m.type==='state');
  hardClips=states.reduce((s,m)=>s+(m.hardClippedSamples||0),0);
  const rows=p.messages.filter(m=>m.type==='quality-audit'&&m.audioSeconds>=6);
  if(!rows.length||peak===0)throw Error('Fixture produced no measured output');
  return {inputDb:median(rows.map(m=>m.shortTerm[0]-db(cap))),outputDb:median(rows.map(m=>m.shortTerm[1]-db(cap))),
    gainDb:median(rows.map(m=>m.gainDb)),targetGainDb:median(rows.map(m=>m.targetGainDb)),
    programmeDb:median(rows.map(m=>m.programmeDb)),liftBudgetDb:median(rows.map(m=>m.liftBudgetDb)),
    limiterDb:median(rows.map(m=>m.limiterReductionDb)),
    protectedPercent:100*protectedBlocks/steadyBlocks,peakDb:db(peak/cap),stepPeakDb:db(stepPeak/cap),hardClips};
}
function audit(){
  const tone=t=>Math.sin(2*Math.PI*997*t);
  const crest=t=>(Math.sin(2*Math.PI*211*t)+Math.sin(2*Math.PI*419*t)+Math.sin(2*Math.PI*839*t)+Math.sin(2*Math.PI*1679*t))/4;
  const wideCrest=t=>{let y=0;for(let k=1;k<=12;k++)y+=Math.cos(2*Math.PI*151*k*t);return y/12;};
  const fixtures={steadyQuiet:t=>.025*tone(t),quietHighCrest:t=>.04*crest(t),quietWideCrest:t=>.04*wideCrest(t),ordinaryHighCrest:t=>.25*crest(t),
    loudHighCrest:t=>.8*crest(t),quietToLoud:t=>(t<4?.01:.8)*tone(t),liftedLowLevelJump:t=>(t<4?.006:.08)*tone(t)};
  const results=[];
  for(const [name,fixture]of Object.entries(fixtures)){
    const a=render(baseline,fixture),b=render(candidate(baseline),fixture);
    results.push({name,rate:48000,cap:1,baseline:a,candidate:b});
    console.log(name,JSON.stringify({before:a.outputDb,after:b.outputDb,protectedBefore:a.protectedPercent,protectedAfter:b.protectedPercent,stepBefore:a.stepPeakDb,stepAfter:b.stepPeakDb}));
  }
  const dir=path.join(root,'tmp/transition-crest-candidate');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'leveler-worklet.js'),candidate(baseline));
  fs.writeFileSync(path.join(dir,'experiment.json'),JSON.stringify({at:new Date().toISOString(),scope:'generated signals only; no real-site or true-peak acceptance',results},null,2));
  return results;
}
if(require.main===module)audit();
module.exports={candidate,create,render,baseline};
