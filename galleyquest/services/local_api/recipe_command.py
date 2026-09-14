"""Atomic aggregate save. No stock consumption and no implicit cascading deletes."""
import hashlib
import json
import uuid
from store import Conflict, encode, now

RECIPE_FIELDS = {'name','theme','instructions','notes'}
INGREDIENT_FIELDS = {'id','ingredient_name','quantity','stock_item_id'}

def save_recipe(store, principal, request):
    store.authorize(principal,'recipes',True)
    store.authorize(principal,'recipe_ingredients',True)
    if not isinstance(request,dict) or set(request)!={'request_id','recipe_id','recipe','ingredients','expected_recipe','expected_ingredients'}:
        raise ValueError('Invalid recipe command fields')
    for key in ('request_id','recipe_id'):
        if not isinstance(request[key],str): raise ValueError('UUID required')
        uuid.UUID(request[key])
    fields = request['recipe']
    if not isinstance(fields,dict) or set(fields)!=RECIPE_FIELDS:
        raise ValueError('Invalid recipe fields')
    if not isinstance(fields['name'],str) or not fields['name'].strip():
        raise ValueError('Recipe name required')
    if any(v is not None and (not isinstance(v,str) or len(v)>100_000) for v in fields.values()):
        raise ValueError('Invalid recipe text')
    ingredients = request['ingredients']
    if not isinstance(ingredients,list) or len(ingredients)>1000:
        raise ValueError('Invalid ingredient list')
    seen = set()
    for item in ingredients:
        if not isinstance(item,dict) or set(item)!=INGREDIENT_FIELDS:
            raise ValueError('Invalid ingredient fields')
        if not isinstance(item['ingredient_name'],str) or not item['ingredient_name'].strip():
            raise ValueError('Ingredient name required')
        if any(v is not None and (not isinstance(v,str) or len(v)>100_000) for v in item.values()):
            raise ValueError('Invalid ingredient text')
        if item['id'] is not None:
            if item['id'] in seen: raise ValueError('Duplicate ingredient ID')
            seen.add(item['id'])
    if not isinstance(request['expected_ingredients'],dict): raise ValueError('Ingredient revisions required')
    fingerprint = hashlib.sha256(encode(request).encode()).hexdigest()
    rid = request['recipe_id']
    with store.transaction() as db:
        # Receipt and all aggregate changes commit together. BEGIN IMMEDIATE also
        # serializes concurrent retries, so no second command receipt can race.
        prior = db.execute("SELECT after_json FROM audit_events WHERE tenant_id=? AND actor_id=? "
            "AND operation='recipe-save-command' AND row_id=? ORDER BY sequence LIMIT 1",
            (principal.tenant_id,principal.actor_id,request['request_id'])).fetchone()
        if prior:
            receipt = json.loads(prior[0])
            if receipt['fingerprint']!=fingerprint: raise Conflict('Request ID reused for a different edit')
            return receipt['result']
        existing = store._read(db,principal,'recipes',[('id','eq',rid)])
        old_ingredients = store._read(db,principal,'recipe_ingredients',[('recipe_id','eq',rid)])
        old_by_id = {i['id']:i for i in old_ingredients}
        if request['expected_ingredients']!={i['id']:i['_revision'] for i in old_ingredients}:
            raise Conflict('Ingredients changed; reload the recipe before saving')
        if seen-set(old_by_id): raise Conflict('Ingredient does not belong to this recipe')
        before = existing[0] if existing else None
        if before:
            if type(request['expected_recipe']) is not int or request['expected_recipe']!=before['_revision']:
                raise Conflict('Recipe changed; reload before saving')
            values = {**fields,'updated_at':now()}
            db.execute('UPDATE recipes SET '+','.join(k+'=?' for k in values)+
                ',revision=revision+1 WHERE tenant_id=? AND id=?',list(values.values())+[principal.tenant_id,rid])
            after = store._read(db,principal,'recipes',[('id','eq',rid)])[0]
        else:
            if request['expected_recipe'] is not None: raise Conflict('Recipe no longer exists')
            after = store._insert(db,principal,'recipes',{'id':rid,**fields})
        store.audit(db,principal,'save-recipe','recipes',rid,before,after)
        for iid,item in old_by_id.items():
            if iid not in seen:
                db.execute('DELETE FROM recipe_ingredients WHERE tenant_id=? AND id=?',(principal.tenant_id,iid))
                store.audit(db,principal,'remove-ingredient','recipe_ingredients',iid,item,None)
        for item in ingredients:
            iid = item['id']
            values = {k:v for k,v in item.items() if k!='id'}
            if iid is None:
                added = store._insert(db,principal,'recipe_ingredients',{'recipe_id':rid,**values})
                store.audit(db,principal,'add-ingredient','recipe_ingredients',added['id'],None,added)
            elif any(old_by_id[iid][k]!=v for k,v in values.items()):
                db.execute('UPDATE recipe_ingredients SET '+','.join(k+'=?' for k in values)+
                    ',revision=revision+1 WHERE tenant_id=? AND id=?',list(values.values())+[principal.tenant_id,iid])
                changed = store._read(db,principal,'recipe_ingredients',[('id','eq',iid)])[0]
                store.audit(db,principal,'edit-ingredient','recipe_ingredients',iid,old_by_id[iid],changed)
        result = {**after,'recipe_ingredients':store._read(db,principal,'recipe_ingredients',[('recipe_id','eq',rid)])}
        store.audit(db,principal,'recipe-save-command','recipes',request['request_id'],None,
                    {'fingerprint':fingerprint,'result':result})
        return result
