'use strict';
const fs = require('node:fs');
const path = require('node:path');
const BASE = 'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles';
const INTERVAL = 30 * 60 * 1000;
const CAP = 1500;
const numericFields = ['battery_level', 'charge_limit_soc', 'charger_power', 'battery_range',
  'charge_energy_added', 'charge_miles_added_rated', 'charger_actual_current', 'charger_voltage', 'timestamp'];

// Store only already-requested charging fields. No location, VIN, or source guesses.
function observation(at, raw) {
  if (!Number.isFinite(Date.parse(at)) || !raw || typeof raw !== 'object') return null;
  const item = {observed_at:at};
  for (const key of numericFields) if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) item[key] = raw[key];
  if (typeof raw.charging_state === 'string') item.charging_state = raw.charging_state.slice(0,80);
  return item;
}
function observations(s) {
  const items = Array.isArray(s.observations) ? s.observations.map(row => observation(row?.observed_at, row)).filter(Boolean) : [];
  const current = observation(s.observed_at, s.charge_state);
  if (current && !items.some(row => row.observed_at === current.observed_at ||
      (current.timestamp != null && row.timestamp === current.timestamp))) items.push(current);
  return items;
}

// One outbound reader inside the existing energy service. No HTTP trigger or commands.
function createBasicReader({dataDir, get, getToken, now = Date.now, enabled:readerEnabled = true}) {
  const configPath = path.join(dataDir, 'athena-basic-config.json');
  const statePath = path.join(dataDir, 'athena-basic-state.json');
  const lockPath = path.join(dataDir, 'athena-basic.lock');
  let pending = false, fault = null;
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  function config() {
    const c = read(configPath);
    if (c.enabled !== true || c.billing_limit_usd !== 0 || !/^[A-HJ-NPR-Z0-9]{17}$/.test(c.vin || '') || !Number.isFinite(Date.parse(c.billing_verified_at))) throw Error('disabled');
    return c;
  }
  function ledger() {
    const s = read(statePath);
    if (s.version !== 1 || !s.months || typeof s.months !== 'object' || Array.isArray(s.months) ||
      !Number.isFinite(s.next_at) || s.next_at < 0 ||
      !Object.entries(s.months).every(([m,n]) => /^\d{4}-\d{2}$/.test(m) && Number.isInteger(n) && n >= 0)) throw Error('invalid_ledger');
    return s;
  }
  function save(s) {
    s.observations = observations(s).slice(-1500);
    const temp = statePath + '.tmp';
    const fd = fs.openSync(temp, 'w');
    try { fs.writeFileSync(fd, JSON.stringify(s)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, statePath);
  }
  function snapshot() {
    if (!fs.existsSync(configPath)) return null;
    let s = {}, enabled = false;
    try { config(); enabled = true; s = ledger(); } catch (_) { fault = 'Storage Or Configuration Needs Review'; }
    const month = new Date(now()).toISOString().slice(0,7);
    return {status:'basic_status', automatic_collection:readerEnabled && enabled && !fault && !s.paused,
      commands_enabled:false, checked_at:s.observed_at || null, last_check_at:s.checked_at || null,
      collection_status:fault || s.paused || s.status || 'Waiting For First Check',
      charge_state:s.charge_state || {}, update_interval_minutes:30,
      observations:observations(s).slice(-1500), stored_observation_count:observations(s).length,
      monthly_reservations:s.months?.[month] || 0, monthly_limit:CAP,
      next_check_at:readerEnabled && enabled && !fault && !s.paused && s.next_at ? new Date(s.next_at).toISOString() : null};
  }
  async function tick() {
    if (!readerEnabled || pending || !fs.existsSync(configPath)) return;
    let c, s;
    try { c = config(); s = ledger(); } catch (_) { fault = 'Storage Or Configuration Needs Review'; return; }
    if (s.paused || now() < s.next_at) return;
    let lock;
    try { lock = fs.openSync(lockPath, 'wx'); } catch (_) { fault = 'Collector Lock Needs Review'; return; }
    pending = true;
    try {
      // Re-read while locked. A missing/corrupt ledger never resets the budget.
      s = ledger();
      if (s.paused || now() < s.next_at) return;
      const month = new Date(now()).toISOString().slice(0,7);
      const count = s.months[month] || 0;
      if (count >= CAP) { s.status = 'Monthly Update Limit Reached'; save(s); return; }
      // Reserve before ALL network work. Offline checks and failures also consume a slot.
      s.months[month] = count + 1;
      s.next_at = now() + INTERVAL;
      s.checked_at = new Date(now()).toISOString();
      s.status = 'Checking';
      save(s); fault = null;
      try {
        const token = await getToken();
        const options = {headers:{Authorization:'Bearer ' + token}, timeout:15000, maxRedirects:0, maxContentLength:1000000};
        const list = await get(BASE, {...options, params:{page:1, per_page:100}});
        if (!Array.isArray(list.data?.response)) throw Error('invalid_list');
        const vehicle = list.data.response.find(v => v.vin === c.vin);
        if (!vehicle) s.status = 'Athena Not Found';
        else if (vehicle.state !== 'online') s.status = vehicle.state === 'asleep' ? 'Asleep' : 'Offline';
        else {
          const response = await get(BASE + '/' + c.vin + '/vehicle_data', {...options, params:{endpoints:'charge_state'}});
          const raw = response.data?.response?.charge_state;
          if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.battery_level)) throw Error('invalid_charge_state');
          const charge = {};
          for (const key of numericFields) if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) charge[key] = raw[key];
          if (typeof raw.charging_state === 'string') charge.charging_state = raw.charging_state.slice(0,80);
          s.charge_state = charge;
          s.observed_at = new Date(now()).toISOString();
          s.status = 'Updated';
        }
      } catch (error) {
        const code = error.response?.status;
        s.status = 'Update Unavailable';
        if ([401,402,403,412,429].includes(code)) s.paused = 'Updates Paused: Access Or Billing Needs Review';
        // Never save raw errors, tokens, location, or other vehicle data.
      }
      save(s);
    } catch (_) { fault = 'Storage Needs Review'; }
    finally { fs.closeSync(lock); fs.unlinkSync(lockPath); pending = false; }
  }
  return {tick, snapshot};
}
module.exports = {createBasicReader, INTERVAL, CAP};
