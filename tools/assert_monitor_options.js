const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const background = read('background.js');
const monitorHtml = read('monitor/index.html');
const monitorJs = read('monitor/index.js');

const requiredIds = [
  'localDiagnostics',
  'siteForm',
  'siteKey',
  'siteCut',
  'siteLift',
  'siteList',
  'saveSite',
  'deleteSite',
  'resetSettings',
  'downloadJson'
];

const checks = [
  ['background validates site keys before options writes', /function normalizeSiteKey\(input = ''\)/.test(background) && /\/\[\^a-z0-9\.-\]\//.test(background)],
  ['background exposes options state without injection side effects', /WVB_GET_OPTIONS_STATE/.test(background) && /async function optionsState\(\)/.test(background)],
  ['background supports site save delete reset and local diagnostics messages', ['WVB_SAVE_SITE_SETTINGS', 'WVB_DELETE_SITE_SETTINGS', 'WVB_RESET_SETTINGS', 'WVB_SET_LOCAL_DIAGNOSTICS'].every((type) => background.includes(type))],
  ['options reset applies defaults and clears site settings', /resetAllSettingsFromOptions/.test(background) && /\[STORAGE_KEY\]: normalizeSettings\(DEFAULT_SETTINGS\)/.test(background) && /\[SITE_SETTINGS_KEY\]: \{\}/.test(background)],
  ['monitor options DOM has all required controls', requiredIds.every((id) => monitorHtml.includes(`id="${id}"`))],
  ['monitor saves only custom strength overrides for each site', /type: 'WVB_SAVE_SITE_SETTINGS'/.test(monitorJs) && /preset: 'custom'/.test(monitorJs) && /cutStrength: clampPercent\(els\.siteCut\.value\)/.test(monitorJs) && /liftStrength: clampPercent\(els\.siteLift\.value\)/.test(monitorJs)],
  ['monitor exposes synchronized locale and theme preferences', ['languageSelect', 'themeSelect'].every((id) => monitorHtml.includes(`id="${id}"`)) && /uiPreferences\.save/.test(monitorJs) && /initializeI18n/.test(monitorJs)],
  ['monitor separates general site and diagnostic views', ['general', 'sites', 'diagnostics'].every((view) => monitorHtml.includes(`data-view="${view}"`)) && /function switchView/.test(monitorJs)],
  ['monitor can delete site defaults and reset global settings', /type: 'WVB_DELETE_SITE_SETTINGS'/.test(monitorJs) && /type: 'WVB_RESET_SETTINGS'/.test(monitorJs)],
  ['monitor can toggle local diagnostics and export diagnostics', /type: 'WVB_SET_LOCAL_DIAGNOSTICS'/.test(monitorJs) && /new Blob\(\[JSON\.stringify\(supportReport\(lastSnapshot\), null, 2\)\]/.test(monitorJs)],
  ['support reports redact URLs paths and unknown site identities', /\[url removed\]/.test(monitorJs) && /\[path removed\]/.test(monitorJs) && /siteCategory/.test(monitorJs) && !/origin: \(\(\) =>/.test(monitorJs)]
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
