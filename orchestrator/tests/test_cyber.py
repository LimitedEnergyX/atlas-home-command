import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from atlas_orchestrator.cyber import connect, event_rule, ingest, read_snapshot, summarize


class CyberTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.db = connect(self.path / "events.sqlite3")
        self.now = datetime.now(timezone.utc)
        self.payload = {"schema_version":1,"observed_at":self.now.isoformat(),"posture":{
            "defender":{"available":True,"antivirus":True,"realtime":True,"tamper":True,"signature_age":0},
            "firewall":{"available":True,"enabled":True}},
            "channels":[{"name":n,"status":"current","count":0} for n in ("Defender","Security","Sysmon")],"events":[]}

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def event(self, code=25, channel="Sysmon", record=1, **fields):
        return {"channel":channel,"record_id":record,"event_id":code,"time":self.now.isoformat(),"image":"example.exe",**fields}

    def test_quiet_current_channels_are_not_an_outage(self):
        view = summarize(self.db,self.payload,self.now)
        self.assertEqual(view["status"],"current")
        self.assertEqual(view["summary"]["passed"],4)
        self.assertNotIn("score",view)

    def test_unreadable_and_capped_channels_are_partial(self):
        self.payload["channels"][1]["status"] = "access_denied"
        self.assertEqual(summarize(self.db,self.payload,self.now)["status"],"partial")
        self.payload["channels"][1]["status"] = "current"
        self.payload["channels"][1]["capped"] = True
        self.assertEqual(summarize(self.db,self.payload,self.now)["status"],"partial")

    def test_unknown_posture_is_not_passing(self):
        self.payload["posture"] = {}
        view = summarize(self.db,self.payload,self.now)
        self.assertEqual(view["summary"]["passed"],0)
        self.assertEqual(view["summary"]["unknown"],4)
        self.assertEqual(view["status"],"partial")

    def test_realtime_disabled_needs_attention(self):
        self.payload["posture"]["defender"]["realtime"] = False
        self.assertEqual(summarize(self.db,self.payload,self.now)["status"],"attention")

    def test_replay_deduplicates_and_repeated_findings_group(self):
        self.payload["events"] = [self.event(),self.event(record=2)]
        self.assertEqual(ingest(self.db,self.payload,self.now),2)
        self.assertEqual(ingest(self.db,self.payload,self.now),0)
        findings = summarize(self.db,self.payload,self.now)["findings"]
        self.assertEqual(len(findings),1)
        self.assertEqual(findings[0]["count"],2)

    def test_log_reset_record_id_is_not_a_duplicate(self):
        self.payload["events"] = [self.event(),self.event(time=(self.now-timedelta(minutes=1)).isoformat())]
        self.assertEqual(ingest(self.db,self.payload,self.now),2)

    def test_raw_secret_fields_are_never_persisted(self):
        self.payload["events"] = [self.event(CommandLine="password=TOPSECRET",message="TOPSECRET",image=r"C:\Users\Example\example.exe")]
        ingest(self.db,self.payload,self.now)
        dump = "\n".join(self.db.iterdump())
        self.assertNotIn("TOPSECRET",dump)
        self.assertNotIn("someone",dump)

    def test_routine_events_and_remediation_are_not_threat_claims(self):
        for code in (4,):
            self.assertIsNone(event_rule(self.event(code)))
        self.assertIsNone(event_rule(self.event(1117,"Defender")))
        self.assertIsNone(event_rule(self.event(8,target="normal.exe")))
        self.assertEqual(event_rule(self.event(1,encoded=True))[1],"review")
        self.assertEqual(event_rule(self.event(1,office_child=True))[1],"high")

    def test_login_threshold_uses_distinct_events(self):
        self.payload["events"] = [self.event(4625,"Security",record=i,peer_hash="abc") for i in range(9)]
        ingest(self.db,self.payload,self.now)
        self.assertFalse(summarize(self.db,self.payload,self.now)["findings"])
        self.payload["events"].append(self.event(4625,"Security",record=10,peer_hash="abc"))
        ingest(self.db,self.payload,self.now)
        self.assertEqual(summarize(self.db,self.payload,self.now)["summary"]["review"],1)

    def test_retention_and_future_timestamp(self):
        self.payload["events"] = [self.event(time=(self.now-timedelta(days=8)).isoformat()),self.event(record=2,time=(self.now+timedelta(hours=1)).isoformat())]
        self.assertEqual(ingest(self.db,self.payload,self.now),0)

    def test_missing_corrupt_and_stale_snapshot(self):
        path = self.path / "snapshot.json"
        self.assertFalse(read_snapshot(path,self.now)["fresh"])
        path.write_text("not-json")
        self.assertEqual(read_snapshot(path,self.now)["status"],"unavailable")
        path.write_text("[]")
        self.assertEqual(read_snapshot(path,self.now)["status"],"unavailable")
        view = summarize(self.db,self.payload,self.now)
        path.write_text(json.dumps(view))
        self.assertTrue(read_snapshot(path,self.now)["fresh"])
        self.assertEqual(read_snapshot(path,self.now+timedelta(minutes=11))["status"],"stale")

    def test_api_snapshot_is_read_only_and_has_no_collector_side_effect(self):
        from atlas_orchestrator.core import AtlasOrchestrator
        from atlas_orchestrator.config import Settings
        core = AtlasOrchestrator(Settings(self.path))
        self.assertEqual(core.cyber_status()["status"],"unavailable")
        self.assertFalse((self.path / "cyber-health.json").exists())


if __name__ == "__main__":
    unittest.main()
