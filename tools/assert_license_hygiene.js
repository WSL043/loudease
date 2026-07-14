const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function assert(name, condition, detail = '') {
  if (!condition) {
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${name}`);
}

const packageMetadata = JSON.parse(read('package.json'));
const rootLicense = read('LICENSE').trim();
const spdxLicense = read('LICENSES/GPL-3.0-only.txt').trim();
const notice = read('NOTICE');
const contributing = read('CONTRIBUTING.md');
const licensing = read('docs/LICENSING.md');
const reuseMetadata = read('REUSE.toml');
const thirdPartyNotices = read('THIRD_PARTY_NOTICES.md');
const storeAllowlist = read('tools/build_extension.js');

assert('package metadata uses GPL-3.0-only', packageMetadata.license === 'GPL-3.0-only');
assert('root license is canonical GPLv3 text', /^GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/.test(rootLicense));
assert('root and SPDX GPL texts match', rootLicense === spdxLicense);
assert('transition preserves historical grants', /v0\.7\.0-beta\.1/.test(licensing) && /not revoked/.test(licensing) && /MPL-2\.0/.test(notice));
assert('contributions require GPL and DCO sign-off', /GPL-3\.0-only/.test(contributing) && /git commit -s/.test(contributing) && /not a copyright assignment/.test(contributing));
assert('machine-readable metadata maps code and asset exceptions', /path = "\*\*"/.test(reuseMetadata) && /SPDX-License-Identifier = "GPL-3\.0-only"/.test(reuseMetadata) && /LicenseRef-LoudEase-Brand/.test(reuseMetadata) && /SPDX-License-Identifier = "MIT"/.test(reuseMetadata) && /SPDX-License-Identifier = "ISC"/.test(reuseMetadata));
assert('third-party notices carry complete permission grants', /ISC License/.test(thirdPartyNotices) && /MIT License/.test(thirdPartyNotices) && /Permission is hereby granted/.test(thirdPartyNotices));
assert('store package includes required notices', /'LICENSE'/.test(storeAllowlist) && /'NOTICE'/.test(storeAllowlist) && /'THIRD_PARTY_NOTICES\.md'/.test(storeAllowlist) && /'TRADEMARKS\.md'/.test(storeAllowlist));

if (process.exitCode) process.exit(process.exitCode);
