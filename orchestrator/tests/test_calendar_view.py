import json
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timezone
from atlas_orchestrator.calendar_view import read_calendar

class CalendarTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)/'calendar.json'
    def write(self, events):
        self.path.write_text(json.dumps({'schema_version':1,'reviewed_at':datetime.now(timezone.utc).isoformat(),'events':events}))
    def event(self, **kw):
        return dict({'id':'one','calendar_id':'assistant','title':'Trip','start':'2026-09-30T15:00:00-05:00','end':'2026-09-30T15:30:00-05:00'}, **kw)
    def test_missing(self): self.assertEqual(read_calendar(self.path)['status'],'unavailable')
    def test_dedupe(self):
        self.write([self.event(),self.event()]); self.assertEqual(len(read_calendar(self.path)['events']),1)
    def test_invalid_time(self):
        self.write([self.event(end='2026-09-30T14:00:00-05:00')]); self.assertEqual(read_calendar(self.path)['status'],'unavailable')
    def test_medical_minimal(self):
        self.write([self.event(category='medical',title='Medical appointment',note='Unapproved clinical detail',url='javascript:alert(1)')])
        e=read_calendar(self.path)['events'][0]
        self.assertNotIn('clinical',e['note']);self.assertEqual(e['url'],'');self.assertEqual(e['title'],'Medical appointment')
    def test_preserves_cancellation(self):
        self.write([self.event(status='canceled')]);self.assertEqual(read_calendar(self.path)['events'][0]['status'],'canceled')
    def test_bad_json(self):
        self.path.write_text('{');self.assertEqual(read_calendar(self.path)['status'],'unavailable')

if __name__=='__main__': unittest.main()
