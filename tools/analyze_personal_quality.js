const fs = require('fs');
const path = require('path');
const { summary } = require('./analyze_real_quality');
const quantile = (a,q) => a.length ? [...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*q)] : null;
const active = page => page?.media?.filter(m=>m.visible!==false&&!m.paused&&!m.muted&&!m.ended&&m.readyState>=2&&m.duration>=120&&(!Number.isFinite(page.expectedDuration)||Math.abs(m.duration-page.expectedDuration)<.2)) || [];
function bracketPlaying(a,b,time) {
  if (!a || !b || a.segment!==b.segment || time<a.observedAt || time>b.observedAt || b.observedAt-a.observedAt>15000) return false;
  const am=active(a), bm=active(b);
  if(am.length!==1||bm.length!==1||Math.abs(am[0].duration-bm[0].duration)>0.2) return false;
  const elapsed=(b.observedAt-a.observedAt)/1000, progress=bm[0].currentTime-am[0].currentTime;
  return progress>0 && Math.abs(progress-elapsed)<Math.max(2,elapsed*0.2);
}
function independentCap(a,b) {
  if (!a?.independentVolumeEvidence || !b?.independentVolumeEvidence) return null;
  const x=active(a),y=active(b);
  if(x.length!==1||y.length!==1)return null;
  const v=x[0].volume;
  return Number.isFinite(v)&&v>0&&v<=1&&Math.abs(v-y[0].volume)<1e-6?v:null;
}
function analyze(directory, onEligible) {
  const loadLines=name=>fs.readFileSync(path.join(directory,name),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const rows=loadLines('quality.jsonl').flatMap(x=>x.rows);
  const statuses=loadLines('status.jsonl');
  const metadataFile=path.join(directory,'run-metadata.json');
  const metadata=fs.existsSync(metadataFile)?JSON.parse(fs.readFileSync(metadataFile,'utf8')):{};
  const pages=fs.readdirSync(directory).filter(n=>/^page-\d+\.json$/.test(n)).flatMap(n=>JSON.parse(fs.readFileSync(path.join(directory,n),'utf8'))).sort((a,b)=>a.observedAt-b.observedAt);
  const browserFile=path.join(directory,fs.existsSync(path.join(directory,'browser-observations-final.json'))?'browser-observations-final.json':'browser-observations.json');
  const browser=fs.existsSync(browserFile)?JSON.parse(fs.readFileSync(browserFile,'utf8')):{samples:pages,transitions:[]};
  const results=[];
  for(const site of ['youtube','bilibili','douyin']) {
    if(!pages.some(p=>p.site===site))continue;
    const tabId=pages.find(p=>p.site===site).tabId;
    const all=rows.filter(r=>r.tabId===tabId).sort((a,b)=>a.receivedAt-b.receivedAt);
    let resetKey='', warmupUntil=-Infinity, gapUntil=-Infinity, prior=null;
    const tagged=all.map(r=>{
      const key=[r.sessionId,r.resetCount,r.cap].join(':');
      if(key!==resetKey){resetKey=key;warmupUntil=r.audioSeconds+3;}
      const gap=prior&&prior.sessionId===r.sessionId&&(r.sequence!==prior.sequence+1||r.audioSeconds-prior.audioSeconds>0.151);
      if(gap)gapUntil=r.audioSeconds+3;
      const item={...r,warmup:r.audioSeconds<warmupUntil,afterGap:r.audioSeconds<gapUntil};prior=r;return item;
    });
    for(const segment of [...new Set(pages.filter(p=>p.site===site).map(p=>p.segment))].sort((a,b)=>a-b)) {
      const pp=pages.filter(p=>p.site===site&&p.segment===segment);
      const start=pp[0].observedAt,end=pp.at(-1).observedAt;
      const selected=tagged.filter(r=>r.receivedAt>=start&&r.receivedAt<=end);
      const eligible=[],excluded={pageUnverified:0,statusUnverified:0,warmup:0,afterGap:0,volume:0,nearSilence:0,wrongSource:0,wrongPolicy:0};
      let pi=0,si=0,externalSince=null,externalPrevious=null;
      for(const r of selected){
        if(Number.isFinite(metadata.sourceFingerprint)&&r.sourceFingerprint!==metadata.sourceFingerprint){excluded.wrongSource++;continue;}
        if(Number.isFinite(metadata.dynamicsAmount)&&(!Number.isFinite(r.dynamicsAmount)||Math.abs(r.dynamicsAmount-metadata.dynamicsAmount)>1e-9)){excluded.wrongPolicy++;continue;}
        while(pi+1<pp.length&&pp[pi+1].observedAt<r.receivedAt)pi++;
        if(!bracketPlaying(pp[pi],pp[pi+1],r.receivedAt)){excluded.pageUnverified++;continue;}
        while(si+1<statuses.length&&statuses[si+1]._receivedAt<=r.receivedAt)si++;
        const status=statuses[si],tab=status?.tabs.find(t=>t.tabId===tabId);
        if(!status||r.receivedAt-status._receivedAt<0||r.receivedAt-status._receivedAt>3500||!tab?.captureActive||!tab?.captureDspLive||tab.startupGateOpen!==true||tab.silentSink===true||tab.captureContextState!=='running'){excluded.statusUnverified++;continue;}
        if(r.warmup){excluded.warmup++;continue;}
        if(r.afterGap){excluded.afterGap++;continue;}
        const direct=independentCap(pp[pi],pp[pi+1]);
        if(r.reliable&&direct!==null&&Math.abs(direct-r.cap)>1e-6){excluded.volume++;continue;}
        const cap=r.reliable?r.cap:direct;
        if(!r.reliable&&direct!==null){
          if(!externalPrevious||externalPrevious.cap!==direct||r.receivedAt-externalPrevious.at>151)externalSince=r.receivedAt;
          externalPrevious={cap:direct,at:r.receivedAt};
          if(r.receivedAt-externalSince<3000){excluded.warmup++;continue;}
        }
        if(r.muted||!(cap>0)){excluded.volume++;continue;}
        const vdb=20*Math.log10(cap),input=r.shortTerm[0]-vdb,output=r.shortTerm[1]-vdb;
        if(input < -45){excluded.nearSilence++;continue;}
        const measured={...r,input,output,normalizationCap:cap,directVolumeVerified:direct!==null,volumeSource:r.reliable?'extension':'independent-page-observation'};
        eligible.push(measured);
        if (onEligible) onEligible(site,segment+1,measured);
      }
      const ss=statuses.filter(s=>s._receivedAt>=start&&s._receivedAt<=end).map(s=>s.tabs.find(t=>t.tabId===tabId)).filter(Boolean);
      const steady=[];let recent=[];
      for(const r of eligible){recent=recent.filter(x=>r.audioSeconds-x.audioSeconds<=3);recent.push(r);
        if(recent.length>=29&&r.confidence>=0.99&&recent.every((x,i)=>!i||x.sequence===recent[i-1].sequence+1)&&Math.max(...recent.map(x=>x.input))-Math.min(...recent.map(x=>x.input))<=2)steady.push(r);}
      let gaps=0;for(let i=1;i<selected.length;i++)gaps+=Math.max(0,selected[i].sequence-selected[i-1].sequence-1);
      const runs=[];let run=null;
      for(const r of eligible){const side=r.output<r.targetDb-2?'below':r.output>r.targetDb+2?'above':'inside';
        if(side==='inside'){if(run)runs.push(run);run=null;continue;}
        if(!run||run.side!==side||r.sequence!==run.lastSequence+1){if(run)runs.push(run);run={side,seconds:0,worstErrorDb:0};}
        run.seconds+=0.1;run.lastSequence=r.sequence;if(Math.abs(r.output-r.targetDb)>Math.abs(run.worstErrorDb))run.worstErrorDb=r.output-r.targetDb;
      }if(run)runs.push(run);
      const identifiedPage=pp.find(p=>active(p).length===1)||pp[0];
      results.push({site,segment:segment+1,tabId,title:identifiedPage.observedVideoTitle||identifiedPage.title,url:identifiedPage.url,observedVideoId:pp.find(p=>active(p).length===1&&p.observedVideoId)?.observedVideoId||null,
        start,end,wallSeconds:(end-start)/1000,records:selected.length,sequenceGaps:gaps,
        droppedAtStart:selected[0]?.transportDropped,droppedAtEnd:selected.at(-1)?.transportDropped,
        audioSessionIds:[...new Set(selected.map(r=>r.sessionId))],sampleRates:[...new Set(selected.map(r=>r.sampleRate))],
        excludedSeconds:Object.fromEntries(Object.entries(excluded).map(([k,v])=>[k,Math.round(v*10)/100])),
        coverage:eligible.length>=600?'at-least-60s-eligible':'insufficient',eligible:summary(eligible),steady:summary(steady),
        independentlyVerifiedVolumeSeconds:eligible.filter(r=>r.volumeSource==='independent-page-observation').length*.1,
        directPageVolumeObservationSeconds:eligible.filter(r=>r.directVolumeVerified).length*.1,
        normalizationCaps:[...new Set(eligible.map(r=>r.normalizationCap))],
        sourceFingerprints:[...new Set(eligible.map(r=>r.sourceFingerprint).filter(Number.isFinite))],
        dynamicsAmounts:[...new Set(eligible.map(r=>r.dynamicsAmount).filter(Number.isFinite))],
        programmeResetCounts:[...new Set(eligible.map(r=>r.resetCount))],
        transitionProtectedPercent:eligible.length&&eligible.every(r=>typeof r.transitionProtected==='boolean')?100*eligible.filter(r=>r.transitionProtected).length/eligible.length:null,
        quiet:summary(eligible.filter(r=>r.input<-25)),ordinary:summary(eligible.filter(r=>r.input>=-25&&r.input<=-17)),loud:summary(eligible.filter(r=>r.input>-17)),
        gainP10:quantile(eligible.map(r=>r.gainDb),.1),gainP50:quantile(eligible.map(r=>r.gainDb),.5),gainP90:quantile(eligible.map(r=>r.gainDb),.9),
        programmeP50:quantile(eligible.map(r=>r.programmeDb).filter(Number.isFinite),.5),
        targetGainP50:quantile(eligible.map(r=>r.targetGainDb).filter(Number.isFinite),.5),
        gainLagP50:quantile(eligible.map(r=>r.targetGainDb-r.gainDb).filter(Number.isFinite),.5),
        belowBandWithLittleInstantLimitingPercent:eligible.length?100*eligible.filter(r=>r.output<r.targetDb-2&&r.limiterReductionDb<.1).length/eligible.length:null,
        limiterP50:quantile(eligible.map(r=>r.limiterReductionDb),.5),limiterP90:quantile(eligible.map(r=>r.limiterReductionDb),.9),
        outputP10:quantile(eligible.map(r=>r.output),.1),outputP90:quantile(eligible.map(r=>r.output),.9),
        hardClippedMax:Math.max(0,...ss.map(s=>s.workletHardClippedSamples||0)),
        allStatusSamplesActive:ss.length>0&&ss.every(s=>s.captureActive&&s.captureDspLive),
        longExcursions:runs.filter(r=>r.seconds>=3).sort((a,b)=>b.seconds-a.seconds).slice(0,5)});
    }
  }
  const transitions=browser.transitions.filter(t=>['youtube','bilibili','douyin'].includes(t.site)&&Number.isInteger(t.segment)&&Number.isFinite(t.at)&&t.before).map(t=>{
    const observations=browser.samples.filter(p=>p.site===t.site&&p.segment===t.segment&&p.observedAt>=t.at);
    const old=active(t.before)[0];
    const valid=observations.filter(p=>active(p).length===1&&(!old||Math.abs(active(p)[0].duration-old.duration)>.2));
    let confirmed=null;
    for(let i=1;i<valid.length;i++)if(active(valid[i])[0].currentTime>active(valid[i-1])[0].currentTime){confirmed=valid[i];break;}
    const meters=rows.filter(r=>r.tabId===t.before?.tabId&&r.receivedAt>=t.at&&r.receivedAt<=t.at+30000);
    const post=rows.filter(r=>r.tabId===t.before?.tabId&&confirmed&&r.receivedAt>=confirmed.observedAt&&r.receivedAt<=confirmed.observedAt+15000);
    let bandStart=null,firstBand=null,prev=null;
    for(const r of post){const inBand=r.reliable&&!r.muted&&r.cap>0&&Math.abs(r.momentary[1]-20*Math.log10(r.cap)-r.targetDb)<=2;
      if(!inBand||prev&&r.sequence!==prev.sequence+1)bandStart=null;
      if(inBand){if(bandStart===null)bandStart=r.audioSeconds;if(r.audioSeconds-bandStart>=.9){firstBand=r.receivedAt;break;}}prev=r;}
    return {site:t.site,toSegment:t.segment+1,action:t.action,at:t.at,
      firstObservedNewPlayingMs:valid[0]?valid[0].observedAt-t.at:null,
      confirmedAdvancingByMs:confirmed?confirmed.observedAt-t.at:null,
      firstOneSecondBandAfterConfirmationMs:firstBand===null?null:firstBand-confirmed.observedAt,
      sameCaptureSessionInFirst30s:new Set(meters.map(r=>r.sessionId)).size===1,
      note:'Readiness times are observation upper bounds including ads/manual play; first band interval is not settling.'};
  });
  return {generatedAt:new Date().toISOString(),directory,protocol:{targetDb:-19,toleranceDb:2,
    meter:'internal approximate K-weighted channel-mean input/output; not certified LUFS',
    eligibility:'two matching advancing visible-media observations <=15s apart; live capture status <=3.5s old; extension volume or independently read matching HTMLMediaElement.volume at both page observations; warmup/gap exclusion 3s; input >=-45dB',
    limitation:'10s page sampling cannot exclude every shorter pause; simultaneous independent tab captures are not a listening test'},results,transitions};
}
if(require.main===module){const directory=process.argv[2]||JSON.parse(fs.readFileSync(path.resolve(__dirname,'../tmp/personal-quality-current.json'),'utf8')).directory;
 const report=analyze(directory);fs.writeFileSync(path.join(directory,'analysis.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report.results.map(r=>({site:r.site,segment:r.segment,seconds:r.eligible.seconds,inBand:r.eligible.inBandPercent,input:r.eligible.inputMedianDb,output:r.eligible.outputMedianDb,gaps:r.sequenceGaps,coverage:r.coverage,excluded:r.excludedSeconds})),null,2));}
module.exports={analyze,bracketPlaying,independentCap};
