const assert = require('node:assert/strict');
const energy = require('../src/atlas_orchestrator/web/energy-ui.js');
assert.deepEqual(energy.amount(12345.678, true), {value: '12.3', unit: 'MWh'});
assert.deepEqual(energy.amount(null), {value:'Not available',unit:''});
assert.equal(energy.percent(.2, 2100), '<1%');
assert.equal(energy.percent(0, 0), '');
assert.equal(energy.stepDate('2026-01-31','month',1), '2026-02-01');
assert.equal(energy.stepDate('2024-02-29','year',1), '2025-01-01');
assert.equal(energy.stepDate('2026-03-01','day',-1), '2026-02-28');
const values = Object.fromEntries(Object.values(energy.definitions).flatMap(view => view.groups.flatMap(group => group[2].map(row => [row[1],1]))));
const data = {period:'day',start:'2026-09-05T00:00:00-05:00',end:'2026-09-06T00:00:00-05:00', interval_seconds:300, totals:values,
  buckets:[{at:'2026-09-05T12:00:00-05:00',values,key:'2026-09-05'}, {at:'2026-09-05T12:05:00-05:00',values,key:'2026-09-05'}],
  charge_level:[{at:'2026-09-05T12:00:00-05:00',percent:50},{at:'2026-09-05T12:15:00-05:00',percent:55}]};
for (const width of [250,320,390,768,1200]) for (const view of Object.keys(energy.definitions)) for (const period of ['day','month','year']) {
  const markup = energy.chartMarkup({...data,period},view,width);
  assert.ok(markup.includes('<svg'), `${view}/${period}/${width}`);
  assert.ok(!/NaN|Infinity|undefined/.test(markup), `${view}/${period}/${width}`);
  assert.ok(markup.includes(period==='day'?'kW':'kWh'));
}
assert.ok(energy.chartMarkup(data,'battery',320,true).includes('Powerwall charge level'));
assert.ok(energy.chartMarkup(data,'solar',700).includes('viewBox="0 0 700 240"'));
assert.ok(energy.chartMarkup(data,'solar',390).includes('viewBox="0 0 390 220"'));
assert.ok(energy.chartMarkup(data,'battery',390,true).includes('viewBox="0 0 390 115"'));
assert.ok(energy.chartMarkup({},'solar').includes('No chart data'));
const missing = {...data,buckets:data.buckets.map(row => ({...row,values:{}}))};
assert.ok(!/NaN|Infinity/.test(energy.chartMarkup(missing,'solar',320)));
console.log('Energy UI: formatting, dates, four views, three periods, five widths, and missing data passed.');

// Minimal DOM harness verifies actual UI handlers without a browser or household writes.
const fs = require('node:fs'), vm = require('node:vm');
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id,{id,clientWidth:390,innerHTML:'',textContent:'',value:'',dataset:{},events:{},style:{setProperty(){}},setAttribute(){},addEventListener(type,callback){this.events[type]=callback;}});
  return nodes.get(id);
}
const buttons = Object.keys(energy.definitions).map(key => {const button=node(key);button.dataset.energyView=key;return button;});
const pending=[];
const harness={window:{},document:{getElementById:node,querySelectorAll:()=>buttons},Date,Intl,AbortSignal,console,fetch:url=>new Promise(resolve=>pending.push({url,resolve}))};
vm.createContext(harness);
vm.runInContext(fs.readFileSync(require.resolve('../src/atlas_orchestrator/web/energy-ui.js'),'utf8'),harness);
const reply=(job,solar)=>job.resolve({ok:true,json:async()=>({...data,status:'healthy',totals:{...values,solar_kwh:solar,battery_discharge_kwh:2100,battery_charge_kwh:2222.2},references:[],context:[]})});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  const initial=harness.window.AtlasEnergy.load();reply(pending.shift(),1);await initial;
  node('energy-prev').events.click();const previous=pending.shift();
  node('energy-next').events.click();const current=pending.shift();
  assert.ok(current,'returning to A must not reuse a cache key without its payload');
  reply(previous,999);await tick();assert.ok(!node('energy-headline').innerHTML.includes('999'));
  reply(current,1);await tick();assert.ok(node('energy-headline').innerHTML.includes('1.0'));
  node('energy-period').events.change({target:{value:'year'}});reply(pending.shift(),10000);await tick();
  node('battery').events.click();assert.ok(node('energy-headline').innerHTML.includes('2,100.0'));
  assert.ok(!node('energy-headline').innerHTML.includes('MWh'));
  console.log('Energy DOM handlers: out-of-order navigation and exact Powerwall year precision passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
