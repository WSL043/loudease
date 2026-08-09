const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const build = path.join(root, 'dist', 'store');
const forbiddenPath = /(^|\/)(?:\.git|docs?|e2e|node_modules|src|test-pages|tests?|tmp|tools?)(?:\/|$)|\.(?:key|pem|p12|pfx|crx|log|zip)$/i;
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs', '.svg', '.txt']);

function fail(message) { throw new Error(message); }
function exists(name) { return fs.existsSync(path.join(build, name)); }
function walk(dir, names = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, names);
    else names.push(path.relative(build, full).split(path.sep).join('/'));
  }
  return names;
}
function assertReference(from, value) {
  if (typeof value !== 'string' || /^(?:[a-z]+:|#|\/\/)/i.test(value)) return;
  const clean = value.split(/[?#]/, 1)[0];
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), clean));
  if (!exists(resolved)) fail(`Missing reference ${value} from ${from}`);
}

function verify() {
  if (!exists('manifest.json')) fail('Missing manifest.json');
  for (const notice of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'TRADEMARKS.md']) if (!exists(notice)) fail(`Missing release notice: ${notice}`);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(build, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { fail(`Invalid manifest JSON: ${error.message}`); }
  const required = [manifest.background?.service_worker, manifest.action?.default_popup, manifest.options_page];
  if (manifest.homepage_url !== 'https://github.com/WSL043/loudease') fail('Manifest must identify the official source repository');
  for (const script of manifest.content_scripts || []) required.push(...(script.js || []), ...(script.css || []));
  for (const icons of [manifest.icons, manifest.action?.default_icon]) required.push(...Object.values(icons || {}));
  for (const name of required.filter(Boolean)) if (!exists(name)) fail(`Missing manifest runtime file: ${name}`);
  if (manifest.default_locale) {
    const messages = `_locales/${manifest.default_locale}/messages.json`;
    if (!exists(messages)) fail(`Missing default locale: ${messages}`);
  }
  const files = walk(build);
  for (const name of files.filter((item) => /^_locales\/[^/]+\/messages\.json$/.test(item))) {
    try { JSON.parse(fs.readFileSync(path.join(build, name), 'utf8').replace(/^\uFEFF/, '')); }
    catch (error) { fail(`Invalid locale JSON ${name}: ${error.message}`); }
  }
  for (const name of files) {
    if (forbiddenPath.test(name)) fail(`Forbidden release path: ${name}`);
    if (!textExtensions.has(path.extname(name).toLowerCase())) continue;
    const text = fs.readFileSync(path.join(build, name), 'utf8');
    if (/localhost|127\.0\.0\.1/i.test(text)) fail(`Localhost string remains in ${name}`);
    if (/localDiagnostics|LOCAL_DIAGNOSTICS|WVB_SET_LOCAL_DIAGNOSTICS/.test(text)) fail(`Local diagnostics symbol remains in ${name}`);
    if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(text)) fail(`Unsafe eval remains in ${name}`);
    if (/WVB_DEV_DIAGNOSTICS_(?:START|END)/.test(text)) fail(`Development marker remains in ${name}`);
    if (/\.(?:html|css)$/i.test(name)) {
      for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi)) assertReference(name, match[1] || match[2]);
    }
    if (/\.(?:js|mjs)$/i.test(name)) {
      for (const match of text.matchAll(/(?:import\s+(?:[^"']+?\s+from\s+)?|import\s*\()["']([^"']+)["']/g)) assertReference(name, match[1]);
      for (const match of text.matchAll(/(?:importScripts|addModule|createDocument)\s*\(\s*["']([^"']+)["']/g)) assertReference(name, match[1]);
      for (const match of text.matchAll(/files\s*:\s*\[\s*["']([^"']+)["']/g)) assertReference(name, match[1]);
    }
  }
  console.log(`OK   verified ${files.length} store runtime files`);
}

if (!process.argv.includes('--verify-only')) {
  const result = spawnSync(process.execPath, [path.join(root, 'tools', 'build_extension.js'), 'store'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
verify();
