"""Import a verified snapshot to a NEW local staging database, never over live data."""
import argparse
import json
from pathlib import Path
from store import Store

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',required=True); parser.add_argument('--database',required=True)
    args=parser.parse_args()
    target=Path(args.database).resolve()
    if target.is_relative_to(Path(__file__).resolve().parents[2]):
        parser.error('Keep the database outside the web/source directory')
    store=Store(target); store.initialize()
    result=store.import_snapshot(args.snapshot)
    digest=store.backup(str(target)+'.verified-backup.sqlite3')
    report={'database':str(target),'tenant_id':'0','counts':result,'source_values_preserved':True,
            'sqlite_backup_sha256':digest,'production_cutover':False}
    Path(str(target)+'.import-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))
