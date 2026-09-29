// Update only the previously verified disposable worklet; never reload Chrome.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {instrument}=require('./real_quality_meter');
const root=path.resolve(__dirname,'..');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function stage(){
  const previous=JSON.parse(fs.readFileSync(path.join(root,'tmp/personal-quality-stage.json'),'utf8'));
  const destination=path.join(root,'dist/github-dev');
  if(path.resolve(previous.destination)!==destination)throw Error('Unexpected staged build destination');
  for(const row of previous.files){
    const file=path.join(destination,row.name);
    if(!file.startsWith(destination+path.sep)||hash(fs.readFileSync(file))!==row.observedSha256)throw Error('Existing developer file changed: '+row.name);
    if(row.name!=='offscreen/leveler-worklet.js'&&hash(fs.readFileSync(path.join(root,row.name)))!==row.sourceSha256)throw Error('Unrelated runtime source changed: '+row.name);
  }
  const name='offscreen/leveler-worklet.js',source=fs.readFileSync(path.join(root,name),'utf8');
  if(!source.includes('&& rawInputPeak > this.previousInputFramePeak * PROGRAMME_JUMP_RATIO;'))throw Error('Candidate source missing');
  const generated=instrument(source),target=path.join(destination,name);
  const backup=path.join(root,'tmp/transition-crest-candidate/pre-stage-'+Date.now());
  fs.mkdirSync(backup,{recursive:true});
  fs.copyFileSync(target,path.join(backup,'leveler-worklet.js'));
  fs.copyFileSync(path.join(root,'tmp/personal-quality-stage.json'),path.join(backup,'personal-quality-stage.json'));
  fs.copyFileSync(path.join(destination,'manifest.json'),path.join(backup,'manifest.json'));
  fs.writeFileSync(target,generated);
  const record={at:new Date().toISOString(),destination,target,backup,sourceSha256:hash(source),observedSha256:hash(generated),note:'Prepared only; user must reload and explicitly recapture. No browser settings or permissions changed.'};
  fs.writeFileSync(path.join(root,'tmp/transition-crest-candidate/stage.json'),JSON.stringify(record,null,2));
  console.log(JSON.stringify(record,null,2));
}
if(require.main===module)stage();
module.exports={stage};
