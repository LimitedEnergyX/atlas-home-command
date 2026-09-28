"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};
const context={window,document:{addEventListener(){}},location:{href:'http://localhost:8088/atlas/',origin:'http://localhost:8088'},URL,Response,Date,console};
vm.runInNewContext(fs.readFileSync('demo/energy-samples.js','utf8'),context);
vm.runInNewContext(fs.readFileSync('demo/household-samples.js','utf8'),context);
vm.runInNewContext(fs.readFileSync('demo/release-samples.js','utf8'),context);
vm.runInNewContext(fs.readFileSync('demo/demo.js','utf8'),context);
(async()=>{
 for(const method of ['POST','PUT','DELETE','PATCH'])assert.equal((await window.fetch('/v1/maintenance',{method})).status,403);
 assert.equal((await window.fetch('https://example.com/')).status,403);
 assert.equal((await window.fetch('/unknown')).status,404);
 assert.equal((await window.fetch('/v1/maintenance')).status,200);
 const vehicles=await(await window.fetch('/v1/argo')).json();assert.equal(vehicles.assets.length,3);assert(vehicles.demo);
 assert.equal(vehicles.assets[0].manufacturer,'Tesla');assert.equal(vehicles.assets[0].model,'Model Y');
 const appointments=await(await window.fetch('/v1/calendar')).json();assert.equal(appointments.events.length,2);assert(appointments.demo);
 const vehicleEnergy=(await(await window.fetch('/v1/energy/status')).json()).vehicle_charge_snapshot;
 assert.equal(vehicleEnergy.records.length,2);assert.equal(vehicleEnergy.commands_enabled,false);
 for(const period of ['day','month','year']){
  const result=await(await window.fetch(`/v1/energy/calendar?period=${period}&date=2030-06-10`)).json();
  assert(result.buckets.length>0);assert.equal(result.source,'Tesla historical energy sample');assert(result.recorded);
  assert.equal(result.date,window.AtlasEnergySamples.dates[period].at(-1),'outside dates resolve to an honestly dated recorded sample');
  assert(Math.abs(result.totals.solar_kwh-result.totals.solar_to_home-result.totals.solar_to_battery-result.totals.solar_to_grid)<.01);
  assert(Math.abs(result.totals.home_kwh-result.totals.solar_to_home-result.totals.battery_to_home-result.totals.grid_to_home)<.01);
 }
 const samples=window.AtlasEnergySamples.samples;
 assert.equal(Object.keys(samples).length,22);
 assert.equal(samples['day:2026-09-06'].totals.solar_kwh,45.16);
 assert.equal(samples['day:2026-09-06'].totals.home_kwh,39.026);
 assert.equal(samples['day:2026-09-06'].buckets.length,287);
 for(const sample of Object.values(samples)){
  assert(sample.buckets.every(row=>Object.values(row.values).every(value=>typeof value==='number'&&Number.isFinite(value))));
  assert(Object.values(sample.totals).every(value=>typeof value==='number'&&Number.isFinite(value)));
  assert.deepEqual(Array.from(sample.context),[]);assert.deepEqual(Array.from(sample.references),[]);
 }
 for(const route of ['/v1/security/cyber','/v1/home/environment/history','/v1/home/entities','/v1/energy/forecast','/health']){
  const value=await(await window.fetch(route)).json();assert(value.demo,`${route} examples explicitly tagged`);
 }
 const cyber=await(await window.fetch('/v1/security/cyber')).json();assert.equal(cyber.summary.total,4);assert.equal(cyber.checks.length,4);
 const network=await(await window.fetch('/v1/security/network')).json();
 assert(network.demo&&network.planned);assert.equal(network.aps.length,3);assert.equal(network.gateway.model,'Cloud Gateway Fiber');
 assert.equal(network.clients.wired+network.clients.wireless,network.clients.total);
 assert.equal(network.aps.reduce((sum,ap)=>sum+ap.clients,0),network.clients.wireless);
 assert(Math.abs(network.aps.reduce((sum,ap)=>sum+ap.poe_w,0)-network.switch.poe_used_w)<.01);
 assert(network.switch.poe_budget_w>=75);assert.equal(network.ports.length,8);
 const ids=await(await window.fetch('/v1/security/vacation-ids')).json();assert.equal(ids.sensors.length,18);assert.equal(ids.coverage.available,18);
 assert(ids.sensors.every(sensor=>sensor.availability==='available'));assert.equal(ids.sensors.filter(sensor=>sensor.type==='Zigbee Door Contact').length,4);
 assert.equal(ids.sensors.filter(sensor=>sensor.type==='Zigbee Window Contact').length,8);assert.equal(ids.sensors.filter(sensor=>sensor.type==='Echo Ultrasonic Motion').length,6);
 const inventory=await(await window.fetch('/v1/home/entities')).json();const entities=Object.values(inventory.groups).flat();
 assert.equal(entities.length,122);assert.equal(inventory.summary.total,entities.length);assert.equal(new Set(entities.map(e=>e.entity_id)).size,entities.length);
 const pantry=await(await window.fetch('/v1/galleyquest/status')).json();assert.equal(pantry.staples.length,7);assert.equal(pantry.planned_meals.length,4);
 assert.equal(pantry.cart_items,pantry.cart_items_preview.length);assert.equal(pantry.missing_ingredients,pantry.missing_items.length);
 assert.equal(new Date(pantry.week_start+'T12:00:00Z').getUTCDay(),1);assert(pantry.week_start>new Date().toISOString().slice(0,10));
 assert(pantry.planned_meals.every(meal=>pantry.recipes.some(recipe=>recipe.name===meal.name)));
 const travel=await(await window.fetch('/v1/travel')).json();assert.equal(travel.trips.length,2);assert.equal(travel.loyalty.length,3);
 assert.deepEqual(travel.trips.map(trip=>trip.trip_type),['personal','business']);
 for(const trip of travel.trips){
  assert.equal(trip.reservations.length,3);assert(trip.financials.card_label.includes('United'));
  assert.equal(trip.charges.filter(c=>c.status==='paid').reduce((s,c)=>s+c.amount,0),trip.costs.paid.USD);
  assert.equal(trip.charges.filter(c=>c.status==='due_later').reduce((s,c)=>s+c.amount,0),trip.costs.later.USD);
  assert(trip.reservations.flatMap(r=>r.segments||[]).every(segment=>segment.flight_number.startsWith('UA ')));
 }
 const maintenance=await(await window.fetch('/v1/maintenance')).json();assert(maintenance.records.some(r=>r.task==='Annual solar panel cleaning'));
 const history=await(await window.fetch('/v1/home/environment/history')).json();assert(history.series.length>=5);assert(history.series.every(row=>row.points.length===97));
 const energy=await(await window.fetch('/v1/energy/status')).json();assert.equal(energy.recorded_date,'2026-09-06');assert(Object.values(energy.monthly).every(value=>value!==null));
 const html=fs.readFileSync('dist/index.html','utf8');assert(html.includes("connect-src 'none'"));assert(!html.includes('src="/assets/'));
 assert(html.includes('assets/atlas-house-hilltop.png'));assert(html.includes('Simulated Dallas Radar'));
 assert(html.includes('Not Live Weather'));assert(!html.includes('<h3>Live Radar</h3>'));
 for(const name of ['travel','pantry','maintenance','systems']){
  assert(html.includes('assets/heroes/'+name+'.png'),name+' page artwork');
  assert(fs.existsSync('dist/assets/heroes/'+name+'.png'),name+' bundled artwork');
 }
 assert.equal((html.match(/class="module-art"/g)||[]).length,4);
 assert(html.includes('assets/heroes/atlas-home-desktop.png'),'Home artwork preserved');
 assert(!html.includes('Copperas Cove'),'No private default weather location');
 for(const asset of ['model-y.png','pickup.png','motorcycle.png','dallas-radar-demo.png'])assert(fs.existsSync('dist/assets/'+asset),asset);
 const vehicleScript=fs.readFileSync('dist/argo/assets/js/vehicle.js','utf8');
 assert(!vehicleScript.includes('visual.innerHTML'));assert(vehicleScript.includes("image.src='../assets/'"));
 assert(html.indexOf('src="demo.js"')<html.indexOf('src="assets/atlas.js'));
 assert(html.indexOf('src="energy-samples.js"')<html.indexOf('src="demo.js"'));assert(fs.existsSync('dist/energy-samples.js'));
 for(const [,asset] of html.matchAll(/(?:src|href)="((?:assets\/|demo\.)[^"?]+)(?:\?[^\"]*)?"/g))assert(fs.existsSync('dist/'+asset),asset);
 const css=fs.readFileSync('dist/assets/atlas.css','utf8');
 for(const [,asset] of css.matchAll(/url\(['"]?(\.\/[^)'"?]+)['"]?\)/g))assert(fs.existsSync('dist/assets/'+asset),asset);
 console.log('Demo: 22 recorded energy periods, labeled illustrative metrics, no external fetch, all mutations rejected, relative assets, and restrictive CSP passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
