const assert=require('assert/strict');
const {advancingNewVideo}=require('./real_site_transition');
const state=(time,title='new',duration=200)=>({url:'https://www.douyin.com/video/123',title,media:[{paused:false,muted:false,volume:0.5,readyState:4,currentTime:time,duration}]});
const before=state(120,'old',288);
assert.equal(advancingNewVideo(before,state(120,'old',288),state(121,'old',288),before.url),false,'new URL alone cannot prove a new video');
assert.equal(advancingNewVideo(before,state(0.4),state(0.9),before.url),true);
assert.equal(advancingNewVideo(before,state(0.9),state(0.9),before.url),false,'must advance');
assert.equal(advancingNewVideo(before,state(0.4,'old',288),state(0.9,'old',288),before.url),false,'same metadata is ambiguous');
console.log('PASS reject stale video after SPA URL update and require advancing new media');
