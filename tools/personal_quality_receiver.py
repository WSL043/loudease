"""Local numeric-only test recorder; no audio, titles, full URLs or event text."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import math
import os
import socket
import threading
import time
import argparse

ROOT = Path(__file__).resolve().parents[1] / 'tmp'
SITES = {'www.youtube.com', 'www.bilibili.com', 'live.bilibili.com', 'www.douyin.com'}
SCALARS = {'audioSeconds', 'sampleRate', 'channels', 'resetCount', 'cap', 'reliable',
           'muted', 'gainDb', 'targetGainDb', 'limiterReductionDb', 'programmeDb',
           'confidence', 'liftBudgetDb', 'targetDb', 'limitedSamples', 'hardClips',
           'tabId', 'sequence', 'transportDropped', 'receivedAt',
           'sourceFingerprint', 'transitionProtected', 'effectiveCeilingDb',
           'dynamicsAmount'}

class ExclusiveHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

def quality_rows(payload):
    rows = payload.get('rows')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 10:
        raise ValueError('invalid batch')
    cleaned = []
    for row in rows:
        if not isinstance(row.get('sessionId'), str) or len(row['sessionId']) != 36:
            raise ValueError('invalid session')
        out = {'sessionId': row['sessionId']}
        for key in SCALARS:
            value = row.get(key)
            if value is not None and (not isinstance(value, (int, float, bool)) or not math.isfinite(value)):
                raise ValueError('invalid scalar')
            out[key] = value
        for key in ('shortTerm', 'momentary', 'peaks'):
            values = row.get(key)
            if not isinstance(values, list) or len(values) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values):
                raise ValueError('invalid meter')
            out[key] = values
        if not all(isinstance(out[k], (int, float)) and not isinstance(out[k], bool)
                   for k in ('tabId', 'sequence', 'receivedAt', 'audioSeconds', 'targetDb')):
            raise ValueError('missing identity or timing')
        cleaned.append(out)
    return cleaned

def diagnostics(payload):
    tabs = []
    for tab in payload.get('tabs', []):
        if tab.get('site') not in SITES:
            continue
        clean = {'site': tab['site']}
        for key, value in tab.items():
            if isinstance(value, (int, float, bool)) and math.isfinite(value):
                clean[key] = value
            elif key in ('captureState', 'capturePipelineMode', 'captureContextState', 'kWeightingMode') and isinstance(value, str):
                clean[key] = value[:80]
        tabs.append(clean)
    return {'version': str(payload.get('version', ''))[:24],
            'now': payload.get('now'), 'tabs': tabs,
            'localDiagnosticsEnabled': payload.get('localDiagnosticsEnabled') is True,
            'localDiagnosticsAvailable': payload.get('localDiagnosticsAvailable') is True}

def scoped_rows(payload, tab_ids):
    return [row for row in quality_rows(payload) if row['tabId'] in tab_ids]

def main(tab_ids):
    ROOT.mkdir(exist_ok=True)
    run = ROOT / ('personal-quality-' + time.strftime('%Y%m%d-%H%M%S'))
    run.mkdir()
    lock = threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            try:
                length = int(self.headers.get('content-length', '0'))
                if not 0 < length <= 262144:
                    raise ValueError('invalid length')
                payload = json.loads(self.rfile.read(length))
                now = int(time.time() * 1000)
                if self.path == '/quality':
                    rows = scoped_rows(payload, tab_ids)
                    if not rows:
                        self.send_response(204)
                        self.send_header('access-control-allow-origin', '*')
                        self.end_headers()
                        return
                    output = {'receivedAt': now, 'rows': rows}
                    filename = 'quality.jsonl'
                elif self.path == '/loudease':
                    output = {**diagnostics(payload), '_receivedAt': now}
                    output['tabs'] = [tab for tab in output['tabs'] if tab.get('tabId') in tab_ids]
                    filename = 'status.jsonl'
                else:
                    self.send_error(404)
                    return
                with lock:
                    with (run / filename).open('a', encoding='utf-8') as stream:
                        stream.write(json.dumps(output, allow_nan=False) + '\n')
                    if filename == 'status.jsonl':
                        temporary = ROOT / 'personal-diagnostics-writing.json'
                        temporary.write_text(json.dumps(output, allow_nan=False), encoding='utf-8')
                        os.replace(temporary, ROOT / 'personal-latest-diagnostics.json')
                self.send_response(204)
                self.send_header('access-control-allow-origin', '*')
                self.end_headers()
            except (ValueError, TypeError, KeyError):
                self.send_error(400, 'Invalid diagnostic record')
        def log_message(self, *args):
            pass
    server = ExclusiveHTTPServer(('127.0.0.1', 18765), Handler)
    (ROOT / 'personal-quality-current.json').write_text(json.dumps({'directory': str(run)}), encoding='utf-8')
    (run / 'scope.json').write_text(json.dumps({'tabIds': sorted(tab_ids)}), encoding='utf-8')
    print(json.dumps({'listening': '127.0.0.1:18765', 'directory': str(run), 'tabIds': sorted(tab_ids)}), flush=True)
    server.serve_forever()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--tab-ids', type=int, nargs='+', required=True,
                        help='Exact test-tab IDs observed using the official browser tool')
    main(set(parser.parse_args().tab_ids))
