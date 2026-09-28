const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const web = path.join(__dirname,'../src/atlas_orchestrator/web');
const js = fs.readFileSync(path.join(web,'atlas.js'),'utf8');
const html = fs.readFileSync(path.join(web,'index.html'),'utf8');
class Element {
  constructor() { this.textContent=''; this.children=[]; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children=items; }
}
const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
const document = {createElement:()=>new Element(),getElementById:id=>{assert(nodes.has(id),id);return nodes.get(id);}};
const state = {cyber:{status:'partial',fresh:true,summary:{passed:4,total:4,high:0,review:0},checks:[{id:'test',label:'Firewall',status:'pass'}],channels:[{name:'Defender',status:'current'},{name:'Security',status:'access_denied'},{name:'Sysmon',status:'stopped'}],findings:[]}};
const ctx = {state,document,safeText:(x,f)=>x||f,humanTime:()=> 'Now'};
vm.createContext(ctx);
vm.runInContext(js.slice(js.indexOf('function displayName('),js.indexOf('function currentProfile(')),ctx);
vm.runInContext(js.slice(js.indexOf('function cyberLabel('),js.indexOf('function systemNotices(')),ctx);
vm.runInContext(js.slice(js.indexOf('function statusClass('),js.indexOf('function setOverall(')),ctx);
vm.runInContext(js.slice(js.indexOf('function renderCyberHealth('),js.indexOf('async function setVacationIDS(')),ctx);
const text = e=>[e.textContent,...e.children.map(text)].join(' ');
ctx.renderCyberHealth();
assert.equal(nodes.get('security-server-summary').textContent,'Telemetry Incomplete');
assert(text(nodes.get('security-gauge-grid')).includes('4 / 4'));
assert(text(nodes.get('security-gauge-grid')).includes('1 / 3'));
assert(text(nodes.get('security-control-list')).includes('Administrator Activation Needed'));
state.cyber.fresh=false; state.cyber.status='stale'; ctx.renderCyberHealth();
assert.equal(nodes.get('security-server-summary').textContent,'Collector Is Stale');
assert(!text(nodes.get('security-gauge-grid')).includes('4 / 4'));
assert(!text(nodes.get('security-gauge-grid')).includes('100%'));
state.cyber={}; ctx.renderCyberHealth();
assert.equal(nodes.get('security-server-summary').textContent,'Awaiting Collector');
console.log('Cyber UI: live/partial/stale/missing evidence and DOM bindings passed.');
