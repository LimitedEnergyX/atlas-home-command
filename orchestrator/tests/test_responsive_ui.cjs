// Home controls stay in document order; only the module rail orientation changes.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/atlas_orchestrator/web/atlas.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../src/atlas_orchestrator/web/index.html'),'utf8');
const home=html.slice(html.indexOf('id="panel-home"'),html.indexOf('<section class="control-overlay"'));
assert(home.indexOf('class="home-module-grid"') < home.indexOf('id="home-hvac"'));
assert(!home.includes('home-preview'));
assert.equal((home.match(/id="home-hvac"/g)||[]).length,1);
assert(!home.slice(home.indexOf('data-hvac-status')).includes('<section'),'HVAC must be the last Home section');
for(const initialWidth of [320,1280]){
  const queries=new Map();
  const rail={setAttribute(name,value){this[name]=value;}};
  const context={document:{querySelector(selector){assert.equal(selector,'.module-rail');return rail;}},
    window:{matchMedia(query){const media={matches:initialWidth<=700,listeners:[],addEventListener(type,fn){this.listeners.push(fn);}};queries.set(query,media);return media;}}};
  vm.createContext(context);
  const start=source.indexOf('function setupResponsiveLayout()');
  vm.runInContext(source.slice(start,source.indexOf('\nfunction activateTab(',start)),context);
  assert.equal(rail['aria-orientation'],initialWidth<=700?'horizontal':'vertical');
  for(const width of [320,700,701,820,1280]){
    for(const media of queries.values()){media.matches=width<=700;media.listeners.forEach(fn=>fn());}
    assert.equal(rail['aria-orientation'],width<=700?'horizontal':'vertical');
  }
}
const css=fs.readFileSync(path.join(__dirname,'../src/atlas_orchestrator/web/atlas.css'),'utf8');
const fleetCss=fs.readFileSync(path.join(__dirname,'../src/atlas_orchestrator/web/argo/assets/css/fleet.css'),'utf8');
assert(css.includes('@media (min-width: 1024px) {\n  body { zoom: .8; }'));
assert(css.includes('height: calc(var(--agent-viewport-height, 100dvh) / .8)'));
assert(!fleetCss.includes('zoom:'),'Argo must remain at full size');
const energy=html.slice(html.indexOf('id="panel-energy"'),html.indexOf('id="panel-environment"'));
assert(energy.indexOf('id="energy-history-chart"')<energy.indexOf('class="energy-sidebar"'));
for(const id of ['energy-history-chart','energy-page-solar','energy-page-home','energy-page-battery','energy-page-grid','energy-financial-list']){
  assert.equal((energy.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
}
console.log('Responsive layout: Home ends at HVAC, desktop Atlas uses 80% density, Argo stays unscaled, and Sol has one chart with a summary sidebar.');
