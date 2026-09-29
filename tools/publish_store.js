// Upload and publish the verified store ZIP through the Chrome Web Store API v2.
//
//   node tools/publish_store.js status
//   node tools/publish_store.js upload   [dist/loudease-store.zip]
//   node tools/publish_store.js publish  [--staged]
//
// Credentials come only from the environment, never from files in this repo:
//   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID
//   CWS_EXTENSION_ID (optional; defaults to the published LoudEase item)
// The API only handles the package and submission. Listing text, category,
// screenshots and privacy answers are edited in the Developer Dashboard.
// See docs/PUBLISHING.md ("Automated upload") for one-time setup.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const EXTENSION_ID = process.env.CWS_EXTENSION_ID || 'gdkaclfjhmenjhoemdkjlpafdhengjog';
const base = (name) => `https://chromewebstore.googleapis.com/${name}v2/publishers/${process.env.CWS_PUBLISHER_ID}/items/${EXTENSION_ID}`;

function need(name) {
  if (!process.env[name]) throw new Error(`Missing environment variable ${name}. See docs/PUBLISHING.md.`);
  return process.env[name];
}

async function accessToken() {
  const body = new URLSearchParams({
    client_id: need('CWS_CLIENT_ID'),
    client_secret: need('CWS_CLIENT_SECRET'),
    refresh_token: need('CWS_REFRESH_TOKEN'),
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const json = await response.json();
  if (!response.ok || !json.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function call(url, token, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 600)}`);
  return json;
}

async function main() {
  const [command = 'status', ...rest] = process.argv.slice(2);
  need('CWS_PUBLISHER_ID');
  const token = await accessToken();
  if (command === 'status') {
    console.log(JSON.stringify(await call(`${base('')}:fetchStatus`, token), null, 2));
  } else if (command === 'upload') {
    const zip = path.resolve(rest.find((item) => !item.startsWith('--')) || path.join(root, 'dist', 'loudease-store.zip'));
    if (!fs.existsSync(zip)) throw new Error(`ZIP not found: ${zip}`);
    const built = path.join(path.dirname(zip), 'store', 'manifest.json');
    const version = fs.existsSync(built) ? JSON.parse(fs.readFileSync(built, 'utf8')).version : 'unknown';
    console.log(`Uploading ${zip} (store build version ${version})`);
    const result = await call(`${base('upload/')}:upload`, token, { method: 'POST', body: fs.readFileSync(zip) });
    console.log(JSON.stringify(result, null, 2));
    console.log('Uploaded. Wait until uploadState is SUCCESS (run "status"), then "publish".');
  } else if (command === 'publish') {
    const body = rest.includes('--staged') ? { publishType: 'STAGED_PUBLISH' } : {};
    console.log(JSON.stringify(await call(`${base('')}:publish`, token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }), null, 2));
  } else {
    throw new Error(`Unknown command ${command}`);
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
