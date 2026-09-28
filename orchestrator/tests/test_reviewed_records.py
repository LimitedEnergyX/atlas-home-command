import json
import tempfile
import unittest
from pathlib import Path
from atlas_orchestrator.asset_store import AssetStore
from atlas_orchestrator.vehicle_import import validate, insert
from atlas_orchestrator.charging_records import read_charging_records


class ReviewedRecordTests(unittest.TestCase):
    def test_public_visual_assets_are_explicitly_served(self):
        from atlas_orchestrator.api import STATIC_ROUTES
        for name in ('atlas-house-hilltop.png', 'model-y.png', 'pickup.png', 'motorcycle.png'):
            with self.subTest(asset=name):
                self.assertTrue(STATIC_ROUTES['/assets/' + name].is_file())

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_vehicle_insert_and_refuse_overwrite(self):
        assets = validate({"schema_version":1,"assets":[{"id":"vehicle-athena","name":"Example EV","source":"Owner report",
            "events":[{"event_date":"2030-01-01","title":"Inspection","detail":"Tires checked","state":"complete"}]}]})
        store = AssetStore(self.path / 'assets.sqlite3')
        self.assertEqual(store.status()['assets'], [])
        insert(store, assets)
        with self.assertRaises(ValueError):
            insert(store, assets)
        self.assertEqual(len(store.status()['assets'][0]['events']), 1)

    def test_invalid_asset_shape(self):
        for data in ({}, [], {"schema_version":1,"assets":[{"id":"unknown"}]}):
            with self.assertRaises(ValueError): validate(data)

    def read(self, records):
        path = self.path/'charging-records.json'
        path.write_text(json.dumps({'schema_version':1,'records':records}))
        return read_charging_records(path)

    def test_charging_quantities_and_unknown_sources(self):
        row = {'id':'example','date':'2030-01-01','source':'Home','kwh':8,'solar':6,'rated_miles':20}
        result = self.read([row])
        self.assertEqual(result['records'][0]['solar'], 6)
        self.assertNotIn('grid',result['records'][0])
        for invalid in ([row,row], [{**row,'kwh':None}], [{**row,'solar':9}], [{**row,'grid':False}], [None]):
            self.assertEqual(self.read(invalid)['status'], 'invalid')

    def test_no_import(self):
        self.assertEqual(read_charging_records(self.path/'missing.json')['records'], [])
