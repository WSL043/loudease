const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const buildConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-config.json'), 'utf8'));
const target = process.argv[2];
const packageZip = process.argv.includes('--zip');
const outputRoot = path.join(root, 'dist');
const outputDir = path.join(outputRoot, target === 'store' ? 'store' : 'github-dev');
const allowlist = ['manifest.json', 'background.js', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'TRADEMARKS.md', 'assets', 'content', 'monitor', 'offscreen', 'popup', 'shared', '_locales'];
const forbidden = /(^|\/)(?:\.git|docs?|e2e|node_modules|src|test-pages|tests?|tmp|tools?)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|.*\.(?:key|pem|p12|pfx|crx|log|zip))$/i;
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs', '.svg', '.txt']);
const startMarker = buildConfig.markers?.start;
const endMarker = buildConfig.markers?.end;
if (!startMarker || !endMarker) throw new Error('Build config markers are required');

function fail(message) { throw new Error(message); }
function relative(file) { return path.relative(root, file).split(path.sep).join('/'); }

function collect(entry, files) {
  const absolute = path.join(root, entry);
  if (!fs.existsSync(absolute)) return;
  if (fs.statSync(absolute).isDirectory()) {
    for (const child of fs.readdirSync(absolute).sort()) collect(path.join(entry, child), files);
    return;
  }
  const name = relative(absolute);
  if (forbidden.test(name)) fail(`Forbidden allowlisted input: ${name}`);
  files.push(name);
}

function stripMarkedBlocks(text, name) {
  let cursor = 0;
  let output = '';
  while (true) {
    const start = text.indexOf(startMarker, cursor);
    const end = text.indexOf(endMarker, cursor);
    if (start < 0 && end < 0) return output + text.slice(cursor);
    if (end >= 0 && (start < 0 || end < start)) fail(`Unmatched ${endMarker} in ${name}`);
    const blockEnd = text.indexOf(endMarker, start + startMarker.length);
    if (blockEnd < 0) fail(`Unmatched ${startMarker} in ${name}`);
    const nestedStart = text.indexOf(startMarker, start + startMarker.length);
    if (nestedStart >= 0 && nestedStart < blockEnd) fail(`Overlapping ${startMarker} in ${name}`);
    const lineStart = text.lastIndexOf('\n', start) + 1;
    const nextLine = text.indexOf('\n', blockEnd + endMarker.length);
    output += text.slice(cursor, lineStart);
    cursor = nextLine < 0 ? text.length : nextLine + 1;
  }
}

function transformManifest(source) {
  const manifest = JSON.parse(source.replace(/^\uFEFF/, ''));
  if (!Array.isArray(buildConfig.host_permissions) || !Array.isArray(buildConfig.assets) || !Array.isArray(buildConfig.locale_message_keys)) {
    fail('Build config host_permissions, assets, and locale_message_keys must be arrays');
  }
  for (const permission of buildConfig.host_permissions) {
    if (!manifest.host_permissions?.includes(permission)) fail(`Marked host permission is absent: ${permission}`);
    manifest.host_permissions = manifest.host_permissions.filter((item) => item !== permission);
  }
  for (const asset of buildConfig.assets) {
    const normalized = path.posix.normalize(asset);
    if (normalized !== asset || path.posix.isAbsolute(asset) || asset.startsWith('../') || forbidden.test(asset)) {
      fail(`Invalid development-only asset path: ${asset}`);
    }
    if (!fs.existsSync(path.join(root, asset))) fail(`Development-only asset is absent: ${asset}`);
  }
  return { text: `${JSON.stringify(manifest, null, 2)}\n`, assets: buildConfig.assets };
}

function stripLocaleMessages(source, name) {
  let messages;
  try { messages = JSON.parse(source.replace(/^\uFEFF/, '')); }
  catch (error) { fail(`Invalid locale JSON ${name}: ${error.message}`); }
  for (const key of buildConfig.locale_message_keys) delete messages[key];
  return `${JSON.stringify(messages, null, 2)}\n`;
}

function copyBuild(files) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  let manifestText = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
  let devAssets = [];
  if (target === 'store') ({ text: manifestText, assets: devAssets } = transformManifest(manifestText));
  for (const name of files) {
    if (target === 'store' && devAssets.includes(name)) continue;
    const destination = path.join(outputDir, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (name === 'manifest.json') fs.writeFileSync(destination, manifestText);
    else if (target === 'store' && textExtensions.has(path.extname(name).toLowerCase())) {
      const source = fs.readFileSync(path.join(root, name), 'utf8');
      const stripped = stripMarkedBlocks(source, name);
      fs.writeFileSync(destination, /^_locales\/[^/]+\/messages\.json$/.test(name) ? stripLocaleMessages(stripped, name) : stripped);
    } else fs.copyFileSync(path.join(root, name), destination);
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(directory, destination) {
  const names = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else names.push(path.relative(directory, full).split(path.sep).join('/'));
    }
  }(directory));
  const local = [];
  const central = [];
  let offset = 0;
  for (const name of names) {
    const nameBytes = Buffer.from(name);
    const data = fs.readFileSync(path.join(directory, name));
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8); header.writeUInt16LE(0, 10); header.writeUInt16LE(0x0021, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8); record.writeUInt16LE(0, 10); record.writeUInt16LE(0, 12); record.writeUInt16LE(0x0021, 14);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBytes.length, 28); record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(destination, Buffer.concat([...local, centralBytes, end]));
}

if (!['dev', 'store'].includes(target)) fail('Usage: node tools/build_extension.js <dev|store> [--zip]');
const files = [];
for (const entry of allowlist) collect(entry, files);
copyBuild(files);
if (packageZip) createZip(outputDir, path.join(outputRoot, 'loudease-store.zip'));
console.log(`Built ${target} extension at ${outputDir}`);
