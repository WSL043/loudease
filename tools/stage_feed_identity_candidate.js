// Prepare the existing local development copy; browser reload remains manual.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const root = path.resolve(__dirname, '..');
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const target = path.join(root, 'dist/github-dev/content/bridge.js');
const before = fs.readFileSync(target);
const baseline = execFileSync('git', ['show', 'HEAD:content/bridge.js'], {cwd:root, encoding:'utf8'});
if (before.toString().replace(/\r\n/g,'\n') !== baseline.replace(/\r\n/g,'\n')) throw Error('Preserving unexpected developer bridge changes');
const after = fs.readFileSync(path.join(root, 'content/bridge.js'));
if (!after.toString().includes('function visibleProgrammeId(media)')) throw Error('Candidate missing');
const backup = path.join(root, 'tmp/transition-crest-candidate/pre-feed-stage-'+Date.now());
fs.mkdirSync(backup,{recursive:true});
fs.writeFileSync(path.join(backup,'bridge.js'),before);
fs.writeFileSync(target,after);
const evidence = {at:new Date().toISOString(),target,backup,beforeSha256:hash(before),sourceSha256:hash(after),
  note:'Prepared only. This bridge was NOT active in personal-quality-20260923-023611. Requires user reload and fresh real feed switching.'};
fs.writeFileSync(path.join(root,'tmp/transition-crest-candidate/feed-stage.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
