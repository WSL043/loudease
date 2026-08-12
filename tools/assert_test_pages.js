const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pagesDir = path.join(root, 'test-pages');

const requiredPages = [
  'simple-video.html',
  'simple-audio.html',
  'dynamic-video-replace.html',
  'spa-route-change.html',
  'iframe-video.html',
  'multi-video.html',
  'live-like-audio.html',
  'muted-helper.html',
  'burst-volume.html',
  'quiet-dialog.html',
  'switching-audio.html',
  'offline-audio-graph.html'
];

const checks = [];

for (const name of requiredPages) {
  const fullPath = path.join(pagesDir, name);
  const exists = fs.existsSync(fullPath);
  checks.push([`${name} exists`, exists]);
  if (!exists) {
    continue;
  }
  const html = fs.readFileSync(fullPath, 'utf8');
  checks.push([`${name} is a complete html document`, /<!doctype html>/i.test(html) && /<html[\s>]/i.test(html) && /<\/html>/i.test(html)]);
  checks.push([`${name} has an interaction entry point`, /<button[\s\S]*?>/.test(html)]);
  checks.push([`${name} is local-only`, !/https?:\/\//i.test(html)]);
  checks.push([`${name} does not autoplay audible remote media`, !/<audio[^>]+src=/i.test(html) && !/<video[^>]+src=/i.test(html)]);
}

let failed = false;
for (const [name, ok] of checks) {
  if (ok) {
    console.log(`OK   ${name}`);
  } else {
    failed = true;
    console.error(`FAIL ${name}`);
  }
}

if (failed) {
  process.exit(1);
}
