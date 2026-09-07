/* Owner-approved pantry titles; all plans, purchases, travel, network, and sensors are fictional. */
"use strict";
(() => {
  let fixtures;
  const recipes = [
    {name:"Arroz con Pollo",ingredients:["Chicken broth","Cumin","Diced tomatoes","Chicken thighs","Garlic","Oil","Long-grain rice","Onion"]},
    {name:"Beef and Broccoli Stir-Fry",ingredients:["Cornstarch","Black pepper","Dry sherry","Sirloin steak","Oyster sauce","Chicken stock","Cooking oil","Broccoli","Soy sauce","Garlic"]},
    {name:"American Beef Chili",ingredients:["Chili powder","Cumin","Ground beef","Garlic","Kidney beans","Crushed tomatoes","Onion"]},
    {name:"Baked Salmon with Fennel & Tomatoes",ingredients:["Parsley","Olive oil","Lemon","Black olives","Cherry tomatoes","Salmon","Fennel"]}
  ];
  function populate(data,{date,observed}) {
    const nextMonday = new Date();
    nextMonday.setUTCDate(nextMonday.getUTCDate()+((8-nextMonday.getUTCDay())%7||7));
    const mealDate = offset => new Date(nextMonday.getTime()+offset*86400000).toISOString().slice(0,10);
    const pending = ["Chicken thighs","Sirloin steak","Broccoli","Ground beef","Kidney beans","Salmon","Fennel","Cherry tomatoes","Bread"];
    data["/v1/galleyquest/status"] = {
      status:"healthy",demo:true,observed_at:observed,week_start:mealDate(0),week_label:"Next Week",
      missing_ingredients:8,missing_items:pending.slice(0,8),cart_items:pending.length,cart_items_preview:pending,
      cart_status_label:"9 Pending Purchase · Nothing Ordered",cart_status_counts:{pending:9,purchased:0},
      meals_planned:4,planned_meals:recipes.map((recipe,i)=>({name:recipe.name,day:mealDate([0,2,4,6][i]),slot:"Dinner"})),
      recipes,stock_items:36,stock_ok:27,
      staples:["Milk","Eggs","Butter","Bread","Coffee","Cereal","Yogurt"].map((name,i)=>({id:name.toLowerCase(),name,tracked:true,status:i===3?"OUT":i===4?"LOW":"OK"}))
    };
    const contacts = ["Front Door","Patio Door","Garage Entry","Side Door","Living Window East","Living Window West","Kitchen Window","Office Window","Bedroom Window East","Bedroom Window West","Guest Window","Dining Window"];
    const motions = ["Living Room","Office","Bedroom","Guest Room","Kitchen","Hall"];
    const idsSensors = [
      ...contacts.map((name,i)=>({name,type:i<4?"Zigbee Door Contact":"Zigbee Window Contact",availability:"available",state:i===6?"on":"off",updated_at:observed,battery_pct:94-i})),
      ...motions.map(name=>({name:`${name} Echo`,type:"Echo Ultrasonic Motion",availability:"available",state:"off",updated_at:observed}))
    ];
    data["/v1/security/vacation-ids"]={status:"healthy",demo:true,armed:false,coverage:{available:idsSensors.length,total:idsSensors.length},sensors:idsSensors,detail:"18 example sensors: 4 Zigbee doors, 8 Zigbee windows, and 6 Echo ultrasonic motion sensors. Kitchen window open. Disarmed; no alerts are sent."};
    const aps = ["Living Wing","Office Wing","Bedroom Wing"].map((name,i)=>({name:`${name} AP`,model:"U7 Pro Max",state:"Online",uplink:"2.5 GbE",clients:[26,21,17][i],cpu_pct:[12,9,11][i],memory_pct:[43,41,42][i],poe_w:[16.2,14.8,15.6][i],uptime:"12d 6h"}));
    const network = {
      status:"illustrative",demo:true,planned:true,observed_at:observed,source:"UniFi-shaped simulation, not connected",
      gateway:{name:"Home Gateway",model:"Cloud Gateway Fiber",storage:"1 TB",cpu_pct:18,memory_pct:46,uptime:"12d 6h"},
      switch:{name:"Core Switch",model:"Flex 2.5G PoE",uplink:"10G SFP+",poe_budget_w:196,poe_used_w:46.6,power:"210 W AC adapter assumed"},
      aps,clients:{total:74,wired:10,wireless:64,main:18,iot:50,guest:6},
      wan:{download_mbps:112.4,upload_mbps:9.7,latency_ms:9.4,packet_loss_pct:0,uptime_pct:99.98},
      ports:aps.map((ap,i)=>({port:i+1,device:ap.name,link:"2.5 GbE",poe_w:ap.poe_w})).concat([
        {port:4,device:"Storage Server",link:"2.5 GbE",poe_w:0},{port:5,device:"Home Automation Bridge",link:"1 GbE",poe_w:0},
        {port:6,device:"Office Workstation",link:"2.5 GbE",poe_w:0},{port:7,device:"Media Server",link:"1 GbE",poe_w:0},{port:8,device:"Spare",link:"Disconnected",poe_w:0}
      ]),
      events:[{title:"Outbound connection blocked",detail:"Example IoT client · 12 repeated log entries grouped into one review item",status:"Review"},
        {title:"New guest client",detail:"Example phone joined Guest Wi-Fi · Guest segment only",status:"Informational"},
        {title:"AP uplink recovered",detail:"Office Wing · brief example interruption cleared",status:"Resolved"}],
      collection:"Plan: local Network API for devices, ports, clients, CPU, memory, uptime, and rates; Site Manager for WAN health; CEF logs for security events. Exact fields depend on installed versions.",
      power_note:"Design assumption: 210 W AC adapter supplies a 196 W switch PoE budget. Three APs have a combined 75 W rated maximum. Confirm the adapter before purchase."
    };
    data["/v1/security/network"]=network;
    data["/v1/security/cyber"].network_summary="5 / 5 Example Devices";
    const groups={climate:[],energy:[],home_controls:[],openings:[],safety:[],security:[],systems:[],network:[],backup:[]};
    const add=(group,name,state,unit="")=>groups[group].push({entity_id:`sensor.demo_${group}_${groups[group].length+1}`,name,state:String(state),unit,availability:"available",demo:true});
    ["Living Room","Office","Bedroom","Guest Room","Kitchen","Dining Room","Hall","Sunroom"].forEach((room,i)=>{
      add("climate",`${room} Temperature`,(72+i*.3).toFixed(1),"°F");
      add("climate",`${room} Humidity`,43+i,"%");add("climate",`${room} CO₂`,520+i*33,"ppm");
    });
    [["Outdoor Temperature",81.2,"°F"],["Attic Temperature",103.4,"°F"],["Garage Temperature",84.6,"°F"],["Equipment Closet Temperature",78.2,"°F"]].forEach(row=>add("climate",...row));
    ["Media Center","Office Desk","Refrigerator","Freezer","Washer","Dryer","Dishwasher","Network Rack","Garage Outlet","Air Handler"].forEach((device,i)=>{
      add("energy",`${device} Power`,[92,144,83,62,3,2,1,119,0,860][i],"W");add("energy",`${device} Today`,(.25+i*.17).toFixed(2),"kWh");
    });
    ["Driveway","Front Porch","Patio","Hall","Desk","Reading Lamp"].forEach((name,i)=>add("home_controls",name,i===4?"On":"Off"));
    idsSensors.forEach(sensor=>{
      const contact=sensor.type.includes("Contact");add(contact?"openings":"security",`${sensor.name} · ${sensor.type}`,contact?(sensor.state==="on"?"Open":"Closed"):"Clear");
      if(contact)add("openings",`${sensor.name} Battery`,sensor.battery_pct,"%");
    });
    ["Kitchen Sink","Laundry","Water Heater","Air Handler Drain","Guest Bath","Main Bath"].forEach((name,i)=>{add("safety",`${name} Leak Sensor`,"Dry");add("safety",`${name} Sensor Battery`,95-i*3,"%");});
    [["Washer Cycle","Idle"],["Dryer Cycle","Complete"],["Dishwasher Cycle","Ready"],["Refrigerator Door","Closed"],["Freezer Door","Closed"],["Zigbee Coordinator","Online"],["Automation Queue","0 pending"],["Storage Used","42%"],["Storage Temperature","38°C"],["UPS Charge","100%"],["UPS Runtime","42 min"],["CPU Load","8%"]].forEach(row=>add("systems",...row));
    add("network","Gateway CPU",18,"%");add("network","Gateway Memory",46,"%");add("network","WAN Latency",9.4,"ms");add("network","Connected Clients",74);
    aps.forEach(ap=>{add("network",`${ap.name} Clients`,ap.clients);add("network",`${ap.name} PoE`,ap.poe_w,"W");});
    [["Last Backup","Today 04:45"],["Backup Size","2.8 GB"],["Sample Restore","Passed (illustrative)"],["Next Backup","Tomorrow 04:45"]].forEach(row=>add("backup",...row));
    const count=Object.values(groups).reduce((n,list)=>n+list.length,0);
    data["/v1/home/entities"]={status:"healthy",demo:true,observed_at:observed,summary:{available:count,total:count,filtered:0},
      backup:{status:"healthy",detail:"Example backup completed; illustrative sample restore passed. No real restore was performed."},
      group_labels:{climate:"Climate & Air",energy:"Energy & Batteries",home_controls:"Lights & Home Controls",openings:"Doors & Windows",safety:"Leaks & Safety",security:"Motion & Security",systems:"Appliances & Systems",network:"Home Network",backup:"Backup Health"},groups};
    const card="United Explorer · DEMO";
    function trip(id,title,destination,airport,type,offset,days,airfare,hotel,car) {
      const start=date(offset),end=date(offset+days);
      const segment=(from,to,departure,label,number)=>({from,to,departure,departure_label:label,flight_number:`UA ${number} · Demo`,cabin:"Economy",fare:"Illustrative refundable fare",lounges:[{name:"United Club · Example Access Review",network:"United Club",terminal:"Illustrative terminal; confirm before travel",hours:"Illustrative 06:00–21:00",access:"verify",notes:"Example only. No lounge location, hours, or admission has been verified."}]});
      const segments=airport==="SJC"?[
        segment("DFW","DEN",start+"T08:00:00-05:00",start+" 8:00 AM CDT","9001"),
        segment("DEN","SJC",start+"T10:30:00-06:00",start+" 10:30 AM MDT","9002"),
        segment("SJC","DEN",end+"T11:00:00-07:00",end+" 11:00 AM PDT","9003"),
        segment("DEN","DFW",end+"T16:00:00-06:00",end+" 4:00 PM MDT","9004")
      ]:[segment("DFW","IAD",start+"T09:00:00-05:00",start+" 9:00 AM CDT","9011"),segment("IAD","DFW",end+"T17:00:00-04:00",end+" 5:00 PM EDT","9012")];
      return {id,title,destination,trip_type:type,start_date:start,end_date:end,travelers:type==="personal"?["Alex","Sam"]:["Alex"],demo:true,
        readiness:{all_verified:true,verified:3,required:3},departure:{good_to_go:false,checks:[]},
        financials:{preferred_card_used:true,card_label:card},operator_review:{current:false},
        reservations:[{type:"Flight",provider:"United Airlines",status:"ticketed",confirmation:"DEMO-AIR",segments,notes:"Fictional flight numbers, schedules, fares, and reservations.",verified_at:observed},
          {type:"Hotel",provider:`IHG · ${airport==="SJC"?"Holiday Inn · San Jose Example":"Crowne Plaza · Dulles Example"}`,status:"reserved",confirmation:"DEMO-HOTEL",notes:`${days} nights. Fictional property and booking; pay at hotel.`,verified_at:observed},
          {type:"Car",provider:"Hertz · Midsize SUV",status:"reserved",confirmation:"DEMO-CAR",notes:"Fictional airport pickup and return; pay at counter.",verified_at:observed}],
        charges:[{merchant:"United Airlines",category:"Airfare",status:"paid",amount:airfare,amount_known:true,currency:"USD",card,timing:"Example posted charge"},
          {merchant:"IHG Hotels & Resorts",category:"Hotel",status:"due_later",amount:hotel,amount_known:true,currency:"USD",card,timing:"Example pay at checkout"},
          {merchant:"Hertz",category:"Rental Car",status:"due_later",amount:car,amount_known:true,currency:"USD",card,timing:"Example pay on return"}],
        costs:{paid:{USD:airfare},later:{USD:hotel+car},unknown_paid:0,unknown_later:0,unknown_miles:0,miles:{}},
        coverage:[{name:"Example Travel Coverage Review",status:"review_required",effective_from:start,effective_to:end,notes:"Demonstration only. No insurance policy or card coverage is established."}],
        business_expenses:{submission_status:"no",reimbursed_amount:0,remaining_amount:type==="business"?airfare:0,currency:"USD",notes:"Illustrative pre-trip ledger. Airfare paid; hotel and rental remain estimates. No report has been submitted."},
        notes:"Fictional trip. Dates, flight numbers, hotels, prices, confirmations, and account details are examples. Do not use as travel instructions."};
    }
    const trips=[trip("demo-san-jose","San Jose Getaway","San Jose, CA · DFW → SJC via DEN","SJC","personal",25,4,684,756,268),trip("demo-dulles","Dulles Work Visit","Washington, DC · DFW → IAD","IAD","business",42,3,428,624,216)];
    data["/v1/travel"]={status:"healthy",demo:true,observed_at:observed,updated_at:observed,ledger_updated_at:observed,revision:1,trips,past_trips:[],
      summary:{upcoming:2,ready:2,charged:1112,later:1864,unknown_charges:0},
      loyalty_summary:{programs:3,lounge_passes_remaining:2,status_examples:3,statuses_verified:0,programs_with_progress:3},
      loyalty:[
        {program:"United MileagePlus",provider:"United Airlines",member_id_masked:"DEMO MEMBER",status:"Premier Silver · Example",balance_label:"48,250 Illustrative Miles",qualification:[{label:"Example PQP Goal",current:7200,target:10000,detail:"Illustrative personal goal, not official qualification criteria"}],benefits:["United Explorer card · Example wallet","2 example United Club one-time passes; admission is conditional"],notes:"Fictional account and balances. No benefits granted.",verified_at:observed},
        {program:"IHG One Rewards",provider:"IHG Hotels & Resorts",member_id_masked:"DEMO MEMBER",status:"Platinum Elite · Example",balance_label:"86,400 Illustrative Points",qualification:[{label:"Example Annual Night Goal",current:28,target:40,detail:"Illustrative personal goal"}],benefits:["Example reward-night planning"],notes:"Fictional account and balances.",verified_at:observed},
        {program:"Hertz Gold Plus Rewards",provider:"Hertz",member_id_masked:"DEMO MEMBER",status:"Five Star · Example",balance_label:"2,850 Illustrative Points",qualification:[{label:"Example Rental Goal",current:7,target:12,detail:"Illustrative personal goal"}],benefits:["Example airport pickup preferences"],notes:"Fictional account and balances.",verified_at:observed}
      ],sources:["United Airlines","IHG Hotels & Resorts","Hertz"].map(provider=>({provider,bookings_found:2,detail:"Fictional itinerary fixtures; no account session or provider verification",verified_at:observed})),
      attention:[{title:"Pre-departure review",detail:"Example: confirm documents, transport, and lounge access before departure.",owner:"Alex",trip_id:trips[0].id}],
      cases:[],monitor:[{schedule:"Disabled in demo",timezone:"Example local time",configuration_status:"demo_only",detail:"No scheduled account checks or external connections."}],audit:[]};
    data["/v1/maintenance"].records.push({id:"example-solar-clean",equipment:"Solar Array",task:"Annual solar panel cleaning",due_date:date(45),state:"scheduled",completed_at:null,notes:"Illustrative annual service. Coordinate with a qualified provider and follow panel manufacturer guidance; no roof work scheduled."});
    data["/v1/maintenance"].summary.scheduled++;
    fixtures=data;
  }
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
  function render() {
    if(!fixtures)return;
    const net=fixtures["/v1/security/network"];
    const security=document.getElementById("panel-security");
    if(security){
      const section=node("section",undefined,"demo-network status-section");section.id="demo-network";
      section.append(node("h2","Home Network · UniFi"),node("p","PLANNED HARDWARE · SIMULATED TELEMETRY · NO UNIFI CONNECTION","demo-section-note"));
      const metrics=node("div",undefined,"demo-metrics");
      [["Devices","5 / 5"],["Clients","74"],["WAN Down / Up","112.4 / 9.7 Mbps"],["Latency","9.4 ms"],["Packet Loss","0.0%"],["PoE Load","46.6 / 196 W"]].forEach(([label,value])=>{const c=node("article");c.append(node("span",label),node("strong",value));metrics.append(c);});
      section.append(metrics);
      const topology=node("p","Internet → Cloud Gateway Fiber (1 TB) → 10G SFP+ → Flex 2.5G PoE → 3 × U7 Pro Max (2.5 GbE)","demo-topology");section.append(topology);
      const cards=node("div",undefined,"demo-device-grid");
      [[net.gateway.name,net.gateway.model,"CPU 18% · Memory 46% · Uptime 12d 6h"],[net.switch.name,net.switch.model,"8 × 2.5 GbE PoE · 10G uplink · 46.6 W PoE"],...net.aps.map(ap=>[ap.name,ap.model,`${ap.clients} clients · ${ap.poe_w} W · CPU ${ap.cpu_pct}% · Memory ${ap.memory_pct}%`])].forEach(([name,model,detail])=>{const card=node("article");card.append(node("h3",name),node("p",model),node("strong","Online · Example"),node("small",detail));cards.append(card);});
      section.append(cards,node("p","Main: 18 clients · IoT: 50 clients · Guest: 6 clients. Example segment isolation, not a tested firewall policy."));
      const details=node("details");details.append(node("summary","Switch Ports & Collection Plan"));
      const ports=node("div",undefined,"demo-port-list");net.ports.forEach(port=>ports.append(node("p",`Port ${port.port} · ${port.device} · ${port.link} · ${port.poe_w} W`)));
      details.append(ports,node("p",net.collection),node("p",net.power_note));section.append(details,node("h3","Network Event Review"));
      const events=node("div",undefined,"demo-device-grid");net.events.forEach(event=>{const card=node("article");card.append(node("h3",event.title),node("strong",event.status),node("p",event.detail));events.append(card);});section.append(events);
      security.insertBefore(section,security.querySelector(".cyber-section"));
    }
    const pantry=document.getElementById("panel-pantry");
    if(pantry){
      const section=node("section",undefined,"pantry-board demo-recipes");section.append(node("h2","Recipes From Your Library"),node("p","Recipe names and ingredient lists are owner-approved references. Next week's plan, stock, and shopping status are illustrative."));
      const list=node("div",undefined,"demo-device-grid");recipes.forEach(recipe=>{const d=node("details");d.append(node("summary",recipe.name),node("p",recipe.ingredients.join(" · ")));list.append(d);});section.append(list);pantry.append(section);
    }
  }
  window.AtlasHouseholdDemo={populate};
  document.addEventListener("DOMContentLoaded",render);
})();
