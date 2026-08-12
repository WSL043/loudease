const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function ok(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   ${message}`);
}

const scriptPath = path.join(root, 'tools', 'enable_auto_protection.ps1');
const launcherPath = path.join(root, 'Enable-LoudEase-AutoProtection.cmd');

ok(fs.existsSync(scriptPath), 'Windows automatic-protection setup script exists');
ok(fs.existsSync(launcherPath), 'double-click Windows setup launcher exists');

if (fs.existsSync(scriptPath)) {
  const script = read('tools/enable_auto_protection.ps1');
  ok(/ValidatePattern\('\^\[a-p\]\{32\}\$'\)/.test(script), 'setup validates the exact Chrome extension ID shape');
  ok(/-replace[\s\S]*allowlisted-extension-id/.test(script), 'setup replaces an existing LoudEase allowlist argument instead of duplicating it');
  ok(/Disable/.test(script), 'setup provides a reversible disable path');
  ok(/WhatIf/.test(script), 'setup provides a no-write inspection mode');
  ok(/WScript\.Shell/.test(script) && /\.lnk/.test(script), 'setup updates Chrome shortcuts without a resident helper');
  ok(!/Stop-Process|taskkill|TerminateProcess/i.test(script), 'setup never closes the user browser');
}

if (fs.existsSync(launcherPath)) {
  const launcher = read('Enable-LoudEase-AutoProtection.cmd');
  ok(/enable_auto_protection\.ps1/i.test(launcher), 'double-click launcher delegates to the reviewed PowerShell setup');
}

if (process.exitCode) process.exit(process.exitCode);
