const fs = require('fs');
const { advancingNewVideo } = require('./real_site_transition');
const quantile = (values, q) => {
  if (!values.length) return null;
  const a = [...values].sort((x,y)=>x-y);
  return a[Math.floor((a.length-1)*q)];
};
function summary(rows) {
  if (!rows.length) return { seconds:0, count:0 };
  const errors = rows.map(x=>x.output-x.targetDb);
  const energyMean = key => 10*Math.log10(rows.reduce((sum,r)=>sum+10**(r[key]/10),0)/rows.length);
  const percentages = fn => 100*rows.filter(fn).length/rows.length;
  return { seconds: rows.length*0.1, count:rows.length,
    inputEnergyMeanDb:energyMean('input'), outputEnergyMeanDb:energyMean('output'),
    inputMedianDb:quantile(rows.map(x=>x.input),0.5), outputMedianDb:quantile(rows.map(x=>x.output),0.5),
    errorP10Db:quantile(errors,0.1),errorMedianDb:quantile(errors,0.5),errorP90Db:quantile(errors,0.9),
    inBandPercent: percentages(x=>Math.abs(x.output-x.targetDb)<=2),
    belowBandPercent: percentages(x=>x.output<x.targetDb-2),
    aboveBandPercent: percentages(x=>x.output>x.targetDb+2),
    limiterOver3DbPercent:percentages(x=>x.limiterReductionDb>3),
    maximumSamplePeak:Math.max(...rows.map(x=>x.peaks[1])) };
}
function analyze(data) {
  for(const row of data.measurements) {
    if(!Array.isArray(row.shortTerm)||!Array.isArray(row.momentary)||!row.shortTerm.every(Number.isFinite)||!row.momentary.every(Number.isFinite)||!Number.isFinite(row.targetDb)) throw new Error('Invalid measurement; refusing to score');
  }
  const segments=[];
  for(let segment=0;segment<3;segment++) {
    const all=data.measurements.filter(x=>x.segment===segment&&x.atMs>=0);
    const samples=data.samples.filter(x=>x.segment===segment);
    let lastReset=null, resetTime=-Infinity, lastCap=null, capTime=-Infinity;
    const eligible=[], steady=[], excluded={warmup:0,unknownVolume:0,quiet:0,notPlaying:0};
    let sampleIndex=0;
    for(const row of all) {
      if(row.resetCount!==lastReset){lastReset=row.resetCount;resetTime=row.audioSeconds;}
      if(row.cap!==lastCap){lastCap=row.cap;capTime=row.audioSeconds;}
      while(sampleIndex+1<samples.length&&samples[sampleIndex+1].atMs<=row.atMs)sampleIndex++;
      const page=samples[sampleIndex]?.media;
      if(row.audioSeconds-Math.max(resetTime,capTime)<3){excluded.warmup++;continue;}
      if(!row.reliable||row.muted||!(row.cap>0)){excluded.unknownVolume++;continue;}
      if(!page?.media?.some(m=>!m.paused&&!m.muted&&m.volume>0&&m.readyState>=2)){excluded.notPlaying++;continue;}
      const volumeDb=20*Math.log10(row.cap);
      const r={...row,input:row.shortTerm[0]-volumeDb,output:row.shortTerm[1]-volumeDb};
      if(r.input < -45){excluded.quiet++;continue;}
      eligible.push(r);
      // Signal steadiness proxy, not a speech/music or foreground classifier.
      const recent=eligible.filter(x=>r.audioSeconds-x.audioSeconds<=3);
      if(recent.length>=29&&r.confidence>=0.99&&Math.max(...recent.map(x=>x.input))-Math.min(...recent.map(x=>x.input))<=2)steady.push(r);
    }
    const runs=[];
    let run=null;
    for(const row of eligible) {
      const direction=row.output<row.targetDb-2?'below':row.output>row.targetDb+2?'above':'inside';
      if(direction==='inside'){if(run)runs.push(run);run=null;continue;}
      if(!run||run.direction!==direction||row.audioSeconds-run.lastAudioSeconds>0.15){if(run)runs.push(run);run={direction,startMs:row.atMs,lastAudioSeconds:row.audioSeconds,seconds:0,worstErrorDb:0};}
      run.seconds+=0.1;run.lastAudioSeconds=row.audioSeconds;
      if(Math.abs(row.output-row.targetDb)>Math.abs(run.worstErrorDb))run.worstErrorDb=row.output-row.targetDb;
    }
    if(run)runs.push(run);
    const resetBefore = segment ? data.transitions[segment-1]?.beforeStatus?.loudnessResetCount : -1;
    const attackRows=all.filter(r=>r.resetCount>resetBefore && r.reliable && !r.muted && r.cap>0 && r.momentary[0]-20*Math.log10(r.cap)>-45);
    let bandStart=null, firstBandEnd=null, previousAudio=-Infinity;
    for(const row of attackRows){
      const error=row.momentary[1]-20*Math.log10(row.cap)-row.targetDb;
      if(Math.abs(error)>2||row.audioSeconds-previousAudio>0.15)bandStart=null;
      if(Math.abs(error)<=2){if(bandStart==null)bandStart=row.audioSeconds;if(row.audioSeconds-bandStart>=0.9){firstBandEnd=row.audioSeconds;break;}}
      previousAudio=row.audioSeconds;
    }
    segments.push({segment,title: segment===0?samples[0]?.media?.title:data.transitions[segment-1]?.afterMedia?.title,
      coverage:eligible.length>=600?'at-least-60s-eligible':'limited-under-60s-eligible',
      measuredSeconds:all.length*0.1,excluded,eligible:summary(eligible),steady:summary(steady),
      firstOneSecondMomentaryBandCompletedAfterActiveSeconds:firstBandEnd==null?null:firstBandEnd-attackRows[0].audioSeconds,
      inputGroups:{quiet:summary(eligible.filter(x=>x.input<-25)),ordinary:summary(eligible.filter(x=>x.input>=-25&&x.input<=-17)),loud:summary(eligible.filter(x=>x.input>-17))},
      longExcursions:runs.filter(x=>x.seconds>=3).sort((a,b)=>b.seconds-a.seconds).slice(0,8),
      transition: segment?data.transitions[segment-1]?.playbackReadyMs:null});
  }
  const verifiedTransitions=(data.transitions||[]).map((t,i)=>{
    const observations=data.samples.filter(s=>s.segment===i+1&&s.atMs>=t.atMs);
    const index=observations.findIndex((s,j)=>j>0&&advancingNewVideo(t.from,observations[j-1].media,s.media,t.link.href));
    return {declaredReadyMs:t.playbackReadyMs??null,verifiedAdvancingPlaybackMs:index<0?null:observations[index].atMs-t.atMs,title:index<0?null:observations[index].media.title};
  });
  verifiedTransitions.forEach((t,i)=>{
    if(t.title)segments[i+1].title=t.title;
    segments[i+1].transition=t.verifiedAdvancingPlaybackMs;
  });
  return {source:data.generatedAt,continuityPassed:data.passed,continuityFailures:data.failures.length,error:data.error||null,verifiedTransitions,
    protocol:{targetDb:-19,toleranceDb:2,windowSeconds:3,reportSeconds:0.1,volume:'normalize both sides to unity using reliable cap',inputFloorDb:-45,warmupSeconds:3,steadyDefinition:'3 seconds of short-term input varying <=2 dB, confidence>=0.99',scope:'energy-based screen, not speech classification or certified LUFS; unknown-volume and paused windows excluded explicitly'},segments};
}
if(require.main===module){
  const file=process.argv[2];
  if(!file)throw new Error('Supply a local real-quality report');
  const report=analyze(JSON.parse(fs.readFileSync(file,'utf8')));
  const output=file.replace(/\.json$/,'.analysis.json');
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
module.exports={analyze,summary};
