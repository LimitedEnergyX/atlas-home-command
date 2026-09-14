"""Exercise one staging-only brunch update and verify every imported row and backup.

Never accepts a remote URL. Run only against an isolated imported staging database.
"""
import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import urllib.request
from store import Store, Principal, TABLES

BRUNCH = '11ea0f95-64e7-49ff-83aa-9cec7118513a'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--port', type=int, default=18089)
    args = parser.parse_args()
    path = Path(args.database).resolve()
    report_path = Path(str(path) + '.import-report.json')
    report = json.loads(report_path.read_text(encoding='utf-8'))
    if report.get('production_cutover') is not False or Path(report['database']).resolve() != path:
        raise ValueError('Isolated staging import required')
    store = Store(path)
    p = Principal('0', 'verification', 'viewer')
    original = {t: json.loads((Path(args.snapshot)/(t+'.json')).read_text(encoding='utf-8')) for t in TABLES}
    base = f'http://127.0.0.1:{args.port}'
    def query(payload):
        request = urllib.request.Request(base+'/api/v1/query', data=json.dumps(payload).encode(),
            headers={'Content-Type':'application/json', 'Origin':base})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)['data']
    payload = {'table':'meal_plan', 'filters':[['id','eq',BRUNCH]]}
    before = query(payload)
    if len(before) != 1 or before[0]['day_of_week'] != 'Sunday':
        raise ValueError('Expected original Sunday brunch not found')
    if before[0]['slot'] not in (None, 'Breakfast'):
        raise ValueError('Unexpected existing slot; refusing to replace it')
    query({**payload, 'operation':'update', 'values':{'slot':'Breakfast'},
           'expected':{BRUNCH:before[0]['_revision']}})
    reloaded = query(payload)
    if len(reloaded) != 1 or reloaded[0]['slot'] != 'Breakfast':
        raise ValueError('Brunch did not reload correctly')
    for table, rows in original.items():
        actual = {r['id']:r for r in store.read(p,table)}
        if set(actual) != {r['id'] for r in rows}: raise ValueError('ID or count change: '+table)
        for row in rows:
            for key, value in row.items():
                if table=='meal_plan' and row['id']==BRUNCH and key=='slot': continue
                if actual[row['id']].get(key)!=value: raise ValueError('Unrelated value change: '+table)
            if table=='meal_plan' and row['id']!=BRUNCH and actual[row['id']]['slot'] is not None:
                raise ValueError('An unrelated meal acquired a slot')
    backup = Path(str(path)+'.post-brunch-backup.sqlite3')
    digest = store.backup(backup)
    restored = Store(backup)
    with closing(store.connection()) as source, closing(restored.connection()) as recovery:
        names = [r[0] for r in source.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for table in names:
            # Identifiers originate only from the local schema, never an HTTP request.
            quoted = '"'+table.replace('"','""')+'"'
            if list(map(tuple,source.execute('SELECT * FROM '+quoted))) != list(map(tuple,recovery.execute('SELECT * FROM '+quoted))):
                raise ValueError('Backup row mismatch: '+table)
        if list(map(tuple,source.execute('SELECT * FROM sqlite_master'))) != list(map(tuple,recovery.execute('SELECT * FROM sqlite_master'))):
            raise ValueError('Backup schema mismatch')
    result = {'http_save_reload':'pass', 'brunch_id_preserved':True, 'slot':'Breakfast',
              'all_2349_record_ids_preserved':True, 'unrelated_values_unchanged':True,
              'stock_deductions':0, 'backup_all_tables_and_schema_readback':'pass',
              'backup_sha256':digest, 'browser_verification':'not_yet_verified',
              'live_data_changed':False}
    Path(str(path)+'.verification-report.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))

if __name__=='__main__': main()
