const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../content/bridge.js'), 'utf8');
function fixture(host = 'www.douyin.com') {
  const context = vm.createContext({ URL, location: { hostname: host, href: `https://${host}/` },
    NodeFilter: { SHOW_ELEMENT: 1 }, document: { createTreeWalker(container) {
      let i = 0; return { nextNode: () => container.nodes[i++] || null };
    } } });
  // Exercise the production functions, with only the browser DOM represented by a fixture.
  const functions = source.slice(source.indexOf('  function mediaSourceKind('), source.indexOf('  function mediaDetail('));
  const audible = source.slice(source.indexOf('  function isAudible('), source.indexOf('  function isActiveMedia('));
  vm.runInContext(`const programmeIds = new WeakMap(); let lastProgrammeHref=''; let lastProgrammeKey='';
    function text(x,n){return String(x||'').slice(0,n)}
    function finiteNumber(x,f){return Number.isFinite(Number(x))?Number(x):f}
    ${functions}\n${audible}`, context);
  return { key: media => context.programmeKey(media), identity: media => context.programmeSourceIdentity(media) };
}
const link = (id, host = 'www.douyin.com') => ({ tagName: 'A', getAttribute: () => `https://${host}/search/test?aweme_id=${id}` });
const container = { nodes: [link('7666402893032963057')] };
const media = { currentSrc: 'blob:first', paused: false, ended: false, muted: false, volume: .44, readyState: 4,
  closest: selector => { assert.equal(selector, '.basePlayerContainer'); return container; } };
const f = fixture();
const first = f.key([media]);
assert(!first.includes('7666402893032963057'), 'status exports only a hash');
media.currentSrc = 'blob:rotated'; assert.equal(f.key([media]), first, 'opaque source churn is not a programme boundary');
container.nodes = []; assert.equal(f.key([media]), first, 'temporary link disappearance retains identity');
container.nodes = [link('7666402893032963057'), link('7666402893032963058')];
assert.equal(f.key([media]), first, 'conflicting evidence retains identity');
container.nodes = [link('7666402893032963058')];
const second = f.key([media]); assert.notEqual(second, first, 'real feed video switch changes programme');
container.nodes = [link('7666402893032963059', 'evil.example')];
assert.equal(f.key([media]), second, 'foreign links cannot redefine programme');
container.nodes = [link('bad')]; assert.equal(f.key([media]), second, 'invalid identifiers ignored');
container.nodes = [link('7666402893032963059'), ...Array.from({length: 801}, () => ({ tagName: 'DIV' }))];
assert.equal(f.key([media]), second, 'truncated scan is not trusted');
const helper = { ...media, muted: true, closest: () => ({ nodes: [link('7666402893032963059')] }) };
assert.equal(f.key([media, helper]), second, 'muted helper excluded');
helper.muted = false; helper.volume = 0; assert.equal(f.key([media, helper]), second, 'zero volume helper excluded');
const other = fixture('www.youtube.com'); assert.equal(other.identity(media), 'blob:', 'other platforms retain opaque source normalization');
const absent = { ...media, closest: () => null }; assert.equal(f.identity(absent), 'blob:', 'missing container keeps original behavior');
console.log('PASS production programme identity: real switch, source churn, missing/conflicting/untrusted/bounded evidence, helpers, other sites');
