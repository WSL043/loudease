// Offline counterfactual for the low-output real-site finding; no runtime edits.
const fs=require('fs');
const path=require('path');
const {render}=require('./transition_crest_experiment');
const root=path.resolve(__dirname,'..');
const worklet=fs.readFileSync(path.join(root,'offscreen/leveler-worklet.js'),'utf8');
const currentPolicy=fs.readFileSync(path.join(root,'shared/programme-leveler-policy.js'),'utf8');
const original=currentPolicy.includes('dynamicsAmount: 0.86') ? currentPolicy
  : currentPolicy.replace('dynamicsAmount: 0.92', 'dynamicsAmount: 0.86');
const variants=[
  {name:'current',amount:.86,deadband:1},
  {name:'bounded-increase',amount:.92,deadband:1},
  {name:'full-one-db-deadband',amount:1,deadband:1},
  {name:'full-half-db-deadband',amount:1,deadband:.5},
  {name:'full-no-deadband',amount:1,deadband:0}
];
function policy(v){
  let source=original;
  const a='dynamicsAmount: 0.86',b='dynamicsDeadbandDb: 1';
  if(source.split(a).length!==2||source.split(b).length!==2)throw Error('Policy anchors changed');
  source=source.replace(a,`dynamicsAmount: ${v.amount}`).replace(b,`dynamicsDeadbandDb: ${v.deadband}`);
  return source;
}
const tone=t=>Math.sin(2*Math.PI*997*t);
const four=t=>(Math.sin(2*Math.PI*211*t)+Math.sin(2*Math.PI*419*t)+Math.sin(2*Math.PI*839*t)+Math.sin(2*Math.PI*1679*t))/4;
const wide=t=>{let s=0;for(let i=1;i<=12;i++)s+=Math.cos(2*Math.PI*151*i*t);return s/12};
const cases={
  steadyQuiet:{f:t=>.025*tone(t),cap:1},
  quietHighCrest:{f:t=>.04*four(t),cap:1},
  quietWideCrest:{f:t=>.04*wide(t),cap:1},
  loudToModerate:{f:t=>(t<4?.6:.11)*four(t),cap:1},
  loudToModeratePlayer44:{f:t=>(t<4?.6:.11)*four(t),cap:.44},
  loudToQuiet:{f:t=>(t<4?.6:.025)*four(t),cap:1},
  loudToQuietPlayer44:{f:t=>(t<4?.6:.025)*four(t),cap:.44},
  loudToQuietBed:{f:t=>(t<4?.6:.002)*four(t),cap:1},
  quietToLoud:{f:t=>(t<4?.01:.8)*tone(t),cap:1},
  loudStable:{f:t=>.8*four(t),cap:1}
};
const results=[];
for(const v of variants)for(const [name,c]of Object.entries(cases)){
  const r=render(worklet,c.f,48000,c.cap,policy(v));
  results.push({variant:v.name,case:name,...r});
  console.log(JSON.stringify({variant:v.name,case:name,input:r.inputDb,output:r.outputDb,gain:r.gainDb,targetGain:r.targetGainDb,programme:r.programmeDb,liftBudget:r.liftBudgetDb,limiter:r.limiterDb,protected:r.protectedPercent,stepPeak:r.stepPeakDb,hardClips:r.hardClips}));
}
const dest=path.join(root,'tmp/transition-crest-candidate/dynamics-policy-experiment.json');
fs.writeFileSync(dest,JSON.stringify({at:new Date().toISOString(),note:'Generated signals only; no real-site proof, no production changes',results},null,2));
