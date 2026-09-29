const assert=require('assert/strict');
const {bracketPlaying,independentCap}=require('./analyze_personal_quality');
const a={segment:0,observedAt:1000,media:[{paused:false,muted:false,ended:false,readyState:4,duration:500,currentTime:20}]};
const b={segment:0,observedAt:11000,media:[{...a.media[0],currentTime:30}]};
assert.equal(bracketPlaying(a,b,5000),true);
assert.equal(bracketPlaying(a,{...b,segment:1},5000),false);
assert.equal(bracketPlaying(a,{...b,observedAt:20000},5000),false);
assert.equal(bracketPlaying(a,{...b,media:[{...b.media[0],paused:true}]},5000),false);
assert.equal(bracketPlaying(a,{...b,media:[{...b.media[0],visible:false}]},5000),false);
assert.equal(bracketPlaying(a,{...b,media:[{...b.media[0],currentTime:20}]},5000),false);
assert.equal(bracketPlaying(a,{...b,media:[{...b.media[0],duration:30}]},5000),false);
const longAdA={...a,expectedDuration:500,media:[{...a.media[0],duration:130}]};
const longAdB={...b,expectedDuration:500,media:[{...b.media[0],duration:130}]};
assert.equal(bracketPlaying(longAdA,longAdB,5000),false,'long ads must not qualify as the selected programme');
const av={...a,independentVolumeEvidence:'page',media:[{...a.media[0],volume:0.5}]};
const bv={...b,independentVolumeEvidence:'page',media:[{...b.media[0],volume:0.5}]};
assert.equal(independentCap(av,bv),0.5);
assert.equal(independentCap(a,b),null);
assert.equal(independentCap(av,{...bv,media:[{...bv.media[0],volume:1}]}),null);
console.log('PASS paused, stuck, ad, source change and observation-gap exclusions');

// Integration guard: a live capture from an old binary cannot qualify a candidate.
const fs=require('fs'),path=require('path');
const {analyze}=require('./analyze_personal_quality');
const temporaryRoot=path.resolve(__dirname,'../tmp');fs.mkdirSync(temporaryRoot,{recursive:true});
const directory=fs.mkdtempSync(path.join(temporaryRoot,'personal-analysis-test-'));
try{
  const pages=[1000,11000].map((at,i)=>({site:'youtube',tabId:1,segment:0,observedAt:at,expectedDuration:500,title:'fixture',url:'https://www.youtube.com/watch?v=fixture',media:[{...a.media[0],visible:true,currentTime:20+i*10}]}));
  pages.unshift({...pages[0],observedAt:900,expectedDuration:600,title:'stale navigation title',url:'https://www.youtube.com/watch?v=old'});
  const rows=Array.from({length:101},(_,i)=>({tabId:1,sessionId:'fixture',receivedAt:1000+i*100,audioSeconds:i/10,sequence:i,resetCount:0,cap:1,reliable:true,muted:false,sourceFingerprint:1,dynamicsAmount:.86,shortTerm:[-20,-20],momentary:[-20,-20],targetDb:-19,confidence:1,peaks:[.2,.2],gainDb:0,limiterReductionDb:0,transitionProtected:false}));
  const statuses=Array.from({length:11},(_,i)=>({_receivedAt:1000+i*1000,tabs:[{tabId:1,captureActive:true,captureDspLive:true,startupGateOpen:true,captureContextState:'running'}]}));
  fs.writeFileSync(path.join(directory,'quality.jsonl'),JSON.stringify({rows})+'\n');
  fs.writeFileSync(path.join(directory,'status.jsonl'),statuses.map(JSON.stringify).join('\n')+'\n');
  fs.writeFileSync(path.join(directory,'page-1000.json'),JSON.stringify(pages));
  fs.writeFileSync(path.join(directory,'browser-observations.json'),JSON.stringify({samples:pages,transitions:[{site:'youtube',segment:0,action:'scrolled visible feed down one video',at:900,before:{...pages[0],expectedDuration:400,media:[{...a.media[0],duration:400}]}}]}));
  fs.writeFileSync(path.join(directory,'run-metadata.json'),JSON.stringify({sourceFingerprint:2}));
  assert.equal(analyze(directory).results[0].eligible.seconds,0);
  let callbackRows=0;
  analyze(directory,()=>{callbackRows++;});
  assert.equal(callbackRows,0,'callback must exclude wrong-source rows');
  fs.writeFileSync(path.join(directory,'run-metadata.json'),JSON.stringify({sourceFingerprint:1}));
  assert(analyze(directory).results[0].eligible.seconds>6);
  callbackRows=0;
  const callbackReport=analyze(directory,(site,segment,row)=>{
    assert.equal(site,'youtube');assert.equal(segment,1);assert.equal(row.tabId,1);callbackRows++;
  });
  assert.equal(callbackRows,Math.round(callbackReport.results[0].eligible.seconds*10),'callback must expose exactly scored rows');
  assert.equal(analyze(directory).results[0].title,'fixture','identify the verified programme, not a stale navigation frame');
  assert.equal(analyze(directory).results[0].url,'https://www.youtube.com/watch?v=fixture');
  assert.equal(analyze(directory).transitions.length,1,'normal feed scrolling is a switch action');
  fs.writeFileSync(path.join(directory,'run-metadata.json'),JSON.stringify({sourceFingerprint:1,dynamicsAmount:.92}));
  assert.equal(analyze(directory).results[0].eligible.seconds,0,'old effective policy cannot qualify');
  fs.writeFileSync(path.join(directory,'run-metadata.json'),JSON.stringify({sourceFingerprint:1,dynamicsAmount:.86}));
  assert(analyze(directory).results[0].eligible.seconds>6);
}finally{
  if(!path.resolve(directory).startsWith(temporaryRoot+path.sep))throw Error('Unsafe test cleanup');
  fs.rmSync(directory,{recursive:true});
}
console.log('PASS old-source rejection and matching-source eligibility');
