// Attribute existing numeric telemetry without reading or reconstructing PCM.
const fs=require('fs');
const path=require('path');
const readline=require('readline');
const {bracketPlaying,independentCap}=require('./analyze_personal_quality');
async function diagnose(directory){
  const analysis=JSON.parse(fs.readFileSync(path.join(directory,'analysis.json'),'utf8'));
  const pages=fs.readdirSync(directory).filter(n=>/^page-\d+\.json$/.test(n)).flatMap(n=>JSON.parse(fs.readFileSync(path.join(directory,n),'utf8'))).sort((a,b)=>a.observedAt-b.observedAt);
  const groups=analysis.results.map(r=>({site:r.site,segment:r.segment,tabId:r.tabId,start:r.start,end:r.end,pages:pages.filter(p=>p.site===r.site&&p.segment===r.segment-1),states:0,liftingStates:0,transitionStates:0,liftingTransitionStates:0,limiterDb:[]}));
  const stream=fs.createReadStream(path.join(directory,'status.jsonl'));
  const lines=readline.createInterface({input:stream,crlfDelay:Infinity});
  try{for await(const line of lines){
    if(!line.trim())continue;
    const status=JSON.parse(line),at=status._receivedAt;
    if(at>Math.max(...groups.map(g=>g.end))+3500)break;
    for(const g of groups){
      if(at<g.start||at>g.end)continue;
      const pi=g.pages.findIndex((p,i)=>i+1<g.pages.length&&at>=p.observedAt&&at<=g.pages[i+1].observedAt);
      if(pi<0||!bracketPlaying(g.pages[pi],g.pages[pi+1],at))continue;
      const tab=status.tabs.find(t=>t.tabId===g.tabId);
      if(!tab?.captureActive||!tab.captureDspLive||tab.startupGateOpen!==true)continue;
      const cap=tab.playerVolumeKnown?tab.playerVolumeCap:independentCap(g.pages[pi],g.pages[pi+1]);
      if(!(cap>0)||!Number.isFinite(tab.effectiveLimiterCeilingDb))continue;
      g.states++;
      const lifting=tab.currentGainDb>.01;
      const transition=tab.effectiveLimiterCeilingDb-20*Math.log10(cap)<=-13+.01;
      if(lifting)g.liftingStates++;
      if(transition)g.transitionStates++;
      if(lifting&&transition)g.liftingTransitionStates++;
      g.limiterDb.push(tab.limiterReductionDb);
    }
  }}finally{lines.close();stream.destroy();}
  return {scope:'Periodic status observations of advancing programme; not the 10Hz scored rows, not causal proof or PCM replay',results:groups.map(({pages,limiterDb,...g})=>({...g,transitionPercent:g.states?100*g.transitionStates/g.states:null,transitionWhileLiftingPercent:g.liftingStates?100*g.liftingTransitionStates/g.liftingStates:null}))};
}
if(require.main===module){const directory=process.argv[2];if(!directory)throw Error('Specify recorded run directory');diagnose(directory).then(r=>{fs.writeFileSync(path.join(directory,'transition-diagnosis.json'),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));}).catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={diagnose};
