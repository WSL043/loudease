const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const background = read('background.js');
const popup = read('popup/index.js');
const bridge = read('content/bridge.js');

const checks = [
  ['background has separate site settings storage', /const SITE_SETTINGS_KEY = 'webVolumeBalancer\.siteSettings';/.test(background)],
  ['background derives stable http hostname keys', /function siteKeyFromUrl\(url\)/.test(background) && /replace\(\^?\/\^www\\\.\//.test(background.replace(/\s+/g, ' '))],
  ['background merges global settings with site override', /async function readSettingsForUrl\(tabUrl = ''\)/.test(background) && /\.\.\.\(siteSettings\[siteKey\] \|\| \{\}\)/.test(background)],
  ['background stores preset strength and target loudness in site scope', /function siteScopedSettings\(input = \{\}\)/.test(background) && /preset: normalized\.preset/.test(background) && /cutStrength: normalized\.cutStrength/.test(background) && /liftStrength: normalized\.liftStrength/.test(background) && /targetLoudnessDb: normalized\.targetLoudnessDb/.test(background)],
  ['tab capture starts with effective settings for the tab url', /nextSettings: await readSettingsForUrl\(tabUrl\)/.test(background)],
  ['settings reads use message or sender tab url', /settingsPayload\(String\(message\.tabUrl \|\| sender\.tab\?\.url \|\| ''\)\)/.test(background)],
  ['settings writes accept site scoped and global only flags', /siteScoped: message\.siteScoped === true/.test(background) && /globalOnly: message\.globalOnly === true/.test(background)],
  ['popup loads settings after active tab url is known', /await findActiveTab\(\);\s*const payload = await message\(\{ type: 'WVB_GET_SETTINGS', tabUrl: activeTabUrl \}\)/.test(popup)],
  ['popup preserves site scope metadata from effective settings', /siteScoped: input\.siteScoped === true/.test(popup) && /siteKey: input\.siteKey \|\| ''/.test(popup)],
  ['popup strength edits stay site-scoped only for an existing override', /function strengthSaveOptions\(\)[\s\S]*?siteScoped: settings\?\.siteScoped === true/.test(popup) && /schedulePersistSettings\(strengthSaveOptions\(\)\)/.test(popup)],
  ['popup keeps the same explicit scope when the range gesture commits', /dial\.input\.addEventListener\('change',[\s\S]*?flushPersistSettings\(strengthSaveOptions\(\)\)/.test(popup)],
  ['popup does not create a site override merely by touching a slider', !/schedulePersistSettings\(\{ siteScoped: true \}\)/.test(popup) && !/flushPersistSettings\(\{ siteScoped: true \}\)/.test(popup)],
  ['popup preserves scope metadata when save responses omit it', /normalizeSettings\(\{ \.\.\.snapshot, \.\.\.\(payload \|\| \{\}\) \}\)/.test(popup) && /normalizeSettings\(\{ \.\.\.next, \.\.\.\(payload \|\| \{\}\) \}\)/.test(popup)],
  ['popup serializes strength writes and ignores stale responses', /persistQueue = persistQueue/.test(popup) && /revision === settingsRevision/.test(popup)],
  ['popup keeps enabled and player safety global', /enabled: elements\.enabled\.checked \}, \{ globalOnly: true \}/.test(popup) && /respectPlayerVolume: elements\.respectPlayerVolume\.checked \}, \{ globalOnly: true \}/.test(popup)],
  ['bridge refreshes effective settings when global or site storage changes', /SITE_SETTINGS_KEY/.test(bridge) && /changes\[STORAGE_KEY\] \|\| changes\[SITE_SETTINGS_KEY\]/.test(bridge) && /syncSettings\(\)/.test(bridge)]
];

let failed = false;
for (const [name, pass] of checks) {
  if (pass) {
    console.log(`OK   ${name}`);
  } else {
    console.error(`FAIL ${name}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
