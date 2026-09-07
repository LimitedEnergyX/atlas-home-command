/* Disconnected demo: approved recorded energy, illustrative household data. */
"use strict";
(() => {
  const observed = new Date().toISOString();
  const date = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0,10);
  const reading = (id,label,value,unit) => ({id,label,value,unit,available:true,status:"healthy",updated_at:observed});
  const sources = [reading("office-temperature","Office",72.4,"°F"),reading("living-room-temperature","Living Room",73.1,"°F"),reading("primary-bedroom-temperature","Bedroom",72.8,"°F"),reading("outdoor-temperature","Outdoor",79,"°F"),reading("air-quality","Air Quality",28,"AQI"),reading("indoor-humidity","Humidity",45,"%")];
  const services = ["Energy","Climate","Pantry","Travel"].map(name=>({id:name.toLowerCase(),name,status:"healthy",required:true,http_status:200,latency_ms:4}));
  const data = {
    "/v1/atlas/status":{status:"healthy",host:"atlas-demo",observed_at:observed,services,containers:[],failures:[],summary:{services_healthy:4,services_total:4},health_controls:{status:"current",items:[]}},
    "/health":{status:"healthy",providers:{}},
    "/v1/energy/status":{status:"healthy",solar_kw:4.8,home_kw:2.1,battery_pct:78,reserve_pct:20,battery_kw:-1.2,grid_kw:-1.5,grid_up:true,grid_direction:"exporting",charging:true,polled_at:observed,today:{solar_kwh:28.6,home_kwh:22.4,import_kwh:4.2,export_kwh:8.1},monthly:{},rates:{}},
    "/v1/energy/forecast":{status:"healthy",location:"Example Region",observed_at:observed,current:{temp_f:79,feels_like_f:80,humidity:45,wind_mph:6,wind_gust_mph:9,wind_dir:"SE",visibility_mi:10,precip_in:0,code:1,desc:"Mostly clear",icon:"☀"},hourly:[],daily:[]},
    "/v1/home/status":{status:"healthy",observed_at:observed,climate:{state:"cool",current_temperature:72.4,target_temperature:73,hvac_action:"cooling",unit:"°F",available:true,min_temp:60,max_temp:85},environment:sources},
    "/v1/home/environment/history":{status:"unavailable",series:[],note:"No recorded history in this illustration"},
    "/v1/security/cyber":{status:"illustration",fresh:false,checks:[],channels:[],findings:[],coverage_gaps:["Demo is not a security scan"],summary:{}},
    "/v1/household":{status:"healthy",current_profile:"alex",profiles:[{id:"alex",name:"Alex",role:"Example Operator"},{id:"sam",name:"Sam",role:"Example Operator"}],messages:[],unread:0},
    "/v1/maintenance":{status:"healthy",as_of:date(0),summary:{overdue:1,due_soon:1,scheduled:1,completed:1},records:[
      {id:"example-filter",equipment:"Air Handler",task:"Check filter",due_date:date(-3),notes:"Fictional example. Follow the installed equipment manual.",state:"overdue",completed_at:null},
      {id:"example-alarm",equipment:"Smoke Alarms",task:"Scheduled inspection",due_date:date(14),notes:"Illustrative schedule only.",state:"due_soon",completed_at:null},
      {id:"example-gutter",equipment:"Roof Drainage",task:"Seasonal inspection",due_date:date(60),notes:"Fictional example, not a safety recommendation.",state:"scheduled",completed_at:null},
      {id:"example-service",equipment:"Cooling System",task:"Service visit",due_date:date(-10),notes:"Example completed record.",state:"completed",completed_at:date(-10)+"T12:00:00Z"}
    ]}
  };
  const energySamples = window.AtlasEnergySamples;
  function sampleDate(period, requested) {
    const normalized = period === "year" ? `${requested.slice(0,4)}-01-01` : period === "month" ? `${requested.slice(0,7)}-01` : requested;
    const choices = energySamples.dates[period];
    return choices.includes(normalized) ? normalized : choices.reduce((best, key) => Math.abs(Date.parse(key)-Date.parse(normalized)) < Math.abs(Date.parse(best)-Date.parse(normalized)) ? key : best, choices.at(-1));
  }
  function calendar(params) {
    const period=["day","month","year"].includes(params.get("period"))?params.get("period"):"day";
    const requested=/^\d{4}-\d{2}-\d{2}$/.test(params.get("date")||"")?params.get("date"):energySamples.default_date;
    const selected=sampleDate(period,requested);
    return {...energySamples.samples[`${period}:${selected}`], date:selected, sample_dates:energySamples.dates[period], sample_note:requested.slice(0,period==="year"?4:period==="month"?7:10)!==selected.slice(0,period==="year"?4:period==="month"?7:10)?"Nearest recorded sample selected":""};
  }

  // Populate examples through the same schemas as the real UI, not text replacement.
  const environment = {
    temperatures:sources.slice(0,3), outdoor:[sources[3]],
    humidity:[reading("indoor-humidity","Living Room",45,"%"),reading("bedroom-humidity","Bedroom",43,"%")],
    air_quality:[reading("indoor-aqi","Air Quality",28,"AQI"),reading("indoor-co2","Carbon Dioxide",615,"ppm")],
    utility:[reading("equipment-temperature","Equipment Closet",77,"°F")]
  };
  data["/v1/home/status"].environment=environment;
  data["/v1/home/environment/history"]={status:"healthy",demo:true,observed_at:observed,series:Object.entries(environment).flatMap(([metric,items])=>items.filter(item=>metric==="temperatures"||metric==="humidity"||item.id==="outdoor-temperature").map((item,index)=>({id:item.id,label:item.label,unit:item.unit,metric,points:Array.from({length:97},(_,i)=>({at:new Date(Date.now()-(96-i)*900000).toISOString(),value:Number((item.value+Math.sin(i*.14+index)*(metric==="humidity"?3:item.id==="outdoor-temperature"?8:1.1)+Math.sin(i*.71)*.2).toFixed(1))}))})))};
  const forecast=data["/v1/energy/forecast"];
  forecast.hourly=Array.from({length:24},(_,i)=>({time:new Date(Date.now()+i*3600000).toISOString(),temp_f:Math.round(78+8*Math.sin(i*.22)),feels_like_f:Math.round(79+8*Math.sin(i*.22)),humidity:45,wind_mph:6+i%5,wind_gust_mph:12+i%4,precip_prob:i>15?20:5,precip_in:0,uv_index:Math.max(0,Math.round(6*Math.cos(i*.25))),icon:i<8?"☀":"☾",desc:i<8?"Mostly clear":"Clear"}));
  forecast.daily=Array.from({length:7},(_,i)=>({date:date(i),temp_max:86+i%3,temp_min:67+i%4,sunrise:date(i)+"T06:45:00-05:00",sunset:date(i)+"T19:30:00-05:00",precip_prob:i===3?35:10,uv_max:7,icon:i===3?"☁":"☀",desc:i===3?"Partly cloudy":"Mostly clear"}));
  data["/v1/security/cyber"]={status:"current",demo:true,fresh:true,observed_at:observed,checks:["Endpoint Protection","Firewall","Disk Encryption","Security Updates"].map(label=>({label,status:"pass"})),channels:["Sysmon","Defender","Windows Security"].map(name=>({name,status:"current",capped:false})),findings:[{title:"Example: new application observed",subject:"demo-workstation",severity:"review",count:2,last_seen:observed}],coverage_gaps:[],summary:{passed:4,total:4,high:0,review:1,attention:0}};
  data["/health"]={status:"healthy",demo:true,ledger:{healthy:true},providers:Object.fromEntries(["openai","anthropic","xai","ollama"].map(name=>[name,{available:true,status:"illustrative"}]))};
  data["/v1/atlas/status"].containers=["atlas-core","energy-adapter","home-bridge"].map(id=>({id,status:"running",required:true}));
  data["/v1/atlas/status"].health_controls.items=[{id:"Example backup validation",status:"healthy",detail:"Illustrative completed check"}];
  const recordedDay=energySamples.samples[`day:${energySamples.default_date}`];
  const noon=recordedDay.buckets.reduce((best,row)=>row.values.solar_kwh>best.values.solar_kwh?row:best);
  const kw=key=>noon.values[key]*3600/recordedDay.interval_seconds;
  const charge=recordedDay.charge_level.reduce((best,row)=>Math.abs(Date.parse(row.at)-Date.parse(noon.at))<Math.abs(Date.parse(best.at)-Date.parse(noon.at))?row:best);
  const month=energySamples.samples["month:2026-08-01"].totals;
  data["/v1/energy/status"]={status:"healthy",demo:true,recorded_date:energySamples.default_date,solar_kw:kw("solar_kwh"),home_kw:kw("home_kwh"),battery_pct:charge.percent,reserve_pct:20,battery_kw:kw("battery_discharge_kwh")-kw("battery_charge_kwh"),grid_kw:kw("grid_import_kwh")-kw("grid_export_kwh"),grid_up:true,grid_direction:kw("grid_export_kwh")>kw("grid_import_kwh")?"exporting":"importing",charging:kw("battery_charge_kwh")>kw("battery_discharge_kwh"),polled_at:noon.at,today:{solar_kwh:recordedDay.totals.solar_kwh,home_kwh:recordedDay.totals.home_kwh,import_kwh:recordedDay.totals.grid_import_kwh,export_kwh:recordedDay.totals.grid_export_kwh},monthly:{cycle_start:"2026-08-01",cycle_end:"2026-08-31",days_elapsed:31,cycle_days:31,import_kwh:month.grid_import_kwh,export_kwh:month.grid_export_kwh,projected_import_kwh:month.grid_import_kwh,projected_export_kwh:month.grid_export_kwh,energy_charge:month.grid_import_kwh*.15,export_credit:month.grid_export_kwh*.06,estimated_bill:Math.max(0,month.grid_import_kwh*.15-month.grid_export_kwh*.06+15),bank_balance:18.5},rates:{energy:.15,buyback:.06}};
  window.AtlasHouseholdDemo.populate(data,{date,observed});
  for(const value of Object.values(data))value.demo=true;
  const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
  // No reference to the original fetch is retained. Unknown routes and all writes fail closed.
  window.fetch=async (input,options={})=>{
    const url=new URL(typeof input==="string"?input:input.url,location.href);
    const method=String(options.method||input?.method||"GET").toUpperCase();
    if(method!=="GET")return response({error:"Read-only demo. No changes were made."},403);
    if(url.origin!==location.origin)return response({error:"External access is disabled in this demo"},403);
    if(url.pathname==="/v1/energy/calendar")return response(calendar(url.searchParams));
    return response(data[url.pathname]||{status:"unavailable",error:"No fictional dataset for this route"},data[url.pathname]?200:404);
  };
  const blocked="[data-hvac-adjust],[data-hvac-apply],#ids-arm,#ids-confirm,#agent-chat-send,[data-agent-open],#maintenance-form button,[data-maintenance-complete],#send-message,#travel-review-save,#profile-pin-panel button,[data-profile-switch]";
  document.addEventListener("click",event=>{
    if(event.target.closest(blocked)){event.preventDefault();event.stopImmediatePropagation();}
    const link=event.target.closest("a");
    if(link && !link.getAttribute("href")?.startsWith("#")){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  document.addEventListener("submit",event=>{event.preventDefault();event.stopImmediatePropagation();},true);
  document.addEventListener("DOMContentLoaded",()=>{
    const label=document.createElement("aside");label.id="demo-banner";label.setAttribute("role","note");label.textContent="DEMO · Recorded energy; other data illustrative · Controls disabled";document.body.prepend(label);
    for(const id of ["panel-security","panel-environment","panel-systems","panel-agents","panel-travel"]){const panel=document.getElementById(id);if(panel){const note=document.createElement("p");note.className="demo-section-note";note.textContent="Illustrative demo data. No live services, scans, or controls.";panel.prepend(note);}}
    const lock=()=>document.querySelectorAll(blocked).forEach(el=>{el.setAttribute("aria-disabled","true");el.title="Read-only demonstration";});
    lock();new MutationObserver(lock).observe(document.body,{childList:true,subtree:true});
    const radar=document.getElementById("weather-radar-image");if(radar)radar.closest("a").replaceWith(Object.assign(document.createElement("p"),{textContent:"Radar is disconnected in this public demo."}));
  });
  window.AtlasDemo={calendar,energy:{dates:energySamples.dates,defaultDate:energySamples.default_date,sampleDate}};
})();
