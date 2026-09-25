import importlib.util
from pathlib import Path

target = Path(__file__).with_name('powerwall_status.py')
if not target.exists():
    target = Path(__file__).resolve().parents[1] / 'src/atlas_orchestrator/targets/powerwall_status.py'
spec = importlib.util.spec_from_file_location('projection', target)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
project = module.PowerwallStatusTarget._charge_snapshot
source = {'status':'basic_status','charge_state':{'charge_energy_added':4},'observations':[
    {'observed_at':'2026-09-24T18:00:00Z','charge_energy_added':3,'charge_miles_added_rated':9,'token':'secret','location':'private'},
    {'observed_at':'bad','charge_energy_added':9},
    {'observed_at':'2026-09-24T18:30:00Z','charge_energy_added':float('nan'),'charger_power':True}
]}
result=project(source)
assert len(result['observations'])==2
assert result['observations'][0]['charge_miles_added_rated']==9
assert 'secret' not in str(result) and 'private' not in str(result)
assert 'charge_energy_added' not in result['observations'][1]
assert 'charger_power' not in result['observations'][1]
assert project({'status':'basic_status','charge_state':{}})['observations']==[]
print('PASS history projection, allowlist, numeric validation, and old collector compatibility.')
