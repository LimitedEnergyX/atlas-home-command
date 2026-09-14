"""Application query boundary used by the compatibility client and later UIs."""
from store import TABLES

def execute(store,principal,request):
    if set(request)-{'table','operation','values','filters','order','expected'}:
        raise ValueError('Unknown request fields; tenant identity is server-controlled')
    table=request['table']; operation=request.get('operation','select')
    filters=request.get('filters',[])
    if not isinstance(filters,list) or len(filters)>20: raise ValueError('Invalid filters')
    if operation=='select':
        rows=store.read(principal,table,filters,request.get('order'))
        if table=='recipes':
            ingredients=store.read(principal,'recipe_ingredients')
            grouped={}
            for row in ingredients: grouped.setdefault(row['recipe_id'],[]).append(row)
            rows=[dict(row,recipe_ingredients=grouped.get(row['id'],[])) for row in rows]
        elif table=='meal_plan':
            recipes={row['id']:row for row in store.read(principal,'recipes')}
            rows=[dict(row,recipe=recipes.get(row.get('recipe_id'))) for row in rows]
        return rows
    return store.mutate(principal,table,operation,request.get('values'),filters,request.get('expected'))
