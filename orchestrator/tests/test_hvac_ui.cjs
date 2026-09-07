// Real UI handlers in a mocked DOM. Never connects to household equipment.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/atlas_orchestrator/web/atlas.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../src/atlas_orchestrator/web/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/atlas_orchestrator/web/atlas.css'), 'utf8');
const element = (dataset = {}) => ({dataset, textContent:'', disabled:false, events:{}, classList:{add(){},remove(){}}, addEventListener(type, handler){this.events[type]=handler;},focus(){this.focused=true;}});
const surfaces = ['home', 'environment', 'dialog'].map(name => ({name, current:element(), target:element(), operation:element(), status:element(), down:element({hvacAdjust:'-1'}), up:element({hvacAdjust:'1'}), apply:element()}));
const selectors = {'[data-hvac-current]':'current', '[data-hvac-target]':'target', '[data-hvac-operation]':'operation', '[data-hvac-status]':'status', '[data-hvac-apply]':'apply'};
const ids = new Map();
const byId = id => {if (!ids.has(id)) ids.set(id, element());return ids.get(id);};
const state = {home:null, hvacDraft:null};
let calls = [];
const context = {state, AbortSignal, Number, Math, Boolean, document:{querySelectorAll:selector => selector === '[data-hvac-adjust]' ? surfaces.flatMap(surface=>[surface.down,surface.up]) : surfaces.map(surface=>surface[selectors[selector]]), getElementById:byId, activeElement:byId('origin'), contains:()=>true, body:{classList:{add(){},remove(){}}}},
  renderEnvironmentSnapshot(){}, render(){}, safeText:(value,fallback)=>value || fallback,
  fetch:async (url, options)=>{calls.push({url,options});throw new Error('Unexpected request');}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function formatNumber('), source.indexOf('function serviceById(')),context);
vm.runInContext(source.slice(source.indexOf('function temperatureText('), source.indexOf('function environmentReading(')),context);
vm.runInContext(source.slice(source.indexOf('const hvacUi ='), source.indexOf('function renderError(')), context);
vm.runInContext(source.slice(source.indexOf('for (const button of document.querySelectorAll("[data-hvac-adjust]")) {', source.indexOf('document.getElementById("view-environment")')), source.indexOf('document.getElementById("entity-search").addEventListener')), context);
const ui = vm.runInContext('hvacUi', context);
const snapshot = (target=74, extras={}) => ({status:'healthy', climate:{state:'cool', hvac_action:'cooling', current_temperature:75, target_temperature:target, unit:'°F', ...extras}});
const reset = (home=snapshot()) => {state.home=home;state.status=null;state.hvacDraft=null;Object.assign(ui,{dirty:false,saving:false,needsRefresh:false,message:'',tone:'',pendingTarget:null});calls=[];context.renderHvacControl();};
const response = home => ({ok:true,json:async()=>({status:'accepted',target_temperature:75,snapshot:home})});

async function run() {
  for (const name of ['home','environment']) {
    const start = html.indexOf(`id="panel-${name}"`), end = html.indexOf('role="tabpanel"', start + 1);
    const panel = html.slice(start, end < 0 ? undefined : end);
    assert(panel.includes(`id="${name}-hvac-title"`), `${name} has visible inline controls`);
    for (const attr of ['data-hvac-current','data-hvac-target','data-hvac-adjust','data-hvac-apply','data-hvac-status']) assert(panel.includes(attr));
  }
  const allIds = [...html.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(allIds).size, allIds.length, 'no duplicate element IDs');
  assert.equal((html.match(/data-hvac-apply/g)||[]).length, 3);
  assert(css.includes('grid-template-columns: 2.75rem minmax(0, 5.25rem) 2.75rem;'), 'target cluster has bounded columns, not a stretching middle track');
  assert(!css.includes('.hvac-inline-setpoint { width: min(100%, 18rem);'), 'responsive layout must not spread the buttons apart again');

  reset();
  assert(surfaces.every(surface=>surface.target.textContent==='74°F' && surface.apply.disabled));
  surfaces[0].up.events.click();
  assert(surfaces.every(surface=>surface.target.textContent==='75°F' && !surface.apply.disabled));
  assert.equal(calls.length,0,'adjustment alone never sends');
  context.openHomeControl('hvac');context.closeHomeControl();
  assert.equal(state.hvacDraft,75,'opening the dialog preserves the shared draft');
  assert.equal(calls.length,0,'opening/closing controls never sends');
  assert.equal(byId('origin').focused,true);
  state.home=snapshot(72);context.renderHvacControl();
  assert.equal(state.hvacDraft,75,'refresh does not overwrite an unapplied selection');

  for (const home of [null,{status:'unavailable'},snapshot(null),snapshot(NaN),snapshot(59),snapshot(86),snapshot(74,{state:'unavailable'}),snapshot(74,{state:'unknown'}),snapshot(23,{unit:'°C'})]) {
    reset(home);context.adjustTemperature(1);await context.applyTemperature();
    assert(surfaces.every(surface=>surface.up.disabled && surface.down.disabled && surface.apply.disabled));
    assert.equal(calls.length,0,'unavailable or unsupported controls never send');
  }
  reset(snapshot(null,{current_temperature:null}));
  assert(surfaces.every(surface=>surface.current.textContent==='N/A' && surface.target.textContent==='N/A'),'no invented default or zero');
  reset(snapshot(74,{unit:null}));
  assert(!surfaces[0].up.disabled,'existing Fahrenheit adapter allows absent display unit');
  reset(snapshot(60));context.adjustTemperature(-1);assert.equal(state.hvacDraft,60);assert(surfaces.every(surface=>surface.down.disabled));
  reset(snapshot(85));context.adjustTemperature(1);assert.equal(state.hvacDraft,85);assert(surfaces.every(surface=>surface.up.disabled));
  for (const target of [73.4,73.5,73.9,74.5]) {
    reset(snapshot(target,{current_temperature:72.5}));
    assert.equal(state.home.climate.target_temperature,target,'raw telemetry retains its precision');
    assert(surfaces.every(surface=>surface.target.textContent===`${Math.round(target)}°F` && surface.current.textContent==='72.5°F' && surface.apply.disabled));
    context.adjustTemperature(1);assert.equal(state.hvacDraft,Math.round(target)+1,'adjusts in whole degrees from the displayed target');
    context.adjustTemperature(-1);assert.equal(state.hvacDraft,Math.round(target));
  }
  reset(snapshot(60.4));assert(surfaces.every(surface=>surface.down.disabled),'displayed 60-degree minimum');
  reset(snapshot(84.6));assert(surfaces.every(surface=>surface.up.disabled),'displayed 85-degree maximum');
  reset();state.hvacDraft=74.5;ui.dirty=true;await context.applyTemperature();assert.equal(calls.length,0,'UI never sends fractional targets');

  reset(snapshot(73.5));context.adjustTemperature(1);
  let resolveRequest;
  context.fetch = (url,options) => {calls.push({url,options});return new Promise(resolve=>{resolveRequest=resolve;});};
  const pending = surfaces[1].apply.events.click();
  await surfaces[0].apply.events.click();
  context.adjustTemperature(-1);
  assert.equal(calls.length,1,'all surfaces share a single submission lock');
  assert.equal(calls[0].url,'/v1/home/hvac');
  assert.deepEqual(JSON.parse(calls[0].options.body),{temperature:75});
  assert(calls[0].options.signal);
  assert.equal(state.hvacDraft,75,'pending request draft cannot race with an adjustment');
  assert(surfaces.every(surface=>surface.apply.disabled && surface.up.disabled && surface.down.disabled));
  resolveRequest(response(snapshot(75)));await pending;
  assert(surfaces.every(surface=>surface.target.textContent==='75°F' && surface.status.textContent==='Target confirmed at 75°F.'));

  reset();context.adjustTemperature(1);
  context.fetch = async()=>response(snapshot(74));
  await context.applyTemperature();
  assert(surfaces.every(surface=>surface.target.textContent==='74°F' && surface.status.textContent.includes('Requested 75°F. Awaiting thermostat confirmation')),'accepted is not confirmed');
  state.home=snapshot(74.9);context.renderHvacControl();
  assert(surfaces.every(surface=>surface.target.textContent==='75°F' && surface.status.textContent.includes('Awaiting thermostat confirmation')),'rounded display must not falsely confirm raw readback');
  state.home=snapshot(75);context.renderHvacControl();
  assert(surfaces.every(surface=>surface.status.textContent.startsWith('Target confirmed')));
  reset();context.adjustTemperature(1);context.fetch=async()=>response({status:'unavailable'});await context.applyTemperature();
  assert(surfaces.every(surface=>surface.apply.disabled && surface.target.textContent==='N/A'));
  for (const failure of [async()=>{throw new Error('Timeout');},async()=>({ok:false,json:async()=>({error:'Rejected'})}),async()=>({ok:true,json:async()=>({status:'failed'})})]) {
    reset();context.adjustTemperature(1);context.fetch=failure;await context.applyTemperature();
    assert(surfaces.every(surface=>surface.status.textContent.includes('Unable to confirm') && surface.apply.disabled));
    assert(!surfaces[0].status.textContent.includes('was not changed'),'transport errors must not claim the command never arrived');
    let retryCount=0;
    context.fetch=async()=>{retryCount+=1;throw new Error('Must not retry before refresh');};
    context.adjustTemperature(-1);await context.applyTemperature();
    assert.equal(retryCount,0,'no second POST until a fresh thermostat read');
    assert.equal(ui.needsRefresh,true);
    assert(surfaces.every(surface=>surface.up.disabled && surface.down.disabled && surface.apply.disabled));
    assert.equal(state.hvacDraft,null,'old target must not be reused after an uncertain write');
  }

  // Exercise actual refresh handler: older reads cannot replace newer write readback.
  context.renderError=()=>{};
  for (const name of ['renderEnergyPage','renderEnvironmentPage','renderEntityInventory','renderQuickLights','renderSecurityPage','renderTravelPage','renderHousehold','renderAgents']) context[name]=()=>{};
  vm.runInContext(source.slice(source.indexOf('async function refresh('), source.indexOf('document.getElementById("refresh-status").addEventListener')),context);
  reset();
  let releaseHome;
  context.fetchSnapshot=async url=>({ok:true,json:()=>url==='/v1/home/status' ? new Promise(resolve=>{releaseHome=resolve;}) : Promise.resolve({})});
  const olderRefresh=context.refresh();
  while (!releaseHome) await Promise.resolve();
  context.adjustTemperature(1);context.fetch=async()=>response(snapshot(75));await context.applyTemperature();
  releaseHome(snapshot(70));await olderRefresh;
  assert.equal(state.home.climate.target_temperature,75,'old refresh cannot overwrite post-command readback');
  context.fetchSnapshot=async()=>null;
  await context.refresh();
  assert(surfaces.every(surface=>surface.up.disabled && surface.target.textContent==='N/A'),'failed refresh disables stale controls');
  reset();context.adjustTemperature(1);context.fetch=async()=>{throw new Error('Timeout');};await context.applyTemperature();
  context.fetchSnapshot=async url=>({ok:true,json:async()=>url==='/v1/home/status' ? snapshot(75) : {}});
  await context.refresh();
  assert.equal(ui.needsRefresh,false,'fresh Home read unlocks controls after uncertainty');
  context.adjustTemperature(-1);
  assert.equal(state.hvacDraft,74,'next adjustment uses the new confirmed reading, not the old 74-degree target');
  console.log('HVAC UI: both pages and dialog, shared draft, bounds, unavailable states, confirmation, duplicate submits, refresh races, and failures passed. No live commands sent.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
