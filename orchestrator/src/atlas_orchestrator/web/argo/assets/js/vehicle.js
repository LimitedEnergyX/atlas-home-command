(async function () {
  'use strict';
  const root = document.getElementById('vehicle-content');
  const query = new URLSearchParams(location.search);
  const id = query.get('vehicle') || 'athena';
  const page = query.get('page') || 'overview';
  const nav = window.ArgoNavigation;
  const section = nav.sections.find(s => s[0] === page);
  const selected = nav.vehicles.find(v => v.id === id);
  function el(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
  function link(text, sectionId) { const a = el('a',text,'btn light'); a.href = nav.href(id,sectionId); return a; }
  function pending(title, text) { const box = el('article',null,'fleet-pending'); box.append(el('h3',title),el('p',text)); return box; }
  function fact(label, value) { const row = el('div',null,'opt'); row.append(el('span',label),el('span',value || 'Not Recorded')); return row; }
  function eventBody(detail) {
    const box = el('div');
    const [body, ...sources] = String(detail || '').split(/\s+Source:\s*/);
    const mileage = body.match(/^([\d,]+ miles)\.\s*/);
    if (mileage) box.append(el('p',mileage[1],'fleet-event-date'));
    const list = el('ul',null,'fleet-service-list');
    const text = body.replace(/^[\d,]+ miles\.\s*/, '').replace(/^Odometer not supplied\.\s*/, '');
    for (let item of text.split(/;\s*|\n+/)) {
      item = item.trim().replace(/\.$/,'');
      if (!item || /^Vehicle serviced$/i.test(item)) continue;
      list.append(el('li',item.charAt(0).toUpperCase() + item.slice(1)));
    }
    box.append(list);
    if (sources.length) { const source = el('details',null,'small muted'); source.append(el('summary','Source'),el('p',sources.join(' Source: '))); box.append(source); }
    return box;
  }
  if (!selected || !section) { root.replaceChildren(pending('Vehicle Page Not Found','Choose a vehicle from the vehicle menu.')); return; }
  document.title = selected.name + ' | ' + section[1] + ' | Argo';
  try {
    const response = await fetch('/v1/argo', {signal:AbortSignal.timeout(15000), cache:'no-store'});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (data.status !== 'healthy') throw new Error('Vehicle records are unavailable');
    const asset = data.assets.find(a => a.id === 'vehicle-' + id);
    if (!asset) throw new Error('Vehicle record was not found');
    const details = asset.details || {};
    root.className = 'vehicle-' + id; root.replaceChildren();
    const description = [asset.model_year,asset.manufacturer,asset.model].filter(Boolean).join(' ') || selected.description;
    if (page === 'overview') {
      const config = el('section',null,'config');
      const visual = el('div',null,'fleet-vehicle-visual');
      // Generated photographic-style artwork, not evidence of a particular vehicle.
      const artwork = {athena:['model-y.png','Blue Tesla Model Y'], 'big-red':['pickup.png','Red Chevrolet Silverado'], harley:['motorcycle.png','Black Harley-Davidson Heritage Softail']}[id];
      const image = el('img',null,'fleet-owner-photo fleet-demo-photo');
      image.src='/assets/' + artwork[0]; image.alt=artwork[1] + ', generated vehicle artwork';
      visual.append(image);
      const panel = el('aside',null,'panel'); panel.append(el('h1',asset.name),el('div',description,'sub'));
      const facts = el('div',null,'vehicle-facts'); facts.append(fact('Year',asset.model_year),fact('Make',asset.manufacturer),fact('Model',asset.model),fact('Color',asset.details?.color)); panel.append(facts);
      const plate = (asset.identifiers || []).find(item => item.type === 'plate');
      if (plate) facts.append(fact('Plate',[details.plate_state,plate.value].filter(Boolean).join(' ')));
      if (details.odometer) facts.append(fact('Mileage',(details.odometer.approximate ? 'Approx. ' : '') + Number(details.odometer.miles).toLocaleString() + ' mi' + (details.odometer.approximate ? '' : ' · Reported ' + details.odometer.as_of)));
      panel.append(el('p',asset.summary,'muted'),link('Ownership & Records','ownership'),link('Service & Maintenance','service'));
      config.append(visual,panel); root.append(config);
      const content = el('section',null,'section wrap'); content.append(el('div',asset.name,'eyebrow'),el('h2','Everything In One Place'));
      const tiles = el('div',null,'grid3');
      for (const [key,title] of nav.sections.filter(s => s[0] !== 'overview')) { const a = link(title,key); a.className = 'feature'; tiles.append(a); }
      content.append(tiles); root.append(content);
    } else {
      const heading = el('header',null,'fleet-page-heading'); heading.append(el('div',asset.name,'eyebrow'),el('h1',section[1]),el('p',description)); root.append(heading);
    }
    const records = el('section',null,'section wrap fleet-records');
    const notes = {
      technology:['Vehicle Specifications','Confirm the model year, trim, engine, equipment, and owner manual before adding specifications.'],
      energy:['Fuel & Energy Records','Fuel type, tank capacity, fill-ups, mileage, and running costs have not been recorded. Vehicle readings are displayed separately on the Energy page.'],
      care:['Care Plan','Add the vehicle-specific cleaning, storage, tire, and battery-care guidance from its owner manual.'],
      service:['Service History & Schedule','No verified service history or maintenance intervals are recorded yet. Add mileage, dated receipts, and the correct owner manual before setting reminders.'],
      ownership:['Ownership Documents','Registration, insurance, warranty, and recovery documents still need to be linked to this vehicle.'],
      guide:['Vehicle Guide','Add the owner manual, starting procedure, emergency instructions, and trusted service contacts for this vehicle.'],
      overview:['Profile In Progress','This page uses the existing Atlas vehicle record. Unrecorded facts remain clearly marked until the household supplies them.'],
    };
    if (page === 'ownership' || page === 'overview') {
      records.append(el('h2','Vehicle Identity'));
      const facts = el('div',null,'vehicle-facts');
      for (const identifier of asset.identifiers || []) facts.append(fact(identifier.type === 'plate' ? 'License Plate' : identifier.type.toUpperCase(),identifier.type === 'plate' ? [details.plate_state,identifier.value].filter(Boolean).join(' ') : identifier.value));
      if (!facts.children.length) facts.append(el('p','VIN and registration identifiers have not been recorded.','muted'));
      records.append(facts);
    }
    if (['service','care','ownership','overview'].includes(page)) {
      const events = (asset.events || []).filter(e => page === 'overview' || page === 'service' || (page === 'ownership' ? ['ownership','registration','insurance','warranty','coverage'].includes(e.category) : ['maintenance','service','repair'].includes(e.category))).sort((a,b) => b.event_date.localeCompare(a.event_date));
      if (events.length) {
        records.append(el('h2',page === 'overview' ? 'Recent Records' : 'Recorded Dates & History'));
        const history = el('div',null,'fleet-history-grid');
        for (const event of (page === 'overview' ? events.slice(0,3) : events)) { const card = el('article',null,'feature'); const status = event.state.charAt(0).toUpperCase() + event.state.slice(1); card.append(el('h3',event.title),el('p',event.event_date + ' · ' + status,'fleet-event-date'),eventBody(event.detail)); history.append(card); }
        records.append(history);
        if (page === 'overview') records.append(link('View Full History','service'));
      }
    }
    // Source documents remain private; the public distribution serves no PDFs.
    if (['overview','service','guide'].includes(page) && details.preferred_shop) {
      const shop = details.preferred_shop;
      records.append(pending('Preferred Service Shop',shop.name + ' · ' + shop.address + ' · ' + shop.phone));
    }
    const context = el('details',null,'fleet-record-context'); context.append(el('summary','Record Details & Items To Confirm'));
    if (['overview','service','care'].includes(page)) {
      for (const item of details.verification_items || []) context.append(pending(item.title,item.detail));
      if (details.recall_snapshot) records.append(pending('Recall Report · ' + details.recall_snapshot.as_of,details.recall_snapshot.text));
    }
    if (details.documents?.length && ['overview','service','ownership'].includes(page)) {
      context.append(pending('Still To Confirm',(details.profile_gaps || []).join(' ')));
    } else if (page !== 'overview') context.append(pending(...notes[page]));
    if (context.children.length > 1) records.append(context);
    const source = el('details',null,'small muted'); source.append(el('summary','Record Source'),el('p',asset.source)); records.append(source);
    root.append(records);
  } catch (error) {
    root.replaceChildren(pending('Vehicle Records Unavailable','Atlas could not load ' + selected.name + '. No records were changed. Reload to retry.'));
  }
})();
