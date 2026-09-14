from contextlib import closing
import sqlite3
import unittest
import uuid
import test_local
from store import Principal, Conflict, Forbidden
from recipe_command import save_recipe

class RecipeCommandTests(unittest.TestCase):
    setUp = test_local.StoreTests.setUp
    add = test_local.StoreTests.add
    def command(self):
        return {'request_id':str(uuid.uuid4()),'recipe_id':str(uuid.uuid4()),
            'recipe':{'name':'Test','theme':None,'instructions':'Original','notes':None},
            'ingredients':[{'id':None,'ingredient_name':'Test ingredient','quantity':'1 cup','stock_item_id':None}],
            'expected_recipe':None,'expected_ingredients':{}}
    def edit(self,result):
        cmd=self.command(); cmd['recipe_id']=result['id']; cmd['expected_recipe']=result['_revision']
        cmd['expected_ingredients']={i['id']:i['_revision'] for i in result['recipe_ingredients']}
        cmd['ingredients']=[{k:i[k] for k in ['id','ingredient_name','quantity','stock_item_id']} for i in result['recipe_ingredients']]
        return cmd
    def snapshot(self):
        with closing(self.s.connection()) as db:
            return {t:[tuple(r) for r in db.execute('SELECT * FROM '+t)]
                    for t in ['recipes','recipe_ingredients','stock_items','audit_events']}
    def test_create_edit_preserves_ids_and_stock(self):
        self.add(name='Eggs',notes='14 items'); stock=self.s.read(self.p,'stock_items')
        first=save_recipe(self.s,self.p,self.command()); cmd=self.edit(first)
        cmd['recipe']['instructions']='Edited'; cmd['ingredients'][0]['quantity']='2 cups'
        second=save_recipe(self.s,self.p,cmd)
        self.assertEqual(first['id'],second['id'])
        self.assertEqual(first['recipe_ingredients'][0]['id'],second['recipe_ingredients'][0]['id'])
        self.assertEqual(second['recipe_ingredients'][0]['quantity'],'2 cups')
        self.assertEqual(stock,self.s.read(self.p,'stock_items'))
    def test_create_failure_rolls_back_everything(self):
        cmd=self.command(); cmd['ingredients'][0]['stock_item_id']='missing'
        before=self.snapshot()
        with self.assertRaises(sqlite3.IntegrityError): save_recipe(self.s,self.p,cmd)
        self.assertEqual(self.snapshot(),before)
    def test_failure_after_recipe_update_and_ingredient_removal_rolls_back(self):
        first=save_recipe(self.s,self.p,self.command()); before=self.snapshot(); cmd=self.edit(first)
        cmd['recipe']['name']='Changed'; cmd['ingredients']=[{'id':None,'ingredient_name':'Bad','quantity':'1','stock_item_id':'missing'}]
        with self.assertRaises(sqlite3.IntegrityError): save_recipe(self.s,self.p,cmd)
        self.assertEqual(self.snapshot(),before)
    def test_retry_returns_same_result_without_duplicate_audit(self):
        cmd=self.command(); first=save_recipe(self.s,self.p,cmd); before=self.snapshot()
        self.assertEqual(save_recipe(self.s,self.p,cmd),first)
        self.assertEqual(self.snapshot(),before)
    def test_changed_payload_cannot_reuse_request_id(self):
        cmd=self.command(); save_recipe(self.s,self.p,cmd); cmd['recipe']['name']='Different'
        with self.assertRaises(Conflict): save_recipe(self.s,self.p,cmd)
    def test_stale_recipe_and_new_ingredient_rejected(self):
        first=save_recipe(self.s,self.p,self.command()); stale=self.edit(first)
        save_recipe(self.s,self.p,self.edit(first))
        with self.assertRaises(Conflict): save_recipe(self.s,self.p,stale)
        fresh=self.s.read(self.p,'recipes')[0]
        stale['expected_recipe']=fresh['_revision']
        self.add('recipe_ingredients',recipe_id=first['id'],ingredient_name='Concurrent')
        with self.assertRaises(Conflict): save_recipe(self.s,self.p,stale)
    def test_cross_tenant_stock_reference_rolls_back(self):
        self.s.mutate(self.other,'stock_items','insert',{'id':'foreign','name':'Other'})
        cmd=self.command(); cmd['ingredients'][0]['stock_item_id']='foreign'; before=self.snapshot()
        with self.assertRaises(sqlite3.IntegrityError): save_recipe(self.s,self.p,cmd)
        self.assertEqual(before,self.snapshot())
    def test_viewer_and_identity_spoof_rejected(self):
        with self.assertRaises(Forbidden): save_recipe(self.s,Principal('0','r','viewer'),self.command())
        cmd=self.command(); cmd['tenant_id']='1'
        with self.assertRaises(ValueError): save_recipe(self.s,self.p,cmd)
    def test_zero_ingredients_supported(self):
        cmd=self.command(); cmd['ingredients']=[]; first=save_recipe(self.s,self.p,cmd)
        second=save_recipe(self.s,self.p,self.edit(first))
        self.assertEqual(second['recipe_ingredients'],[])
    def test_existing_ingredients_cannot_be_stolen_from_other_recipe(self):
        first=save_recipe(self.s,self.p,self.command()); second=save_recipe(self.s,self.p,self.command())
        cmd=self.edit(second); cmd['ingredients'][0]['id']=first['recipe_ingredients'][0]['id']
        with self.assertRaises(Conflict): save_recipe(self.s,self.p,cmd)
    def test_receipts_are_tenant_scoped(self):
        cmd=self.command(); first=save_recipe(self.s,self.p,cmd)
        second=save_recipe(self.s,self.other,cmd)
        self.assertEqual(first['id'],second['id'])
        self.assertEqual(len(self.s.read(self.other,'recipes')),1)

if __name__=='__main__': unittest.main()
