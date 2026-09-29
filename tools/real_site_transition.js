function canonical(raw) {
  try {
    const u=new URL(raw);
    if(u.hostname.endsWith('youtube.com')&&u.pathname==='/watch'&&u.searchParams.has('v'))return `${u.origin}/watch?v=${u.searchParams.get('v')}`;
    const m=u.pathname.match(/^\/video\/(BV\w+|\d+)/);
    return m?`${u.origin}/video/${m[1]}`:'';
  } catch (_) { return ''; }
}
function advancingNewVideo(before, previous, current, expected) {
  if(!previous||canonical(previous.url)!==canonical(expected)||canonical(current?.url)!==canonical(expected))return false;
  const playing=m=>!m.paused&&!m.muted&&m.volume>0&&m.readyState>=2&&m.currentTime>0.2&&m.currentTime<10;
  return (current.media||[]).some(m=>playing(m)
    && (previous.media||[]).some(p=>playing(p)&&p.duration===m.duration&&m.currentTime>p.currentTime)
    && (current.title!==before.title || !(before.media||[]).some(p=>p.duration===m.duration)));
}
module.exports={canonical,advancingNewVideo};
