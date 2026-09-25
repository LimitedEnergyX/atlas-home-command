// Real Maintenance UI, synthetic DOM, and no live services.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/atlas_orchestrator/web/maintenance-ui.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const payload=records=>({status:'healthy',records,summary:{overdue:0,due_soon:records.length,completed:0}});
function harness(){
 const elements=new Map(),requests=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',events:{},addEventListener(name,handler){this.events[name]=handler;}});return elements.get(id);};
 const button={disabled:false},form=element('maintenance-form');
 form.values={equipment:'Example equipment',task:'Inspect filter',due_date:'2030-06-10'};
 form.resets=0;form.reset=()=>{form.resets++;form.values={};};form.querySelector=()=>button;
 const context={setInterval(){},window:{addEventListener(){}},document:{getElementById:element,addEventListener(){}},AbortSignal:{timeout:()=>({})},
 FormData:class{constructor(target){return new Map(Object.entries(target.values));}},
 fetch:(path,options)=>new Promise((resolve,reject)=>requests.push({path,options,reject,respond(data,status=200){resolve({ok:status>=200&&status<300,status,json:async()=>data});}}))};
 vm.runInNewContext(source,context);
 return {element,form,button,requests,ui:context.window.AtlasMaintenance,submit:()=>form.events.submit({preventDefault(){},currentTarget:form})};
}
(async()=>{
 {
 const h=harness(),initial=h.ui.load(),save=h.submit();
 assert.equal(h.requests[0].options.method,'GET');assert.equal(h.requests[1].options.method,'POST');
 h.requests[1].respond({status:'saved',id:'new-task'});await tick();
 assert.equal(h.requests.length,2);assert(h.button.disabled);
 h.requests[0].respond(payload([]));await tick();
 assert.equal(h.requests.length,3);assert.equal(h.requests[2].options.method,'GET');
 h.requests[2].respond(payload([{id:'new-task',equipment:'Example equipment',task:'Inspect filter',due_date:'2030-06-10',notes:'',completed_at:null,state:'due_soon'}]));
 await Promise.all([initial,save]);assert.equal(h.ui.snapshot.records[0].id,'new-task');
 assert.match(h.element('maintenance-records').innerHTML,/Inspect Filter/);
 assert.equal(h.form.resets,1);assert.equal(h.button.disabled,false);
 }
 {
 const h=harness(),before={...h.form.values},save=h.submit();
 h.requests[0].reject(new TypeError('Response lost'));await save;
 assert.equal(h.form.resets,0);assert.deepEqual(h.form.values,before);assert(!h.button.disabled);
 const message=h.element('maintenance-form-status').textContent;
 assert.match(message,/could not be confirmed/i);assert.match(message,/Refresh.*before retrying/i);assert.doesNotMatch(message,/not saved|rejected/i);
 }
 {
 const h=harness(),read=h.ui.load();
 h.requests[0].respond(payload([{id:'id" data-test="injected',state:'due_soon" data-test="injected',equipment:'<img src=x onerror="bad">',task:'A&B',due_date:'2030-06-10',notes:'<script>alert("x")</script>',completed_at:null}]));
 await read;const html=h.element('maintenance-records').innerHTML;
 assert.doesNotMatch(html,/<img|<script| data-test="injected/);assert.match(html,/&lt;img/);assert.match(html,/A&amp;B/);assert.match(html,/id&quot; data-test=&quot;injected/);
 }
 console.log('Maintenance UI: refresh ordering, uncertain save, and escaping passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
