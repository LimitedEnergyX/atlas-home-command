// Runs real one-tap routing handlers without calling household APIs.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname,'../src/atlas_orchestrator/web/atlas.js'),'utf8');
const modules = ['home','energy','environment','security','pantry','travel','maintenance','systems','agents','notifications'];
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id,{id,dataset:{},attributes:{},firstChild:{},events:{},classList:{toggle(){}},setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name];},focus(){for(const item of elements.values()) item.focused=false;this.focused=true;},addEventListener(type,fn){this.events[type]=fn;}});
  return elements.get(id);
};
const tiles = modules.map(name => {const tile=element(`tile-${name}`);tile.dataset.tabTarget=name;tile.closest=()=>true;return tile;});
const tablist = element('module-rail');
tablist.setAttribute('aria-orientation','vertical');
const rail = modules.map(name => {const tab=element(`tab-${name}`);tab.dataset.tab=name;tab.closest=()=>tablist;return tab;});
const panels = modules.map(name => ({id:`panel-${name}`,hidden:name!=='home'}));
const context = {state:{preview:'home',forecast:null,home:null},tabs:rail,panels,atlasChatDialog:{open:false},location:{hash:'#home'},window:{scrollTo(){}},
  document:{querySelectorAll:()=>tiles,getElementById:element,body:{classList:{toggle(){}}}},
  setPreviewCards:cards=>{context.cards=cards;},homeCards:()=>[],energyCards:()=>[],homeEnvironmentSummary:()=>['72°F','Indoor'],
  environmentReading:()=>null,readingText:()=>'-',
  loadEnergyHistory(){},loadEnvironmentHistory(){},loadHousehold(){},renderEnvironmentPage(){},renderPantryPage(){},renderTravelPage(){},renderEntityInventory(){},renderAgents(){},renderSecurityPage(){},renderHomeTravelTrips(){},
};
context.history={replaceState(_state,_title,hash){context.location.hash=hash;}};
context.window.AtlasEnergy={open(){}};
context.window.AtlasMaintenance={load(){}};
context.window.AtlasCalendar={load(){}};
vm.createContext(context);
for (const [start,end] of [
  ['function activateTab(', '\nfor (const tab of tabs)'],
  ['\nfor (const tab of tabs) {', '\nfor (const trigger of document.querySelectorAll("[data-tab-target]"))'],
  ['function safeText(', '\nfunction serviceById('],
  ['for (const trigger of document.querySelectorAll("[data-tab-target]"))', '\nfunction updateClock('],
]) vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),context);

const environment = element('tile-environment');
environment.events.click({detail:1});
assert.equal(context.location.hash,'#environment');
assert.equal(panels.find(panel=>panel.id==='panel-environment').hidden,false);
assert.equal(element('tab-environment').focused,true);

for (const name of modules.filter(name=>name!=='home'&&name!=='notifications')) {
  context.activateTab('home'); context.state.preview='home';
  element(`tile-${name}`).events.click({detail:1});
  assert.equal(context.location.hash,`#${name}`,name);
  assert.equal(element(`tile-${name}`).events.dblclick,undefined);
}
context.activateTab('home');context.state.preview='home';
environment.events.click({detail:0});
assert.equal(context.location.hash,'#environment','keyboard activation navigates immediately');
function key(name,key) {
  let prevented=false;
  element(`tab-${name}`).events.keydown({key,preventDefault(){prevented=true;}});
  return prevented;
}
function selected(name) {
  assert.equal(context.location.hash,`#${name}`);
  assert.equal(element(`tab-${name}`).focused,true);
  for (const tab of rail) {
    const active=tab.dataset.tab===name;
    assert.equal(tab.getAttribute('aria-selected'),String(active));
    assert.equal(tab.tabIndex,active?0:-1);
  }
}
for (const [orientation,next,previous,unused] of [
  ['vertical','ArrowDown','ArrowUp',['ArrowLeft','ArrowRight']],
  ['horizontal','ArrowRight','ArrowLeft',['ArrowUp','ArrowDown']],
]) {
  tablist.setAttribute('aria-orientation',orientation);
  context.activateTab('home',true);
  assert.equal(key('home',next),true); selected('energy');
  assert.equal(key('energy',previous),true); selected('home');
  assert.equal(key('home',previous),true); selected('notifications');
  assert.equal(key('notifications',next),true); selected('home');
  assert.equal(key('home','End'),true); selected('notifications');
  assert.equal(key('notifications','Home'),true); selected('home');
  for (const ignored of [...unused,'Tab','Enter']) {
    assert.equal(key('home',ignored),false); selected('home');
  }
}
context.location.replace = path => { context.destination = path; };
context.activateTab('argo');
assert.equal(context.destination, '/argo/', 'Vehicles and legacy #argo must open the imported fleet site');
context.destination = null;
const argoTile=tiles[0];argoTile.dataset.tabTarget='argo';
argoTile.events.click({detail:1});
assert.equal(context.destination, '/argo/', 'A single Home vehicle-card tap opens the full site');
console.log('Home navigation: single-tap destinations, keyboard activation, fleet routing, and responsive rail keyboard handlers passed.');
