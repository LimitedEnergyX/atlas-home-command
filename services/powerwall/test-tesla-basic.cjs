const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createBasicReader, INTERVAL} = require('./tesla-basic');
const VIN = '5YJ00000000000001';
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-basic-test-'));
  let time = Date.parse('2026-09-24T16:00:00Z'), mode = 'online', code = null, extra = {};
  const calls=[];
  const file=path.join(dir,'athena-basic-state.json');
  const write=s=>fs.writeFileSync(file, JSON.stringify(s));
  fs.writeFileSync(path.join(dir,'athena-basic-config.json'),JSON.stringify({enabled:true,vin:VIN,billing_limit_usd:0,billing_verified_at:new Date(time).toISOString()}));
  write({version:1,months:{},next_at:0});
  const get=async (url,opts)=>{
    calls.push({url,opts});
    if(url.endsWith('/vehicle_data')) {
      assert.equal(opts.params.endpoints,'charge_state');
      if(code) throw {response:{status:code,data:{private:'secret'}}};
      return {data:{response:{charge_state:{battery_level:80,charge_limit_soc:80,charger_power:0,charging_state:'Stopped',timestamp:time,location:'private',token:'secret',...extra}}}};
    }
    return {data:{response:[{vin:VIN,state:mode}]}};
  };
  const make=()=>createBasicReader({dataDir:dir,get,getToken:async()=>'private-token',now:()=>time});
  return {dir,file,calls,write,make,advance:()=>time+=INTERVAL,setMode:m=>mode=m,setCode:c=>code=c,setTime:t=>time=Date.parse(t),setExtra:e=>extra=e};
}
(async()=>{
  let f=fixture(), reader=f.make();
  await Promise.all([reader.tick(),reader.tick(),reader.tick()]);
  assert.equal(f.calls.length,2); assert.equal(reader.snapshot().charge_state.battery_level,80);
  assert.ok(!JSON.stringify(reader.snapshot()).includes('private'));
  reader=f.make();await reader.tick();assert.equal(f.calls.length,2,'restart preserves interval');
  for(let i=0;i<10;i++)reader.snapshot();assert.equal(f.calls.length,2,'screen reads are cache-only');
  f.advance();f.setMode('asleep');await reader.tick();assert.equal(f.calls.length,3);
  assert.equal(reader.snapshot().collection_status,'Asleep');assert.equal(reader.snapshot().charge_state.battery_level,80);
  assert.equal(reader.snapshot().monthly_reservations,2);
  f.advance();f.setMode('online');f.setCode(429);await reader.tick();assert.equal(f.calls.length,5);
  f.advance();await f.make().tick();assert.equal(f.calls.length,5,'429 pauses across restart');
  assert.equal(reader.snapshot().automatic_collection,false);
  for(const code of [401,402,403,412]) {const x=fixture();x.setCode(code);await x.make().tick();x.advance();await x.make().tick();assert.equal(x.calls.length,2);}
  f=fixture();f.write({version:1,months:{'2026-09':1500},next_at:0});reader=f.make();await reader.tick();assert.equal(f.calls.length,0);
  f.setTime('2026-10-01T00:01:00Z');await reader.tick();assert.equal(f.calls.length,2);assert.equal(reader.snapshot().monthly_reservations,1);
  for(const broken of ['not-json',JSON.stringify({version:1,months:{'2026-09':-1},next_at:0})]) {
    f=fixture();fs.writeFileSync(f.file,broken);reader=f.make();await reader.tick();assert.equal(f.calls.length,0);assert.equal(reader.snapshot().automatic_collection,false);
  }
  f=fixture();fs.unlinkSync(f.file);await f.make().tick();assert.equal(f.calls.length,0);
  f=fixture();fs.writeFileSync(path.join(f.dir,'athena-basic.lock'),'');await f.make().tick();assert.equal(f.calls.length,0);
  f=fixture();f.setCode(500);reader=f.make();await reader.tick();await reader.tick();assert.equal(f.calls.length,2);assert.equal(reader.snapshot().monthly_reservations,1);
  assert.ok(f.calls.every(c=>!c.url.includes('command')&&!c.url.includes('wake')));
  f=fixture();reader=f.make();f.setExtra({charge_energy_added:3,charge_miles_added_rated:9});await reader.tick();
  f.advance();f.setExtra({charge_energy_added:4,charge_miles_added_rated:12});await reader.tick();
  assert.deepEqual(reader.snapshot().observations.map(r=>r.charge_energy_added),[3,4],'retain counters, never sum them');
  assert.equal(reader.snapshot().observations[1].charge_miles_added_rated,12);
  assert.equal(f.make().snapshot().observations.length,2,'history survives restart');
  f.advance();f.setMode('asleep');await reader.tick();
  assert.equal(reader.snapshot().observations.length,2,'no fake samples while asleep');
  assert.equal(f.calls.length,5,'storage adds no API requests');
  assert.ok(!JSON.stringify(reader.snapshot().observations).includes('private'));
  f.advance();f.setMode('online');f.setExtra({timestamp:Date.parse('2026-09-24T16:30:00Z'),charge_energy_added:4});await reader.tick();
  assert.equal(reader.snapshot().observations.length,2,'repeated Tesla timestamp is deduplicated');
  f.advance();f.setExtra({charge_energy_added:0});await reader.tick();
  assert.equal(reader.snapshot().observations.at(-1).charge_energy_added,0,'counter reset preserved');
  console.log('PASS: concurrency, restart, cache-only screens, asleep/no-wake, stale retention, access/billing pause, cap, month rollover, corrupt/missing ledger, orphan lock, failures count, field minimization.');
})().catch(e=>{console.error(e);process.exitCode=1;});
