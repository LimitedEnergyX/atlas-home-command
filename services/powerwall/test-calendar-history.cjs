const assert = require('node:assert/strict');
const {createCalendarReader} = require('./calendar-history');
(async () => {
  let calls=0, clock=Date.parse('2026-09-06T20:00:00Z');
  const reader=createCalendarReader({now:()=>clock,getToken:async()=> 'test-only-token',base:'https://example.invalid/site',get:async(url,options)=>{
    calls++; assert.ok(url.endsWith('/calendar_history')); assert.equal(options.params.kind,'energy');
    return {data:{response:{time_series:[{timestamp:'2026-09-05T00:00:00-05:00',solar_energy_exported:23,secret:'excluded',nan:NaN}]}}};
  }});
  const query={kind:'energy',period:'day',start_date:'2026-09-05T00:00:00-05:00',end_date:'2026-09-05T23:59:59-05:00'};
  const results=await Promise.all([reader(query),reader(query)]);
  assert.equal(calls,1); assert.equal(results[0].time_series[0].solar_energy_exported,23);
  assert.equal(results[0].time_series[0].secret,undefined); assert.equal(results[0].time_series[0].nan,undefined);
  await reader(query); assert.equal(calls,1);
  clock+=300001; await reader(query); assert.equal(calls,2);
  for (const patch of [{kind:'commands'},{period:'lifetime'},{time_zone:'UTC'},{start_date:'invalid'},{end_date:'2028-01-01T00:00:00Z'}]) await assert.rejects(reader({...query,...patch}));
  console.log('Tesla history: read-only request, validation, coalescing, cache, and output filtering passed.');
})().catch(error=>{ console.error(error);process.exitCode=1; });
