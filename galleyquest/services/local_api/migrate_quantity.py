"""Add nullable structured quantities after a verified SQLite snapshot backup."""
import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
from store import Store, now

def snapshot(db):
    schema=[tuple(row) for row in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")]
    tables={}
    for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        name=row[0]
        columns=[r[1] for r in db.execute('PRAGMA table_info("'+name+'")')]
        records=[list(r) for r in db.execute('SELECT * FROM "'+name+'" ORDER BY rowid')]
        tables[name]={'columns':columns,'rows':records}
    return {'schema':schema,'tables':tables}

def migrate(path,backup):
    store=Store(path); backup=Path(backup)
    if backup.exists(): raise ValueError('Backup target already exists')
    with closing(store.connection()) as source:
        source.execute('BEGIN IMMEDIATE')
        before=snapshot(source)
        # A second read-only connection sees the committed state while this writer lock prevents changes.
        with closing(sqlite3.connect(store.path)) as reader, closing(sqlite3.connect(backup)) as target:
            reader.backup(target)
            if target.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or target.execute('PRAGMA foreign_key_check').fetchall():
                raise RuntimeError('Backup integrity check failed')
            if snapshot(target)!=before: raise RuntimeError('Backup schema/data comparison failed')
        columns=before['tables']['stock_items']['columns']
        if 'quantity_amount' in columns or 'quantity_unit' in columns: raise ValueError('Quantity columns already exist; no migration applied')
        source.execute('ALTER TABLE stock_items ADD COLUMN quantity_amount TEXT')
        source.execute('ALTER TABLE stock_items ADD COLUMN quantity_unit TEXT')
        source.execute('INSERT INTO schema_migrations VALUES(2,?)',(now(),))
        after=snapshot(source)
        for name,data in before['tables'].items():
            if name=='schema_migrations': continue
            actual=after['tables'][name]
            projected=[[row[actual['columns'].index(c)] for c in data['columns']] for row in actual['rows']]
            if projected!=data['rows']: raise RuntimeError('Unrelated data changed: '+name)
        for entry in before['schema']:
            if entry[1]!='stock_items' and entry not in after['schema']: raise RuntimeError('Unrelated schema changed')
        if source.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or source.execute('PRAGMA foreign_key_check').fetchall():
            raise RuntimeError('Post-migration integrity failure')
        source.commit()
    return {'backup':str(backup),'sha256':hashlib.sha256(backup.read_bytes()).hexdigest(),
            'verified':'Full schema and all table rows compared against backup; all original data preserved after migration',
            'counts':{n:len(v['rows']) for n,v in before['tables'].items()},'added':['quantity_amount TEXT NULL','quantity_unit TEXT NULL']}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True); parser.add_argument('--backup',required=True)
    args=parser.parse_args(); print(json.dumps(migrate(args.database,args.backup),indent=2))
