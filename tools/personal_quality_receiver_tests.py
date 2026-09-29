import unittest
from personal_quality_receiver import diagnostics, quality_rows, scoped_rows, ExclusiveHTTPServer
from http.server import BaseHTTPRequestHandler

class ReceiverTests(unittest.TestCase):
    def test_exclusive_port(self):
        first = ExclusiveHTTPServer(('127.0.0.1', 0), BaseHTTPRequestHandler)
        try:
            with self.assertRaises(OSError):
                second = ExclusiveHTTPServer(first.server_address, BaseHTTPRequestHandler)
                second.server_close()
        finally:
            first.server_close()

    def test_privacy(self):
        result = diagnostics({'tabs': [
            {'site': 'www.youtube.com', 'tabId': 1, 'url': 'private', 'title': 'private', 'captureActive': True},
            {'site': 'mail.google.com', 'tabId': 2},
        ], 'events': [{'secret': 'private'}]})
        self.assertEqual(result['tabs'], [{'site': 'www.youtube.com', 'tabId': 1, 'captureActive': True}])
        self.assertNotIn('events', result)

    def test_meter_validation(self):
        row = dict(sessionId='00000000-0000-0000-0000-000000000001', tabId=1,
                   sequence=1, receivedAt=1, audioSeconds=0.1, targetDb=-19,
                   sourceFingerprint=139496795005572, transitionProtected=True, effectiveCeilingDb=-13,
                   dynamicsAmount=0.92,
                   shortTerm=[-20, -21], momentary=[-20, -21], peaks=[0.2, 0.1], title='private')
        self.assertNotIn('title', quality_rows({'rows': [row]})[0])
        self.assertEqual(scoped_rows({'rows': [row]}, {2}), [])
        self.assertEqual(scoped_rows({'rows': [row]}, {1})[0]['sourceFingerprint'], 139496795005572)
        self.assertEqual(scoped_rows({'rows': [row]}, {1})[0]['dynamicsAmount'], 0.92)
        row['shortTerm'] = [float('nan'), -21]
        with self.assertRaises(ValueError):
            quality_rows({'rows': [row]})
        with self.assertRaises(ValueError):
            quality_rows({'rows': []})

if __name__ == '__main__':
    unittest.main()
