// Unit-test rendering without controlling a browser or touching live services.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const web = path.join(__dirname, '../src/atlas_orchestrator/web');
const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.dataset = {}; this.style = {setProperty(){}}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute() {}
  addEventListener() {}
  querySelector(tag) { return this.children.find(x => x.tag === tag); }
}
const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(x => [x[1], new Element('div')]));
const document = { createElement: tag => new Element(tag), getElementById: id => {
  assert(nodes.has(id), `Missing HTML ID: ${id}`); return nodes.get(id);
}};
const trip = {id:'test', title:'Test Trip', trip_type:'personal', destination:'Example City', start_date:'2030-06-10', end_date:'2030-06-17',
  readiness:{all_verified:true, required:1, verified:1}, departure:{ready:false,label:'Departure Review Needed',checks:[]},
  financials:{preferred_card_used:true}, costs:{paid:{},later:{USD:250.50},miles:{},unknown_paid:1,unknown_miles:1},
  charges:[{merchant:'United',redemption:true,currency:'USD',status:'paid',card:'MileagePlus Miles'}],
  reservations:[{type:'Hotel',provider:'Family Stay',status:'not-needed',required:false,notes:'Staying With Family'},
    {type:'Flight',status:'ticketed',segments:[{from:'AUS',to:'IND',lounges:[{name:'Club',access:'available',basis:'Eligible Flight Required'}]}]}],
};
const state = {travel:{status:'healthy',trips:[trip],past_trips:[],loyalty:[],sources:[],summary:{upcoming:1,ready:1}}, travelView:'overview'};
const context = {document,state,console,Intl,Date,history:{replaceState(){}},window:{scrollTo(){}},
  safeText:(x,f='')=>x||f, titleCase:x=>String(x).replace(/\b\w/g,c=>c.toUpperCase()),
  formatMoney:(x,c='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency:c}).format(x)};
vm.createContext(context);
const js = fs.readFileSync(path.join(web,'atlas.js'),'utf8');
vm.runInContext(js.slice(js.indexOf('function displayName('),js.indexOf('function currentProfile(')),context);
vm.runInContext(js.slice(js.indexOf('function travelDate('), js.indexOf('function energyCards(')), context);
vm.runInContext('renderTravelPage(); renderTravelDetail("test");', context);
const allText = node => [node.textContent,...node.children.map(allText)].join(' ');
assert.equal(nodes.get('travel-expense-board').hidden,true);
assert.equal(nodes.get('travel-detail-readiness').textContent,'Bookings Complete');
assert.equal(nodes.get('travel-detail-later').textContent,'$250.50');
assert(!allText(nodes.get('travel-reservation-list')).includes('Confirmation Pending'));
assert(allText(nodes.get('travel-lounge-list')).includes('Check Access'));
assert(!nodes.get('travel-detail-charged').textContent.includes('$0.00'));
assert.equal(nodes.get('travel-detail-charged').textContent,'Reward Miles (Quantity Unrecorded)');
assert.equal(nodes.get('travel-detail-charged-note').textContent,'Fees —');
trip.trip_type='business';
vm.runInContext('renderTravelDetail("test");',context);
assert.equal(nodes.get('travel-expense-board').hidden,false);
state.travel.trips=[]; state.travel.past_trips=[trip];
assert.equal(vm.runInContext('renderTravelDetail("test")',context),true);
state.travel.loyalty_summary={lounge_passes_remaining:null};
vm.runInContext('renderTravelLoyaltyPage()',context);
assert.equal(nodes.get('loyalty-lounge-pass-count').textContent,'—');
assert(html.indexOf('id="travel-trip-list"') < html.indexOf('id="travel-attention-list"'));
assert(html.indexOf('id="travel-trip-list"') < html.indexOf('class="travel-summary-grid"'));
assert.match(html, /<details[^>]*id="travel-maintenance"[^>]*>/);
assert(!html.match(/<details[^>]*id="travel-maintenance"[^>]*open/));
const maintenance = html.slice(html.indexOf('id="travel-maintenance"'), html.indexOf('<article class="travel-detail"'));
for (const id of ['travel-source-list','travel-monitor-list','travel-audit-list']) assert(maintenance.includes(`id="${id}"`));
trip.reservations[1].segments[0].departure='2030-06-10T11:05:00-05:00';
state.travel.trips=[trip];
assert.equal(vm.runInContext('travelCountdown(state.travel.trips[0], Date.parse("2030-06-08T08:05:00-05:00")).text',context),'Departs in 2 days, 3 hours');
assert(!html.includes('id="home-travel-trips"'), 'Trip details now live on the Travel page');
trip.reservations[1].segments[0].departure='2030-06-10';
assert(vm.runInContext('travelCountdown(state.travel.trips[0]).text',context).includes('Time Unverified'));
const css=fs.readFileSync(path.join(web,'atlas.css'),'utf8');
assert.match(css, /\.travel-summary-grid/);
console.log('Travel UI: render paths, evidence, costs, personal/business, past trips and null states passed.');
