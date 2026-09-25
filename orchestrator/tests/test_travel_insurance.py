import unittest
from atlas_orchestrator.travel_store import validate_record
from atlas_orchestrator.targets.travel import TravelTarget

class OwnerInsuranceTests(unittest.TestCase):
    def trip(self):
        return {'id':'owner-report','title':'Trip','start_date':'2099-01-01','end_date':'2099-01-03',
                'preferred_card':'Example Travel Card',
                'coverage':[{'name':'Example Travel Insurance','status':'reported','evidence':['Owner message']}],
                'charges':[{'merchant':'Example Airline','card':'Example Travel Card','amount':250,'status':'paid'}]}

    def test_reported_policy_does_not_become_verified(self):
        raw=self.trip(); validate_record('trips',raw)
        result=TravelTarget.normalize_payload({'trips':[raw]})
        trip=result['trips'][0]
        self.assertEqual(trip['coverage'][0]['status'],'reported')
        self.assertFalse(trip['departure']['ready'])
        self.assertTrue(trip['financials']['preferred_card_used'])

    def test_owner_evidence_required(self):
        raw=self.trip(); raw['coverage'][0]['evidence']=[]
        with self.assertRaises(ValueError): validate_record('trips',raw)

    def test_verified_still_requires_policy_dates_and_scope(self):
        raw=self.trip(); raw['coverage'][0]['status']='verified'
        with self.assertRaises(ValueError): validate_record('trips',raw)

if __name__=='__main__': unittest.main()
