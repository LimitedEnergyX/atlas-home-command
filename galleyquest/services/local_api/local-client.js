/* Compatibility bridge only. Persistence, authorization, and transactions live on server. */
(() => {
  'use strict';
  const revisions = new Map();
  const remember = (table, rows) => {
    for (const row of rows) {
      if (row.id && Number.isInteger(row._revision)) revisions.set(`${table}:${row.id}`, row._revision);
      if (Array.isArray(row.recipe_ingredients)) remember('recipe_ingredients',row.recipe_ingredients);
    }
  };
  class Query {
    constructor(table) { this.request={table,operation:'select',filters:[]}; this.options={}; }
    select(fields='*',options={}) { this.fields=fields; this.options=options; return this; }
    insert(values) { this.request.operation='insert'; this.request.values=values; return this; }
    update(values) { this.request.operation='update'; this.request.values=values; return this; }
    delete() { this.request.operation='delete'; return this; }
    upsert(values,options={}) {
      if (options.onConflict && options.onConflict !== 'week_start_date,item_key') throw Error('Unsupported conflict key');
      this.request.operation='upsert'; this.request.values=values; return this;
    }
    eq(key,value) { this.request.filters.push([key,'eq',value]); return this; }
    in(key,value) { this.request.filters.push([key,'in',value]); return this; }
    gte(key,value) { this.request.filters.push([key,'gte',value]); return this; }
    order(key) { this.request.order=key; return this; }
    single() { this.one=true; return this; }
    then(resolve,reject) { return this.run().then(resolve,reject); }
    async run() {
      try {
        if (['update','delete'].includes(this.request.operation)) {
          this.request.expected={};
          for (const [key,value] of revisions) if (key.startsWith(this.request.table+':'))
            this.request.expected[key.slice(this.request.table.length+1)]=value;
        }
        const response=await fetch('/api/v1/query',{
          method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
          body:JSON.stringify(this.request)
        });
        const body=await response.json();
        if (!response.ok) throw Error(body.error || 'Local database request failed');
        remember(this.request.table,body.data);
        if (this.one && body.data.length!==1) throw Error('Expected exactly one record');
        return {data:this.options.head?null:(this.one?body.data[0]:body.data),
                count:this.options.count?body.data.length:null,error:null};
      } catch(error) { return {data:null,error:{message:error.message},count:null}; }
    }
  }
  window.supabase={createClient:()=>({from:table=>new Query(table)})};
})();
