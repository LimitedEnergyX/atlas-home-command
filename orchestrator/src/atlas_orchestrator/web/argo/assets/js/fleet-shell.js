/* Shared Argo navigation. Every link stays on the current Atlas origin. */
(function () {
  'use strict';
  const vehicles = [
    {id:'athena', name:'Tesla Model Y', description:'Vehicle record'},
    {id:'big-red', name:'Truck', description:'Vehicle record'},
    {id:'harley', name:'Motorcycle', description:'Vehicle record'},
  ];
  const sections = [['overview','Overview'], ['technology','Technology'], ['energy','Fuel & Energy'], ['care','Care'], ['service','Service'], ['ownership','Ownership'], ['guide','Guide']];
  const atlasPages = [['home','Home'], ['calendar','Calendar'], ['energy','Energy'], ['environment','Environment'],
    ['security','Security'], ['pantry','Pantry'], ['travel','Travel'], ['argo','Vehicles'],
    ['maintenance','Maintenance'], ['systems','Systems'], ['agents','Agents'], ['notifications','Notifications']];
  function href(vehicle, section) {
    return '/argo/vehicle.html?vehicle=' + vehicle + '&page=' + section;
  }
  window.ArgoNavigation = {vehicles, sections, href};
  document.addEventListener('DOMContentLoaded', () => {
    const query = new URLSearchParams(location.search);
    const generic = true;
    const selected = generic ? vehicles.find(v => v.id === (query.get('vehicle') || 'athena')) : vehicles[0];
    const vehicle = selected || {id:'unknown', name:'Vehicle Not Found'};
    const file = location.pathname.split('/').pop().replace('.html','');
    const page = generic ? (query.get('page') || 'overview') : ({index:'overview', charging:'energy', '':'overview'}[file] || file);
    const bar = document.querySelector('.topbar') || document.createElement('header');
    bar.className = 'topbar solid fleet-topbar';
    bar.innerHTML = '<div class="wrap"><a class="atlas-brand" href="/#home" aria-label="Atlas Household Command Home"><span class="atlas-mark" aria-hidden="true">A</span><span><strong>ATLAS</strong><small>HOUSEHOLD COMMAND</small></span></a><div class="fleet-top-right">' +
      (!generic ? '<button class="iconbtn fleet-alerts" data-open="alerts" type="button">Alerts</button>' : '') +
      '<a class="fleet-name" href="/argo/">Argo <span>Household Vehicles</span></a>' +
      '<button class="fleet-menu-toggle" type="button" aria-label="Choose Vehicle And Page" aria-expanded="false" aria-controls="fleet-menu"><span aria-hidden="true">☰</span></button></div></div>';
    if (!bar.isConnected) document.body.prepend(bar);
    const siteRail = document.createElement('nav');
    siteRail.className = 'fleet-site-rail';
    siteRail.setAttribute('aria-label', 'Atlas Pages');
    for (const [id, title] of atlasPages) {
      const link = document.createElement('a');
      link.href = id === 'argo' ? '/argo/' : '/#' + id;
      const icon = document.createElement('span');
      icon.className = 'fleet-nav-icon fleet-icon-' + id;
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('b'); label.textContent = title;
      link.append(icon, label);
      if (id === 'argo') link.setAttribute('aria-current', 'page');
      siteRail.append(link);
    }
    bar.after(siteRail);
    const subnav = document.createElement('nav');
    subnav.className = 'fleet-subnav';
    subnav.setAttribute('aria-label', vehicle.name + ' Pages');
    const label = document.createElement('strong'); label.textContent = vehicle.name; subnav.append(label);
    for (const [id, title] of sections) {
      const a = document.createElement('a'); a.href = href(vehicle.id, id); a.textContent = vehicle.id === 'athena' && id === 'energy' ? 'Charging' : title;
      if (id === page) a.setAttribute('aria-current','page');
      subnav.append(a);
    }
    bar.after(subnav);
    const dialog = document.createElement('dialog'); dialog.id = 'fleet-menu'; dialog.className = 'fleet-menu';
    dialog.setAttribute('aria-labelledby','fleet-menu-title');
    dialog.innerHTML = '<header><div><small>ARGO · HOUSEHOLD VEHICLES</small><h2 id="fleet-menu-title">Your Garage</h2></div><button type="button" class="iconbtn fleet-close" aria-label="Close Vehicle Menu">✕</button></header>';
    for (const v of vehicles) {
      const group = document.createElement('details'); group.open = v.id === vehicle.id;
      const summary = document.createElement('summary'); summary.textContent = v.name + ' · ' + v.description; group.append(summary);
      const nav = document.createElement('nav'); nav.setAttribute('aria-label',v.name + ' Navigation');
      for (const [id,title] of sections) {
        const a = document.createElement('a'); a.href = href(v.id,id); a.textContent = v.id === 'athena' && id === 'energy' ? 'Charging' : title;
        if (v.id === vehicle.id && id === page) a.setAttribute('aria-current','page');
        nav.append(a);
      }
      group.append(nav); dialog.append(group);
    }
    const home = document.createElement('a'); home.href = '/#home'; home.className = 'fleet-home'; home.textContent = 'Return To Atlas'; dialog.append(home);
    document.body.append(dialog);
    const toggle = bar.querySelector('.fleet-menu-toggle');
    toggle.addEventListener('click', () => { dialog.showModal(); toggle.setAttribute('aria-expanded','true'); });
    dialog.querySelector('.fleet-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
    dialog.addEventListener('close', () => { toggle.setAttribute('aria-expanded','false'); toggle.focus(); });
    const note = document.createElement('p'); note.className = 'fleet-footnote';
    note.textContent = 'Argo · Atlas Household Command · LimitedEnergyX' + (!generic ? ' · Imported Owner Reference · Shared Atlas Checklists' : ' · Local Vehicle Records');
    document.body.append(note);
  });
})();
