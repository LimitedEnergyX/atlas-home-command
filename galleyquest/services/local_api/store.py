"""Tenant-scoped transactional repository, separate from HTTP and vendor SDKs."""
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid
import re
from quantity import parse_quantity

TABLES = {
 'recipes': 'id name theme instructions notes created_at updated_at',
 'stock_items': 'id name category status expiration_date refresh_watch notes created_at updated_at quantity_amount quantity_unit',
 'recipe_ingredients': 'id recipe_id stock_item_id ingredient_name quantity created_at',
 'meal_plan': 'id week_start_date day_of_week slot theme recipe_id meal_name notes created_at updated_at',
 'grocery_extra_items': 'id week_start_date item_name notes created_at',
 'grocery_dismissed_items': 'id week_start_date item_key created_at',
}
TABLES = {key: value.split() for key, value in TABLES.items()}
ORDER = ['recipes','stock_items','recipe_ingredients','meal_plan','grocery_extra_items','grocery_dismissed_items']
class Conflict(Exception): pass
class Forbidden(Exception): pass
@dataclass(frozen=True)
class Principal:
    tenant_id: str
    actor_id: str
    role: str
def now(): return datetime.now(timezone.utc).isoformat()
def encode(value): return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'))

class Store:
    def __init__(self,path): self.path=Path(path).resolve()
    def connection(self):
        db=sqlite3.connect(self.path,timeout=10)
        db.row_factory=sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=10000')
        return db
    @contextmanager
    def transaction(self):
        with closing(self.connection()) as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                yield db
                db.commit()
            except BaseException:
                db.rollback(); raise
    def initialize(self):
        if self.path.exists(): raise ValueError('Refusing to overwrite an existing database')
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with closing(self.connection()) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript(Path(__file__).with_name('schema.sql').read_text())
            db.execute('INSERT INTO schema_migrations VALUES(1,?)',(now(),))
            db.execute('INSERT INTO schema_migrations VALUES(2,?)',(now(),))
            db.commit()
    @staticmethod
    def authorize(p,table,write=False):
        if table not in TABLES: raise ValueError('Unknown resource')
        if not p.tenant_id or not p.actor_id: raise Forbidden('Identity required')
        if p.role not in {'viewer','planner','operator','owner'}: raise Forbidden('Unknown role')
        if write and (p.role=='viewer' or p.role=='planner' and table=='stock_items'):
            raise Forbidden('Role does not permit this operation')
    def create_tenant(self,tenant_id,name):
        # Administrative bootstrap only; never exposed by preview API.
        with self.transaction() as db:
            db.execute('INSERT INTO tenants VALUES(?,?)',(tenant_id,name))
            db.execute('INSERT INTO locations VALUES(?,?,?)',(tenant_id,'main','Main'))
    @staticmethod
    def public(row):
        result=dict(row); result.pop('tenant_id')
        result['_revision']=result.pop('revision')
        if 'refresh_watch' in result and result['refresh_watch'] is not None:
            result['refresh_watch']=bool(result['refresh_watch'])
        return result
    def _read(self,db,p,table,filters=(),order=None):
        self.authorize(p,table)
        where,args=['tenant_id=?'],[p.tenant_id]
        for column,operator,value in filters:
            if column not in TABLES[table]: raise ValueError('Unknown filter field')
            if operator=='eq': where.append(f'{column} IS ?'); args.append(value)
            elif operator=='gte': where.append(f'{column}>=?'); args.append(value)
            elif operator=='in' and isinstance(value,list) and len(value)<=1000:
                where.append(f'{column} IN ({",".join("?" for _ in value)})'); args.extend(value)
            else: raise ValueError('Unsupported filter')
        order=order or 'id'
        if order not in TABLES[table]: raise ValueError('Unknown ordering field')
        return [self.public(row) for row in db.execute(
            f'SELECT * FROM {table} WHERE {" AND ".join(where)} ORDER BY {order},id',args)]
    def read(self,p,table,filters=(),order=None):
        with closing(self.connection()) as db: return self._read(db,p,table,filters,order)
    def audit(self,db,p,op,table,row_id,before,after):
        db.execute('INSERT INTO audit_events(tenant_id,actor_id,operation,table_name,row_id,'
                   'before_json,after_json,occurred_at) VALUES(?,?,?,?,?,?,?,?)',
                   (p.tenant_id,p.actor_id,op,table,row_id,
                    encode(before) if before else None,encode(after) if after else None,now()))
    def _insert(self,db,p,table,value):
        if not isinstance(value,dict) or set(value)-set(TABLES[table]): raise ValueError('Unknown or protected fields')
        row=dict(value); row.setdefault('id',str(uuid.uuid4()))
        if 'created_at' in TABLES[table]: row.setdefault('created_at',now())
        if 'updated_at' in TABLES[table]: row.setdefault('updated_at',now())
        columns=['tenant_id']+list(row)
        db.execute(f'INSERT INTO {table}({",".join(columns)}) VALUES({",".join("?" for _ in columns)})',
                   [p.tenant_id]+list(row.values()))
        return self._read(db,p,table,[('id','eq',row['id'])])[0]
    def mutate(self,p,table,operation,values=None,filters=(),expected=None):
        self.authorize(p,table,True)
        if table=='stock_items' and operation in {'insert','update'}:
            def normalize(value):
                if not isinstance(value,dict): return value
                value=dict(value)
                if 'quantity_amount' in value or 'quantity_unit' in value:
                    raise ValueError('Use the stock quantity command for structured quantities')
                if 'notes' in value:
                    matches=re.findall(r'^Qty:\s*(.+)$',value.get('notes') or '',re.M|re.I)
                    if len(matches)>1: raise ValueError('Only one Qty line is allowed')
                    q=parse_quantity(matches[0]) if matches else None
                    if q and not q['unit']: raise ValueError('Quantity needs a unit, such as gallon or each')
                    value['quantity_amount']=q['amount'] if q else None
                    value['quantity_unit']=q['unit'] if q else None
                    if q:
                        value['notes']=re.sub(r'^Qty:.*$',lambda _: 'Qty: '+q['amount']+' '+q['unit'],value['notes'],flags=re.M|re.I)
                return value
            values=[normalize(v) for v in values] if isinstance(values,list) else normalize(values)
        if operation not in {'insert','update','delete','upsert'}: raise ValueError('Unknown operation')
        if operation in {'update','delete'} and not filters: raise ValueError('Unfiltered mutations forbidden')
        with self.transaction() as db:
            changed=[]
            if operation in {'insert','upsert'}:
                batch=values if isinstance(values,list) else [values]
                if not batch or len(batch)>1000: raise ValueError('Invalid batch size')
                for value in batch:
                    if operation=='upsert':
                        if table!='grocery_dismissed_items': raise ValueError('Unsupported upsert')
                        existing=self._read(db,p,table,[('week_start_date','eq',value['week_start_date']),('item_key','eq',value['item_key'])])
                        if existing: changed.extend(existing); continue
                    after=self._insert(db,p,table,value)
                    self.audit(db,p,operation,table,after['id'],None,after); changed.append(after)
                return changed
            if operation=='update' and (not isinstance(values,dict) or set(values)-set(TABLES[table]) or 'id' in values or not values):
                raise ValueError('Unknown or protected fields')
            before=self._read(db,p,table,filters)
            if not before: raise Conflict('Record no longer exists in this tenant')
            for row in before:
                if expected is None or expected.get(row['id'])!=row['_revision']:
                    raise Conflict('Record changed or has not been read; reload before saving')
                if operation=='delete':
                    db.execute(f'DELETE FROM {table} WHERE tenant_id=? AND id=?',(p.tenant_id,row['id']))
                    after=None
                else:
                    db.execute(f'UPDATE {table} SET '+','.join(f'{f}=?' for f in values)+
                               ',revision=revision+1 WHERE tenant_id=? AND id=?',
                               list(values.values())+[p.tenant_id,row['id']])
                    after=self._read(db,p,table,[('id','eq',row['id'])])[0]
                self.audit(db,p,operation,table,row['id'],row,after); changed.append(after or row)
            return changed
    def import_snapshot(self,directory,tenant_id='0',name='Household'):
        root=Path(directory); manifest=json.loads((root/'backup-manifest.json').read_text(encoding='utf-8'))
        if manifest.get('verification_status')!='verified': raise ValueError('Verified backup required')
        data={}
        for table in ORDER:
            raw=(root/(table+'.json')).read_bytes()
            if hashlib.sha256(raw).hexdigest()!=manifest['file_sha256'][table+'.json']: raise ValueError('Source checksum mismatch')
            rows=json.loads(raw)
            if len(rows)!=manifest['tables'][table]: raise ValueError('Source count mismatch')
            data[table]=rows
        p=Principal(tenant_id,'backup-import','owner')
        with self.transaction() as db:
            db.execute('INSERT INTO tenants VALUES(?,?)',(tenant_id,name))
            db.execute('INSERT INTO locations VALUES(?,?,?)',(tenant_id,'main','Main'))
            for table,rows in data.items():
                for row in rows: self._insert(db,p,table,row)
            for table,rows in data.items():
                actual={row['id']:row for row in self._read(db,p,table)}
                if len(actual)!=len(rows): raise ValueError('Import count mismatch')
                for row in rows:
                    if any(actual[row['id']].get(k)!=v for k,v in row.items()): raise ValueError('Import changed a source value')
            if db.execute('PRAGMA foreign_key_check').fetchall(): raise ValueError('Broken foreign keys')
            self.audit(db,p,'import','snapshot',manifest.get('timestamp','snapshot'),None,manifest['tables'])
        return {table:len(rows) for table,rows in data.items()}
    def backup(self,destination):
        path=Path(destination).resolve()
        if path.exists(): raise ValueError('Backup already exists')
        path.parent.mkdir(parents=True,exist_ok=True)
        with closing(self.connection()) as source, closing(sqlite3.connect(path)) as target: source.backup(target)
        with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)) as restored:
            if restored.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise ValueError('Backup failed integrity check')
            if restored.execute('PRAGMA foreign_key_check').fetchall(): raise ValueError('Backup failed relationship check')
        return hashlib.sha256(path.read_bytes()).hexdigest()
