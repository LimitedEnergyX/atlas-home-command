from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from store import Store,Principal,Conflict,Forbidden,TABLES,encode
from service import execute
from preview import Server

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name); self.s=Store(self.root/'data.sqlite3'); self.s.initialize()
        self.s.create_tenant('0','Household'); self.s.create_tenant('1','Cafeteria')
        self.p=Principal('0','alice','owner'); self.other=Principal('1','bob','owner')
    def add(self,table='stock_items',**fields):
        return self.s.mutate(self.p,table,'insert',fields)[0]
    def test_ids_can_repeat_across_tenants_without_leakage(self):
        self.add(id='same',name='Private')
        self.s.mutate(self.other,'stock_items','insert',{'id':'same','name':'Other'})
        self.assertEqual(self.s.read(self.other,'stock_items')[0]['name'],'Other')
        self.assertEqual(self.s.read(self.p,'stock_items')[0]['name'],'Private')
    def test_tenant_body_spoof_rejected(self):
        with self.assertRaises(ValueError): self.add(name='bad',tenant_id='1')
        with self.assertRaises(ValueError): execute(self.s,self.p,{'table':'stock_items','tenant_id':'1'})
    def test_viewer_cannot_write(self):
        with self.assertRaises(Forbidden): self.s.mutate(Principal('0','reader','viewer'),'stock_items','insert',{'name':'bad'})
    def test_planner_cannot_change_stock(self):
        with self.assertRaises(Forbidden): self.s.mutate(Principal('0','planner','planner'),'stock_items','insert',{'name':'bad'})
    def test_unknown_role_denied(self):
        with self.assertRaises(Forbidden): self.s.read(Principal('0','x','root'),'stock_items')
    def test_cross_tenant_recipe_reference_rejected(self):
        self.s.mutate(self.other,'recipes','insert',{'id':'foreign','name':'Secret'})
        with self.assertRaises(sqlite3.IntegrityError):
            self.add('meal_plan',week_start_date='2026-09-07',day_of_week='Sunday',recipe_id='foreign')
    def test_cross_tenant_stock_reference_rejected(self):
        self.add('recipes',id='recipe',name='Local')
        self.s.mutate(self.other,'stock_items','insert',{'id':'foreign','name':'Secret'})
        with self.assertRaises(sqlite3.IntegrityError):
            self.add('recipe_ingredients',recipe_id='recipe',stock_item_id='foreign',ingredient_name='bad')
    def test_atomic_batch_rollback(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.s.mutate(self.p,'stock_items','insert',[{'id':'a','name':'A'},{'id':'a','name':'B'}])
        self.assertEqual(self.s.read(self.p,'stock_items'),[])
        with closing(self.s.connection()) as db: self.assertEqual(db.execute('SELECT count(*) FROM audit_events').fetchone()[0],0)
    def test_missing_revision_rejected(self):
        row=self.add(name='A')
        with self.assertRaises(Conflict): self.s.mutate(self.p,'stock_items','update',{'name':'B'},[('id','eq',row['id'])])
    def test_concurrent_edit_rejected(self):
        row=self.add(name='A'); expected={row['id']:1}; filters=[('id','eq',row['id'])]
        self.s.mutate(self.p,'stock_items','update',{'name':'B'},filters,expected)
        with self.assertRaises(Conflict): self.s.mutate(self.p,'stock_items','update',{'name':'C'},filters,expected)
        self.assertEqual(self.s.read(self.p,'stock_items')[0]['name'],'B')
    def test_unfiltered_write_rejected(self):
        with self.assertRaises(ValueError): self.s.mutate(self.p,'stock_items','delete')
    def test_multiple_meals_same_day_no_deductions(self):
        self.add(id='eggs',name='Eggs',notes='Qty: 14 items')
        before=self.s.read(self.p,'stock_items')
        for slot in ['Breakfast','Lunch','Dinner','Dinner']:
            self.add('meal_plan',week_start_date='2026-09-07',day_of_week='Sunday',slot=slot,meal_name=slot)
        self.assertEqual(len(self.s.read(self.p,'meal_plan')),4)
        self.assertEqual(self.s.read(self.p,'stock_items'),before)
    def test_same_brunch_id_and_unrelated_values_preserved(self):
        brunch=self.add('meal_plan',id='brunch',week_start_date='2026-09-07',day_of_week='Sunday',meal_name='Brunch',notes='Original')
        self.add('meal_plan',id='other',week_start_date='2026-09-07',day_of_week='Sunday',meal_name='Dinner')
        other=self.s.read(self.p,'meal_plan',[('id','eq','other')])
        self.s.mutate(self.p,'meal_plan','update',{'slot':'Breakfast'},[('id','eq','brunch')],{'brunch':1})
        after=self.s.read(self.p,'meal_plan',[('id','eq','brunch')])[0]
        self.assertEqual(after['id'],brunch['id']); self.assertEqual(after['notes'],'Original')
        self.assertEqual(after['slot'],'Breakfast'); self.assertEqual(len(self.s.read(self.p,'meal_plan')),2)
        self.assertEqual(self.s.read(self.p,'meal_plan',[('id','eq','other')]),other)
    def test_projections_do_not_join_another_tenant(self):
        self.add('recipes',id='same',name='Local')
        self.s.mutate(self.other,'recipes','insert',{'id':'same','name':'Foreign'})
        self.add('meal_plan',week_start_date='2026-09-07',day_of_week='Sunday',recipe_id='same')
        self.assertEqual(execute(self.s,self.p,{'table':'meal_plan'})[0]['recipe']['name'],'Local')
    def test_upsert_is_tenant_scoped(self):
        value={'week_start_date':'2026-09-07','item_key':'same'}
        for p in [self.p,self.other,self.p]: self.s.mutate(p,'grocery_dismissed_items','upsert',value)
        self.assertEqual(len(self.s.read(self.p,'grocery_dismissed_items')),1)
        self.assertEqual(len(self.s.read(self.other,'grocery_dismissed_items')),1)
    def test_linked_recipe_delete_restricted(self):
        self.add('recipes',id='r',name='R')
        self.add('recipe_ingredients',recipe_id='r',ingredient_name='Ingredient')
        with self.assertRaises(sqlite3.IntegrityError): self.s.mutate(self.p,'recipes','delete',filters=[('id','eq','r')],expected={'r':1})
        self.assertEqual(len(self.s.read(self.p,'recipes')),1)
    def test_sql_injection_identifiers_rejected(self):
        for table,filters in [('stock_items; DROP TABLE tenants',[]),('stock_items',[('id OR 1=1','eq','x')])]:
            with self.assertRaises(ValueError): self.s.read(self.p,table,filters)
    def test_backup_restores_all_tables_and_audit(self):
        self.add(name='Café',notes=None)
        path=self.root/'restore.sqlite3'; self.s.backup(path)
        restored=Store(path)
        for table in TABLES: self.assertEqual(self.s.read(self.p,table),restored.read(self.p,table))
        with closing(self.s.connection()) as a, closing(restored.connection()) as b:
            self.assertEqual([tuple(r) for r in a.execute('SELECT * FROM audit_events')],[tuple(r) for r in b.execute('SELECT * FROM audit_events')])
    def test_overwrite_refused(self):
        with self.assertRaises(ValueError): self.s.initialize()
        with self.assertRaises(ValueError): self.s.backup(self.s.path)
    def test_preview_rejects_origin_and_host_spoof(self):
        server=Server(0,self.s); thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        try:
            url=f'http://127.0.0.1:{server.server_port}/api/v1/query'
            for headers in [{'Origin':'https://evil.example'},{'Host':'evil.example','Origin':url.split('/api')[0]}]:
                request=urllib.request.Request(url,data=b'{"table":"stock_items"}',headers={'Content-Type':'application/json',**headers})
                with self.assertRaises(urllib.error.HTTPError) as caught: urllib.request.urlopen(request)
                self.assertEqual(caught.exception.code,403)
        finally: server.shutdown(); server.server_close(); thread.join()

if __name__=='__main__': unittest.main()
