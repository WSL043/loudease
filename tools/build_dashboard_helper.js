#!/usr/bin/env node
// Builds tmp/dashboard-helper.html from store/DASHBOARD_UPDATE_CHECKLIST.md:
// every fenced block becomes a card with a one-click Copy button, so the
// dashboard can be filled by pasting instead of retyping.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'store', 'DASHBOARD_UPDATE_CHECKLIST.md'), 'utf8').replace(/\r\n/g, '\n');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');

const out = [];
let label = '';
let inFence = false;
let fence = [];
let id = 0;
for (const line of src.split('\n')) {
  if (line.startsWith('```')) {
    if (!inFence) { inFence = true; fence = []; continue; }
    inFence = false;
    const text = fence.join('\n');
    out.push(`<div class="card"><div class="lab">${inline(label || 'Text')}</div>` +
      `<pre id="t${id}">${esc(text)}</pre><button data-t="t${id}">Copy</button></div>`);
    id += 1; label = '';
    continue;
  }
  if (inFence) { fence.push(line); continue; }
  if (/^# /.test(line)) out.push(`<h1>${inline(line.slice(2))}</h1>`);
  else if (/^## /.test(line)) out.push(`<h2>${inline(line.slice(3))}</h2>`);
  else if (/^### /.test(line)) out.push(`<h3>${inline(line.slice(4))}</h3>`);
  else if (/^\*\*.+\*\*/.test(line)) { label = line.replace(/:\s*$/, ''); if (!/^\*\*[^*]+\*\*\s*$/.test(line)) out.push(`<p>${inline(line)}</p>`); }
  else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>LoudEase dashboard helper</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#222}
.card{border:1px solid #ccc;border-radius:8px;padding:10px 12px;margin:10px 0;position:relative}
.lab{font-weight:600;margin-bottom:6px}pre{white-space:pre-wrap;margin:0 0 36px;font:13px/1.45 ui-monospace,Consolas,monospace;background:#f6f6f6;padding:8px;border-radius:6px;max-height:220px;overflow:auto}
button{position:absolute;right:12px;bottom:10px;padding:6px 16px;font-size:14px;cursor:pointer}button.ok{background:#2e7d32;color:#fff}
code{background:#eee;padding:0 4px;border-radius:3px}h2{margin-top:32px}</style></head><body>
<p><b>Click Copy, then paste (Ctrl+V) into the matching dashboard field.</b> Screenshots: upload the files from <code>store/assets/</code>.</p>
${out.join('\n')}
<script>document.querySelectorAll('button').forEach(b=>b.onclick=async()=>{const t=document.getElementById(b.dataset.t).textContent;
try{await navigator.clipboard.writeText(t)}catch(e){const r=document.createRange();r.selectNodeContents(document.getElementById(b.dataset.t));getSelection().removeAllRanges();getSelection().addRange(r);document.execCommand('copy')}
document.querySelectorAll('button.ok').forEach(x=>{x.classList.remove('ok');x.textContent='Copy'});b.classList.add('ok');b.textContent='Copied';});</script></body></html>`;
const dest = path.join(root, 'tmp', 'dashboard-helper.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, html);
console.log(`${id} copy blocks -> ${dest}`);
