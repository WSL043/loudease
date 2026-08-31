const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const popupHtml = read('popup/index.html');
const popupJs = read('popup/index.js');
const popupCss = read('popup/index.css');
const monitorHtml = read('monitor/index.html');
const monitorCss = read('monitor/index.css');
const helper = read('shared/i18n.js');
const locales = ['en', 'zh_CN', 'zh_TW', 'ja', 'ko', 'es', 'pt_BR', 'de', 'fr', 'ru', 'ar'];
const catalogs = Object.fromEntries(locales.map((locale) => [locale, JSON.parse(read(`_locales/${locale}/messages.json`))]));
const englishKeys = Object.keys(catalogs.en).sort();
const placeholders = (message = '') => (message.match(/\$\d+/g) || []).sort();

const checks = [
  ['English is the static popup and monitor default', /<html lang="en" dir="ltr">/.test(popupHtml) && /<html lang="en" dir="ltr">/.test(monitorHtml) && !/[\u3400-\u9fff]/u.test(popupHtml)],
  ['popup runtime copy has no hard-coded Han text outside locale catalogs', !/[\u3400-\u9fff]/u.test(popupJs)],
  ['popup has no visible preset or mode bar', !/presetBar|presetButton|data-preset/i.test(popupHtml)],
  ['popup has exactly two visible strength ranges', (popupHtml.match(/type="range"/g) || []).length === 2],
  ['popup omits URL shortcuts diagnostics and technical counters', !/current-page|shortcut|diagnostic|compactStats|sourceCount|audibleCount/i.test(popupHtml)],
  ['all locale catalogs contain the complete English key set', locales.every((locale) => JSON.stringify(Object.keys(catalogs[locale]).sort()) === JSON.stringify(englishKeys))],
  ['all locales expose manifest localization keys', locales.every((locale) => ['appName', 'appShortName', 'appDescription'].every((key) => catalogs[locale][key]?.message))],
  ['all locale manifest names use the stable LoudEase product name', locales.every((locale) => !/__WVB_/.test(JSON.stringify(catalogs[locale])) && catalogs[locale].appName?.message === 'LoudEase')],
  ['all locales expose localized action titles with the product name preserved', locales.every((locale) => ['actionTitleEnabled', 'actionTitlePaused'].every((key) => catalogs[locale][key]?.message?.startsWith('LoudEase ')))],
  ['localized messages preserve English placeholders', locales.every((locale) => englishKeys.every((key) => JSON.stringify(placeholders(catalogs[locale][key]?.message)) === JSON.stringify(placeholders(catalogs.en[key]?.message))))],
  ['non-English catalogs contain translated UI copy', locales.slice(1).every((locale) => englishKeys.filter((key) => catalogs[locale][key]?.message !== catalogs.en[key]?.message).length >= englishKeys.length * 0.9)],
  ['i18n helper uses Chrome messages and explicit English fallback', /chrome\?\.i18n/.test(helper) && /getMessage/.test(helper) && /fallback/.test(helper)],
  ['RTL direction and logical CSS are present', /activeLocale === 'ar'/.test(helper) && /dir =/.test(helper) && /inline-size|margin-inline|padding-inline/.test(popupCss)],
  ['popup status requires runtime evidence before claiming active', /captureActive \|\| \(active > 0 && processed > 0 && audible > 0\)/.test(popupJs) && /hasFreshSignal/.test(popupJs)],
  ['popup has one canonical compact status renderer', (popupJs.match(/function renderStatus\(/g) || []).length === 1 && !/renderCompactStatus|renderStatus\s*=/.test(popupJs)],
  ['recovery actions are hidden by default and shown from failure branches', /id="captureButton"[^>]*hidden/.test(popupHtml) && /id="reloadButton"[^>]*hidden/.test(popupHtml) && /needsReload/.test(popupJs)],
  ['selected AI logo has separate light and dark production assets', /logo-ai-a-light\.png/.test(popupHtml) && /logo-ai-a-dark\.png/.test(popupHtml) && fs.existsSync(path.join(root, 'assets', 'logo-ai-a-light.png')) && fs.existsSync(path.join(root, 'assets', 'logo-ai-a-dark.png'))],
  ['selected UI theme controls the matching logo asset', [popupHtml, monitorHtml].every((html) => /class="brandLogo logoLight"/.test(html) && /class="brandLogo logoDark"/.test(html)) && [popupCss, monitorCss].every((css) => /data-theme="dark"[^\n]*\.logoLight/.test(css) && /data-theme="dark"[^\n]*\.logoDark/.test(css))],
  ['popup visualizes recent live input and output levels from runtime evidence', /id="levelVisual"/.test(popupHtml) && /updateLevelVisual\(status\)/.test(popupJs) && /averageOutputDb/.test(popupJs) && /inputLevelHistory/.test(popupJs) && /outputLevelHistory/.test(popupJs)],
  ['strength ranges keep value, thumb, and colored progress synchronized', /dial\.input\.style\.setProperty\('--strength'/.test(popupJs) && /--strength/.test(popupCss) && /linear-gradient\(var\(--range-direction\)/.test(popupCss)],
  ['preview save responses preserve the latest slider value', /payload\.type === 'WVB_SAVE_SETTINGS'/.test(popupJs) && /mockSettings = \{[\s\S]*?normalizeSettings/.test(popupJs)],
  ['slider edits keep existing site rules but do not create implicit site overrides', /function strengthSaveOptions\(\)/.test(popupJs) && /siteScoped: settings\?\.siteScoped === true/.test(popupJs) && /schedulePersistSettings\(strengthSaveOptions\(\)\)/.test(popupJs) && /flushPersistSettings\(strengthSaveOptions\(\)\)/.test(popupJs)],
  ['settings button opens the extension options page', /id="settingsButton"/.test(popupHtml) && /runtime\?\.openOptionsPage/.test(popupJs)],
  ['popup theme button switches the shared light and dark preference', /id="themeButton"/.test(popupHtml) && /saveUiPreferences\(\{ theme: nextTheme \}\)/.test(popupJs) && /data-effective-theme/.test(popupCss)],
  ['popup active status and enable switch use theme semantic colors', /--success-text/.test(popupCss) && /\.statusBadge[^\n]*var\(--success-text\)/.test(popupCss) && /\.switchTrack[^\n]*var\(--switch-off\)/.test(popupCss) && /checked[^\n]*\.switchTrack::after[^\n]*var\(--switch-thumb-on\)/.test(popupCss) && /data-theme="dark"[^\n]*--success-text/.test(popupCss)],
  ['external settings cannot overwrite an active local gesture or pending write', /strengthGestureActive \|\| pendingWriteCount > 0/.test(popupJs) && /handleStorageChanged/.test(popupJs)],
  ['strength ranges expose help to assistive technology without leaving a tooltip over the waveform', /aria-describedby="cutHelp"/.test(popupHtml) && /aria-describedby="liftHelp"/.test(popupHtml) && !/\.strengthControl:focus-within/.test(popupCss)],
  ['RTL strength progress follows the native control direction', /\[dir="rtl"\] \.strengthRange/.test(popupCss) && /--range-direction: to left/.test(popupCss)],
  ['monitor retains advanced settings and voluntary diagnostics export', ['localDiagnostics', 'siteForm', 'resetSettings', 'copyJson', 'downloadJson', 'shareReport', 'reportJson'].every((id) => monitorHtml.includes(`id="${id}"`))]
];

let failed = false;
for (const [name, pass] of checks) {
  console[pass ? 'log' : 'error'](`${pass ? 'OK  ' : 'FAIL'} ${name}`);
  failed ||= !pass;
}
if (failed) process.exit(1);
