// Runs responsive DOM placement and orientation only. No household API calls.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname,'../src/atlas_orchestrator/web/atlas.js'),'utf8');

function checkLayout(initialWidth) {
  const queries = new Map();
  const stage = {children:[]}, panel = {children:[]};
  const rail = {attributes:{},setAttribute(name,value){this.attributes[name]=value;}};
  const setpoint = {value:72,focusCalls:0,focus(options){this.focusCalls++;assert.equal(options.preventScroll,true);}};
  const hvac = {parentElement:panel,contains(node){return node===setpoint;}};
  function anchor(parentElement) {
    return {parentElement,before(node){
      node.parentElement.children.splice(node.parentElement.children.indexOf(node),1);
      this.parentElement.children.splice(this.parentElement.children.indexOf(this),0,node);
      node.parentElement=this.parentElement;
    }};
  }
  const grid=anchor(stage), preview=anchor(panel);
  stage.children=[grid]; panel.children=[stage,hvac,preview];
  const context={document:{
    activeElement:null,
    querySelector(selector){return selector==='.module-rail'?rail:grid;},
    getElementById(id){return id==='home-hvac'?hvac:preview;},
  },window:{matchMedia(query){
    const media={matches:initialWidth<=Number(query.match(/\d+/)[0]),listeners:[],addEventListener(type,handler){assert.equal(type,'change');this.listeners.push(handler);}};
    queries.set(query,media);return media;
  }}};
  vm.createContext(context);
  const start=source.indexOf('function setupResponsiveLayout()');
  const end=source.indexOf('\nfunction activateTab(',start);
  vm.runInContext(source.slice(start,end),context);
  const verify=width=>{
    assert.equal(rail.attributes['aria-orientation'],width<=700?'horizontal':'vertical');
    const before=width<=820?grid:preview;
    assert.equal(hvac.parentElement,before.parentElement);
    assert.equal(before.parentElement.children.indexOf(hvac)+1,before.parentElement.children.indexOf(before));
    assert.equal([...stage.children,...panel.children].filter(node=>node===hvac).length,1,'move controls without duplicating');
    assert.equal(setpoint.value,72,'preserve existing control state');
  };
  verify(initialWidth);
  for (const width of [320,428,700,701,820,821,1280,360,1280]) {
    context.document.activeElement=setpoint;
    const previousParent=hvac.parentElement;
    const previousFocusCalls=setpoint.focusCalls;
    for (const [query,media] of queries) {
      const matches=width<=Number(query.match(/\d+/)[0]);
      if(matches!==media.matches){media.matches=matches;media.listeners.forEach(handler=>handler());}
    }
    verify(width);
    assert.equal(setpoint.focusCalls-previousFocusCalls,previousParent===hvac.parentElement?0:1);
  }
}
checkLayout(1280);
checkLayout(320);
console.log('Responsive layout: initial mobile/desktop, 700/820 boundaries, same-node placement, state, and focus preservation passed.');
