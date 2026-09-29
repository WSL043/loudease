// One-time local OAuth for tools/publish_store.js (installed-app loopback flow).
// Reads the client ID/secret from CWS_CLIENT_ID / CWS_CLIENT_SECRET (or tmp/.cws_secret),
// prints the consent URL, waits for Google's redirect on 127.0.0.1, exchanges the code and
// stores the refresh token in tmp/.cws_refresh (git-ignored). Nothing is pasted into a web form.
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const tmp = path.resolve(__dirname, '..', 'tmp');
const clientId = process.env.CWS_CLIENT_ID || fs.readFileSync(path.join(tmp, '.cws_client_id'), 'utf8').trim();
const clientSecret = process.env.CWS_CLIENT_SECRET || fs.readFileSync(path.join(tmp, '.cws_secret'), 'utf8').trim();
const port = Number(process.env.CWS_AUTH_PORT || 8765);
const redirect = `http://127.0.0.1:${port}/`;
const verifier = crypto.randomBytes(48).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = crypto.randomBytes(12).toString('hex');

const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId, redirect_uri: redirect, response_type: 'code',
  scope: 'https://www.googleapis.com/auth/chromewebstore', access_type: 'offline', prompt: 'consent',
  code_challenge: challenge, code_challenge_method: 'S256', state
});
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, '.cws_auth_url'), url);
console.log('Consent URL written to tmp/.cws_auth_url; waiting for the redirect on', redirect);

const server = http.createServer(async (req, res) => {
  const q = new URL(req.url, redirect).searchParams;
  if (q.get('state') !== state || !q.get('code')) { res.end(q.get('error') ? `Error: ${q.get('error')}` : 'Waiting'); return; }
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, code: q.get('code'), code_verifier: verifier,
    grant_type: 'authorization_code', redirect_uri: redirect
  });
  const token = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })).json();
  if (!token.refresh_token) { res.end('No refresh token'); console.error('Token exchange failed:', token.error, token.error_description); process.exit(1); }
  fs.writeFileSync(path.join(tmp, '.cws_refresh'), token.refresh_token);
  res.end('LoudEase publishing authorized. You can close this tab.');
  console.log('Refresh token saved to tmp/.cws_refresh');
  setTimeout(() => process.exit(0), 200);
});
server.listen(port, '127.0.0.1');
setTimeout(() => { console.error('Timed out waiting for authorization'); process.exit(2); }, 600000).unref();
