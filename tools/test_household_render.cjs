// Render real UI handlers against demo fixtures, without browser or household access.
"use strict";
const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict");
const web="orchestrator/src/atlas_orchestrator/web/";
const html=fs.readFileSync(web+"index.html","utf8"),js=fs.readFileSync(web+"atlas.js","utf8");
class Element {
 constructor(tag="div"){this.tag=tag;this.children=[];this.textContent="";this.dataset={};this.style={setProperty(){}};this.classList={toggle(){}};this.value="";this.options=[{}];this.nextElementSibling={};}
 append(...items){this.children.push(...items);}
 prepend(...items){this.children.unshift(...items);}
 insertBefore(child){this.append(child);}
 replaceChildren(...items){this.children=items;}
 setAttribute(){}
 addEventListener(){}
 querySelector(){return new Element();}
}
const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
const listeners=[];
const document={createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element(),{textContent:text}),addEventListener:(event,fn)=>{if(event==="DOMContentLoaded")listeners.push(fn);},
 getElementById:id=>{assert(nodes.has(id),id);return nodes.get(id);}};
const window={scrollTo(){}};
const state={travelView:"overview"};
const context={document,window,state,Date,Intl,URL,Response,console,location:{href:"http://localhost:8088/",origin:"http://localhost:8088"},history:{replaceState(){}},
 safeText:(x,f="")=>x??f,titleCase:x=>String(x).replace(/\b\w/g,c=>c.toUpperCase()),humanTime:()=> "Example time",
 formatMoney:(x,c="USD")=>new Intl.NumberFormat("en-US",{style:"currency",currency:c}).format(x),
 renderCyberHealth(){}};
vm.createContext(context);
for(const file of ["energy-samples.js","household-samples.js","demo.js"])vm.runInContext(fs.readFileSync("demo/"+file,"utf8"),context);
const text=node=>[node.textContent,...node.children.map(text)].join(" ");
(async()=>{
 state.travel=await(await window.fetch("/v1/travel")).json();
 state.pantry=await(await window.fetch("/v1/galleyquest/status")).json();
 state.ids=await(await window.fetch("/v1/security/vacation-ids")).json();
 state.inventory=await(await window.fetch("/v1/home/entities")).json();
 for(const [start,end] of [
  ["function travelDate(","function energyCards("],
  ["function fillPantryChips(","function formatMoney("],
  ["function renderEntityInventory(","async function setHomeControl("],
  ["function renderSecurityPage(","function renderCyberHealth("]
 ]){assert(js.includes(start)&&js.includes(end),start);vm.runInContext(js.slice(js.indexOf(start),js.indexOf(end)),context);}
 listeners[0](); // Only fixture sections, no demo mutation observer needed.
 assert(text(nodes.get("panel-security")).includes("Cloud Gateway Fiber"));
 assert(text(nodes.get("panel-security")).includes("196 W"));
 assert(text(nodes.get("panel-pantry")).includes("Arroz con Pollo"));
 vm.runInContext("renderPantryPage(); renderSecurityPage();",context);
 assert.equal(nodes.get("pantry-meal-count").textContent,"4");
 assert.equal(nodes.get("pantry-meal-count").nextElementSibling.textContent,"Next Week");
 assert.equal(nodes.get("pantry-cart-count").textContent,"9");
 assert(text(nodes.get("ids-sensors")).includes("Kitchen Window · Zigbee Window Contact: Open"));
 assert(!text(nodes.get("ids-sensors")).includes("Unavailable"));
 nodes.get("entity-category").value="all";
 vm.runInContext("renderEntityInventory()",context);
 assert(text(nodes.get("entity-list")).includes("Guest Bath"));
 vm.runInContext("renderTravelPage();renderHomeTravelTrips()",context);
 for(const trip of state.travel.trips){
  assert.equal(vm.runInContext(`renderTravelDetail("${trip.id}")`,context),true);
  for(const id of ["travel-detail-meta","travel-detail-card","travel-reservation-list","travel-charge-list","travel-lounge-list"]){
   const content=text(nodes.get(id));assert(!/N\/A|undefined|NaN|Delta|Hilton|National Car/.test(content),id+": "+content);
  }
  assert(text(nodes.get("travel-detail-card")).includes("United Explorer"));
  assert(text(nodes.get("travel-reservation-list")).includes("Hertz"));
  assert(text(nodes.get("travel-reservation-list")).includes("IHG"));
 }
 vm.runInContext("renderTravelLoyaltyPage()",context);
 assert.equal(nodes.get("loyalty-program-count").textContent,"3");
 assert.equal(nodes.get("loyalty-lounge-pass-count").textContent,"2");
 assert(text(nodes.get("travel-loyalty-list")).includes("Hertz Gold Plus Rewards"));
 console.log("Household rendering: UniFi, 18 IDS sensors, 4 meals, 9 pending purchases, sensor inventory, 2 trip details, and 3 rewards programs passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});
