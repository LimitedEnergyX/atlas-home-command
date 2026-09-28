/* Fictional examples for the September interface release. No owner data. */
window.AtlasReleaseDemo = {
  populate(data, {date, observed}) {
    data['/v1/energy/status'].vehicle_charge_snapshot = {
      status:'periodic_sample', charging_state:'Charging', battery_level:62,
      charge_limit_soc:80, charger_power:2, battery_range:180, charge_energy_added:4,
      checked_at:observed, last_check_at:observed, collection_status:'Illustrative snapshot',
      automatic_collection:false, commands_enabled:false, update_interval_minutes:30,
      records:[
        {id:'demo-supercharger',date:date(-3),source:'Supercharger',kwh:20,detail:'Fictional completed session'},
        {id:'demo-home',date:date(-1),source:'Home',kwh:8,solar:6,battery:1,grid:1,detail:'Fictional source reference'},
      ],
      observations:[{observed_at:observed,charging_state:'Charging',charger_power:2,charge_energy_added:4,charge_miles_added_rated:12}],
    };
    data['/v1/calendar'] = {status:'snapshot',demo:true,reviewed_at:observed,stale:false,
      coverage_start:date(-7),coverage_end:date(30),detail:'Fictional events. No external calendar is connected.',events:[
        {id:'demo-service',calendar_id:'example',title:'Vehicle service',start:date(1)+'T10:00:00-05:00',end:date(1)+'T10:30:00-05:00',location:'Example service center',note:'Illustrative appointment',status:'confirmed'},
        {id:'demo-trip',calendar_id:'example',title:'Weekend trip',start:date(4)+'T00:00:00-05:00',end:date(6)+'T00:00:00-05:00',location:'Example destination',note:'Date reference, not an appointment time',status:'confirmed'},
      ]};
    data['/v1/argo'] = {status:'healthy',demo:true,summary:{vehicles:3},assets:[
      ['athena','Tesla Model Y','Tesla','Model Y','Blue',24000],
      ['big-red','Truck','Chevrolet','Silverado','Red',72000],
      ['harley','Motorcycle','Harley-Davidson','Heritage Softail','Black',15000],
    ].map(([id,name,manufacturer,model,color,miles])=>({id:'vehicle-'+id,name,kind:'vehicle',status:'active',manufacturer,model,model_year:null,
      summary:'Fictional vehicle profile',source:'Public demo fixtures',identifiers:[],
      details:{color,odometer:{miles,approximate:true},verification_items:[]},
      events:[{event_date:date(-7),category:'service',title:'Recorded inspection',detail:'Tires inspected; Lights checked. Source: Fictional service record',state:'complete',mandatory:false}],
    }))};
    for (const trip of data['/v1/travel']?.trips || []) {
      if (trip.trip_type === 'business') trip.business_expenses={...trip.business_expenses,
        per_diem:{status:'reported',total:180,daily_rate:60,days:3,date_label:'Fictional trip dates',note:'Fictional owner-reported allowance, not an official rate'}};
    }
  }
};
