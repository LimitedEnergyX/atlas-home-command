const express = require('express');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');
const childProcess = require('child_process');
const crypto  = require('crypto');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

const ENV_PATH = process.env.ATLAS_POWERWALL_ENV_PATH || path.join(__dirname, '.env');
require('dotenv').config({ path: ENV_PATH });

const app = express();

// Only loopback origins are accepted by this local adapter.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LIVE_ENABLED = process.env.ATLAS_POWERWALL_LIVE === '1';
const COMMANDS_ENABLED = LIVE_ENABLED && process.env.ATLAS_POWERWALL_ALLOW_COMMANDS === '1';
app.use((req, res, next) => {
  const peer = req.socket.remoteAddress || '';
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  if (!loopback || !LOCAL_ORIGIN.test('http://' + req.headers.host)) return res.status(403).json({error:'Loopback access required'});
  if (req.headers.origin && !LOCAL_ORIGIN.test(req.headers.origin)) return res.status(403).json({error:'Origin not allowed'});
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && !COMMANDS_ENABLED) return res.status(403).json({error:'Commands are disabled'});
  if (!LIVE_ENABLED && req.path !== '/api/health') return res.status(503).json({error:'Live integration is disabled'});
  next();
});
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && LOCAL_ORIGIN.test(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

const HOST      = process.env.HOST      || '127.0.0.1';
const PORT      = process.env.PORT      || 17082;
const DATA_DIR  = process.env.ATLAS_POWERWALL_DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const FLEET_API = 'https://fleet-api.prd.na.vn.cloud.tesla.com';
const AUTH_URL  = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token';
const AUTHORIZE_URL = 'https://auth.tesla.com/oauth2/v3/authorize';
const REDIRECT_URI = process.env.TESLA_REDIRECT_URI || `http://localhost:${PORT}/callback`;
const VEHICLE_ENABLED = LIVE_ENABLED && process.env.ATLAS_TESLA_VEHICLE_READ_ENABLED === '1';
const TESLA_SCOPES = ['openid', 'offline_access', 'energy_device_data',
  ...(COMMANDS_ENABLED ? ['energy_cmds'] : []), ...(VEHICLE_ENABLED ? ['vehicle_device_data'] : [])].join(' ');
const SECRET_HELPER = process.env.ATLAS_SECRET_HELPER;
const NWS_ZONES = process.env.NWS_ZONES || ''; // Example County, Example County
const LAT       = Number(process.env.LAT);
const LON       = Number(process.env.LON);

const { TESLA_CLIENT_ID, TESLA_CLIENT_SECRET, TESLA_SITE_ID } = process.env;
let TESLA_REFRESH_TOKEN = process.env.TESLA_REFRESH_TOKEN;
const HA_HOST       = process.env.HA_HOST || 'localhost';
const HA_PORT       = parseInt(process.env.HA_PORT || '17081', 10);
const HA_TOKEN      = process.env.HA_TOKEN;
const HA_NOTIFY_SERVICE = process.env.HA_NOTIFY_SERVICE || 'mobile_app_example_phone';
const LOW_THRESHOLD = parseInt(process.env.BATTERY_LOW_THRESHOLD || '20');

const RATES = {
  energy:    parseFloat(process.env.UTILITY_ENERGY_RATE  || '0'),
  buyback:   parseFloat(process.env.UTILITY_BUYBACK_RATE || '0'),
  base:      parseFloat(process.env.UTILITY_BASE_CHARGE  || '0'),
  tdu_fixed: parseFloat(process.env.UTILITY_TDU_FIXED    || '0'),
  tdu_kwh:   parseFloat(process.env.UTILITY_TDU_KWH      || '0'),
  grr:       parseFloat(process.env.UTILITY_GRR_RATE     || '0'),
  tax_rate:  parseFloat(process.env.UTILITY_TAX_RATE     || '0'),
  bank:      parseFloat(process.env.UTILITY_BUYBACK_BANK || '0')
};

// Billing cycle must match the operator-configured utility contract.
const CYCLE_DAY = parseInt(process.env.UTILITY_CYCLE_DAY || '1', 10);
function cycleStart(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth();
  return d.getDate() >= CYCLE_DAY ? new Date(y, m, CYCLE_DAY) : new Date(y, m - 1, CYCLE_DAY);
}
function cycleKey(d = new Date()) { const s = cycleStart(d); return s.getFullYear() * 100 + s.getMonth(); }
function cycleLengthDays(d = new Date()) { const s = cycleStart(d); return Math.round((new Date(s.getFullYear(), s.getMonth() + 1, CYCLE_DAY) - s) / 86400000); }
function cycleElapsedDays(d = new Date()) { return (d - cycleStart(d)) / 86400000; }
function stateFile() { return path.join(DATA_DIR, 'month-state.json'); }
function saveMonthState() {
  try { require('fs').writeFileSync(stateFile(), JSON.stringify(moFin), 'utf8'); } catch (e) { console.error('[moFin:save]', e.message); }
}
function loadMonthState() {
  try {
    const fs = require('fs'), f = stateFile();
    if (!fs.existsSync(f)) return false;
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (s && s.cycle === cycleKey()) {
      moFin = { cycle: s.cycle, import_kwh: s.import_kwh || 0, export_kwh: s.export_kwh || 0, solar_kwh: s.solar_kwh || 0, home_kwh: s.home_kwh || 0 };
      console.log('[moFin:load] Restored persisted cycle ; Import:' + moFin.import_kwh.toFixed(1) + 'kWh Export:' + moFin.export_kwh.toFixed(1) + 'kWh');
      return true;
    }
  } catch (e) { console.error('[moFin:load]', e.message); }
  return false;
}
function bankFile() { return path.join(DATA_DIR, 'bank-state.json'); }
function saveBank(n) {
  try { require('fs').writeFileSync(bankFile(), JSON.stringify({ bank: n }), 'utf8'); } catch (e) { console.error('[bank:save]', e.message); }
}
function loadBank() {
  try {
    const fs = require('fs'), f = bankFile();
    if (fs.existsSync(f)) {
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (s && s.bank != null) { RATES.bank = +s.bank; console.log('[bank:load] Current UTILITY bank $' + RATES.bank.toFixed(2)); }
    }
  } catch (e) { console.error('[bank:load]', e.message); }
}

let accessToken = null, tokenExpiry = 0, latestData = null;
let authorizationBlocked = false;
let pendingAuthorization = null;
let lastAlertSent = 0, pollErrors = 0;
let activeWeatherAlerts = [], seenAlertIds = new Set(), lastAllClearSent = false;
let weatherCache = null;

// ── Financial accumulator ─────────────────────────────────────────
function mkFin() {
  return { date: new Date().toDateString(), import_kwh:0, export_kwh:0, solar_kwh:0, home_kwh:0 };
}
function mkMoFin() {
  return { cycle: cycleKey(), import_kwh:0, export_kwh:0, solar_kwh:0, home_kwh:0 };
}
let fin = mkFin();
let moFin = mkMoFin();

async function initFinFromInflux() {
  if (!INFLUX_ENABLED) return;
  const bucket = process.env.INFLUX_BUCKET || 'powerwall';
  const query = `
    from(bucket: "${bucket}")
      |> range(start: today())
      |> filter(fn: (r) => r._measurement == "financial")
      |> filter(fn: (r) => r._field == "import_kwh" or r._field == "export_kwh" or r._field == "solar_kwh" or r._field == "home_kwh")
      |> last()
  `;
  return new Promise((resolve) => {
    const vals = {};
    queryApi.queryRows(query, {
      next(row, tableMeta) { const o = tableMeta.toObject(row); vals[o._field] = o._value; },
      error(err) { console.error('[fin:init] Query error:', err.message); resolve(); },
      complete() {
        if (Object.keys(vals).length > 0) {
          fin.import_kwh = vals.import_kwh || 0;
          fin.export_kwh = vals.export_kwh || 0;
          fin.solar_kwh  = vals.solar_kwh  || 0;
          fin.home_kwh   = vals.home_kwh   || 0;
          fin.date = new Date().toDateString();
          console.log(`[fin:init] Seeded from InfluxDB ; Solar:${fin.solar_kwh.toFixed(3)}kWh Import:${fin.import_kwh.toFixed(3)}kWh Export:${fin.export_kwh.toFixed(3)}kWh`);
        } else {
          console.log('[fin:init] No InfluxDB data for today ; starting fresh');
        }
        resolve();
      }
    });
  });
}

async function initMonthFromInflux() {
  if (!INFLUX_ENABLED) return;
  const bucket = process.env.INFLUX_BUCKET || 'powerwall';
  const now = new Date();
  const monthStart = cycleStart(now).toISOString();
  const query = `
    from(bucket: "${bucket}")
      |> range(start: ${monthStart})
      |> filter(fn: (r) => r._measurement == "financial_daily")
      |> filter(fn: (r) => r._field == "import_kwh" or r._field == "export_kwh" or r._field == "solar_kwh" or r._field == "home_kwh")
      |> sum()
  `;
  return new Promise((resolve) => {
    const vals = {};
    queryApi.queryRows(query, {
      next(row, tableMeta) { const o = tableMeta.toObject(row); vals[o._field] = o._value; },
      error(err) { console.error('[moFin:init] Query error:', err.message); resolve(); },
      complete() {
        if (Object.keys(vals).length) {
          moFin.import_kwh = vals.import_kwh || 0;
          moFin.export_kwh = vals.export_kwh || 0;
          moFin.solar_kwh  = vals.solar_kwh  || 0;
          moFin.home_kwh   = vals.home_kwh   || 0;
          console.log(`[moFin:init] Seeded from InfluxDB ; Solar:${moFin.solar_kwh.toFixed(1)}kWh Import:${moFin.import_kwh.toFixed(1)}kWh Export:${moFin.export_kwh.toFixed(1)}kWh`);
        } else {
          console.log('[moFin:init] No monthly InfluxDB data ; starting fresh');
        }
        resolve();
      }
    });
  });
}

function checkRollover() {
  if (fin.date !== new Date().toDateString()) {
    // Accumulate completed day into monthly totals
    const now = new Date();
    if (moFin.cycle !== cycleKey(now)) { moFin = mkMoFin(); } // new billing cycle ; reset
    moFin.import_kwh += fin.import_kwh;
    moFin.export_kwh += fin.export_kwh;
    moFin.solar_kwh  += fin.solar_kwh;
    moFin.home_kwh   += fin.home_kwh;
    saveMonthState();
    writeFinPoint(fin, true);
    fin = mkFin();
    console.log(`[fin] Day rolled ; mo totals: Solar:${moFin.solar_kwh.toFixed(1)} Import:${moFin.import_kwh.toFixed(1)} Export:${moFin.export_kwh.toFixed(1)}`);
  }
}

function updateFin(data) {
  checkRollover();
  const h = 30 / 3600;
  fin.import_kwh += Math.max(0,  data.grid) * h;
  fin.export_kwh += Math.max(0, -data.grid) * h;
  fin.solar_kwh  += data.solar * h;
  fin.home_kwh   += data.home  * h;
}

function calcFin(f) {
  const energy_charge  = f.import_kwh * RATES.energy;
  const export_credit  = f.export_kwh * RATES.buyback;
  const credit_applied = Math.min(export_credit, energy_charge);
  const banked         = Math.max(0, export_credit - credit_applied);  // Only the leftover after offsetting energy banks
  const net_energy     = Math.max(0, energy_charge - credit_applied);
  const tdu_day        = RATES.tdu_fixed / 30 + f.import_kwh * RATES.tdu_kwh;
  const solar_savings  = f.solar_kwh * (RATES.energy + RATES.tdu_kwh);
  return { energy_charge, export_credit, credit_applied, banked, net_energy, tdu_day, solar_savings };
}

function monthEstimate() {
  const now = new Date();
  const days_so_far = cycleElapsedDays(now);  // fractional days since billing-cycle start
  if (days_so_far < 0.1) return null;
  const cycle_len = cycleLengthDays(now);

  // Actual month-to-date = completed days (moFin) + today so far (fin)
  const actual_import = moFin.import_kwh + fin.import_kwh;
  const actual_export = moFin.export_kwh + fin.export_kwh;
  const actual_solar  = moFin.solar_kwh  + fin.solar_kwh;

  // Daily averages based on actual data
  const scale = cycle_len / days_so_far;
  const mo_import = actual_import * scale;
  const mo_export = actual_export * scale;
  const mo_solar  = actual_solar  * scale;

  const mo_energy = mo_import * RATES.energy;
  const mo_credit = mo_export * RATES.buyback;
  const applied   = Math.min(mo_credit, mo_energy);            // this month's buyback credit offsets energy first
  const shortfall = mo_energy - applied;
  const from_bank = Math.min(RATES.bank, shortfall);           // draw banked credits only if this month's credit falls short
  const net_e     = shortfall - from_bank;
  const mo_banked = mo_credit - applied;                       // only the leftover banks
  const mo_tdu    = RATES.tdu_fixed + mo_import * RATES.tdu_kwh; // Oncor delivery only
  const mo_grr    = (RATES.base + net_e + mo_tdu) * RATES.grr;   // Gross Receipts Reimbursement (~2%)
  const subtotal  = RATES.base + net_e + mo_tdu + mo_grr;
  const bank_bal  = RATES.bank - from_bank + mo_banked;

  // Actual costs incurred so far this cycle (no projection)
  const mtd_energy  = actual_import * RATES.energy;
  const mtd_credit  = actual_export * RATES.buyback;
  const mtd_applied = Math.min(mtd_credit, mtd_energy);
  const mtd_banked  = mtd_credit - mtd_applied;
  const mtd_net     = mtd_energy - mtd_applied;
  const mtd_tdu     = actual_import * RATES.tdu_kwh;
  return {
    days_elapsed:      +days_so_far.toFixed(1),
    cycle_days:        cycle_len,
    mtd_import_kwh:    +actual_import.toFixed(1),
    mtd_export_kwh:    +actual_export.toFixed(1),
    mtd_energy_charge: +mtd_energy.toFixed(2),
    mtd_export_credit: +mtd_credit.toFixed(2),
    mtd_net_energy:    +mtd_net.toFixed(2),
    mtd_tdu:           +mtd_tdu.toFixed(2),
    mtd_banked:        +mtd_banked.toFixed(2),
    mo_import_kwh:     +mo_import.toFixed(1),
    mo_export_kwh:     +mo_export.toFixed(1),
    mo_solar_kwh:      +mo_solar.toFixed(1),
    mo_energy_charge:  +mo_energy.toFixed(2),
    mo_export_credit:  +mo_credit.toFixed(2),
    net_energy_charge: +net_e.toFixed(2),
    mo_tdu:            +mo_tdu.toFixed(2),
    mo_grr:            +mo_grr.toFixed(2),
    mo_base:           RATES.base,
    est_bill:          +(subtotal * (1 + RATES.tax_rate)).toFixed(2),
    mo_banked:         +mo_banked.toFixed(2),
    bank_balance:      +bank_bal.toFixed(2)
  };
}

// ── InfluxDB ──────────────────────────────────────────────────────
const INFLUX_ENABLED = LIVE_ENABLED && process.env.ATLAS_INFLUX_ENABLED === '1';
const influx   = new InfluxDB({ url: process.env.INFLUX_URL || 'http://127.0.0.1:17083', token: process.env.INFLUX_TOKEN });
const writeApi = influx.getWriteApi(process.env.INFLUX_ORG || 'atlas', process.env.INFLUX_BUCKET || 'powerwall', 's');
const queryApi = influx.getQueryApi(process.env.INFLUX_ORG || 'atlas');

async function writeEnergyPoint(d) {
  if (!INFLUX_ENABLED) return;
  try {
    writeApi.writePoint(new Point('energy')
      .tag('site','configured-site').tag('mode',d.mode).tag('grid_up',String(d.grid_up))
      .floatField('solar_kw',d.solar).floatField('home_kw',d.home).floatField('grid_kw',d.grid)
      .floatField('battery_pct',d.battery).floatField('battery_kw',Math.abs((d.raw.battery_power??0)/1000))
      .floatField('reserve_pct',d.reserve).booleanField('charging',d.charging).booleanField('storm',d.storm));
    await writeApi.flush();
  } catch(e){console.error('[influx:energy]',e.message);}
}

async function writeFinPoint(f, daily=false) {
  if (!INFLUX_ENABLED) return;
  try {
    const c = calcFin(f);
    writeApi.writePoint(new Point(daily?'financial_daily':'financial')
      .tag('site','configured-site')
      .floatField('import_kwh',   +f.import_kwh.toFixed(4))
      .floatField('export_kwh',   +f.export_kwh.toFixed(4))
      .floatField('solar_kwh',    +f.solar_kwh.toFixed(4))
      .floatField('home_kwh',     +f.home_kwh.toFixed(4))
      .floatField('import_cost',  +c.energy_charge.toFixed(4))
      .floatField('export_credit',+c.export_credit.toFixed(4))
      .floatField('credit_applied',+c.credit_applied.toFixed(4))
      .floatField('net_energy',   +c.net_energy.toFixed(4))
      .floatField('banked',       +c.banked.toFixed(4))
      .floatField('solar_savings',+c.solar_savings.toFixed(4))
      .floatField('tdu_cost',     +c.tdu_day.toFixed(4)));
    await writeApi.flush();
  } catch(e){console.error('[influx:fin]',e.message);}
}

async function writeMonthPoint() {
  if (!INFLUX_ENABLED) return;
  try {
    const m = monthEstimate();
    if (!m) return;
    writeApi.writePoint(new Point('financial_month')
      .tag('site','configured-site')
      .floatField('est_bill',          m.est_bill)
      .floatField('bank_balance',      m.bank_balance)
      .floatField('mo_banked',         m.mo_banked)
      .floatField('net_energy_charge', m.net_energy_charge)
      .floatField('mo_energy_charge',  m.mo_energy_charge)
      .floatField('mo_export_credit',  m.mo_export_credit)
      .floatField('mo_tdu',            m.mo_tdu)
      .floatField('mo_grr',            m.mo_grr)
      .floatField('mo_import_kwh',     m.mo_import_kwh)
      .floatField('mo_export_kwh',     m.mo_export_kwh)
      .floatField('mo_solar_kwh',      m.mo_solar_kwh));
    await writeApi.flush();
  } catch(e){console.error('[influx:month]',e.message);}
}

async function writeWeatherPoints(w) {
  if (!INFLUX_ENABLED) return;
  try {
    const cur = w.current;
    writeApi.writePoint(new Point('weather_current').tag('site','configured-site')
      .floatField('temp_f',      cur.temperature_2m)
      .floatField('feels_like_f',cur.apparent_temperature)
      .intField('humidity',      cur.relative_humidity_2m)
      .floatField('wind_mph',    cur.wind_speed_10m)
      .intField('wind_deg',      cur.wind_direction_10m)
      .floatField('precip_in',   cur.precipitation)
      .intField('cloud_pct',     cur.cloud_cover||0)
      .intField('weather_code',  cur.weather_code));
    for(let i=0;i<Math.min(48,w.hourly.time.length);i++){
      writeApi.writePoint(new Point('weather_hourly').tag('site','configured-site')
        .floatField('temp_f',       w.hourly.temperature_2m[i])
        .floatField('feels_like_f', w.hourly.apparent_temperature[i])
        .intField('precip_prob',    w.hourly.precipitation_probability[i])
        .floatField('precip_in',    w.hourly.precipitation[i])
        .floatField('wind_mph',     w.hourly.wind_speed_10m[i])
        .intField('weather_code',   w.hourly.weather_code[i])
        .timestamp(new Date(w.hourly.time[i])));
    }
    for(let i=0;i<w.daily.time.length;i++){
      writeApi.writePoint(new Point('weather_daily').tag('site','configured-site')
        .floatField('temp_max_f',   w.daily.temperature_2m_max[i])
        .floatField('temp_min_f',   w.daily.temperature_2m_min[i])
        .floatField('precip_in',    w.daily.precipitation_sum[i])
        .intField('precip_prob',    w.daily.precipitation_probability_max[i])
        .floatField('wind_max_mph', w.daily.wind_speed_10m_max[i])
        .intField('weather_code',   w.daily.weather_code[i])
        .timestamp(new Date(w.daily.time[i]+'T12:00:00')));
    }
    await writeApi.flush();
  } catch(e){console.error('[influx:weather]',e.message);}
}

// ── Tesla auth ────────────────────────────────────────────────────
function saveRefreshToken(token) {
  if (!SECRET_HELPER) throw new Error('ATLAS_SECRET_HELPER is not configured');
  const result = childProcess.spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SECRET_HELPER, '-Name', 'Atlas/Powerwall/TeslaRefreshToken'],
    { input: token, encoding: 'utf8', windowsHide: true, timeout: 10000 }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Windows credential update failed');
}

async function refreshToken() {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: TESLA_CLIENT_ID,
    refresh_token: TESLA_REFRESH_TOKEN
  });
  const r = await axios.post(AUTH_URL, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });
  // Tesla uses rotating refresh tokens ; save the new one immediately or next restart will 401
  if (r.data.refresh_token && r.data.refresh_token !== TESLA_REFRESH_TOKEN) {
    saveRefreshToken(r.data.refresh_token);
    TESLA_REFRESH_TOKEN = r.data.refresh_token;
    console.log('[auth] Token refreshed + rotating refresh token saved to Windows Credential Manager');
  } else {
    console.log('[auth] Token refreshed');
  }
  accessToken=r.data.access_token; tokenExpiry=Date.now()+(r.data.expires_in*1000)-60000;
  authorizationBlocked=false;
}
let tokenRefreshPending = null;
async function getToken() {
  if (!LIVE_ENABLED) throw new Error('Live Tesla access is disabled');
  if (!accessToken || Date.now() > tokenExpiry) {
    if (!tokenRefreshPending) tokenRefreshPending = refreshToken().finally(() => { tokenRefreshPending = null; });
    await tokenRefreshPending;
  }
  return accessToken;
}
const readCalendarHistory = require('./calendar-history').createCalendarReader({
  get: axios.get, getToken, base: FLEET_API + '/api/1/energy_sites/' + TESLA_SITE_ID,
});
// Optional outbound-only vehicle reader. No wake, command, or refresh endpoint.
const basicVehicle = require('./tesla-basic').createBasicReader({dataDir:DATA_DIR, get:axios.get, getToken, enabled:VEHICLE_ENABLED});

// ── Home Assistant Companion notifications ───────────────────────
async function sendHANotification(msg,severity,title,tag){
  if (!COMMANDS_ENABLED || process.env.ATLAS_NOTIFICATIONS_ENABLED !== '1') return;
  if(!HA_TOKEN){console.error('[ha-notify] HA_TOKEN is not configured');return;}
  const level=severity==='critical'?'critical':severity==='time-sensitive'?'time-sensitive':'active';
  const push={'interruption-level':level};
  if(level==='critical')push.sound={name:'default',critical:1,volume:1.0};
  const payload={title:title||'Atlas Alert',message:String(msg).slice(0,1000),data:{tag:tag||'atlas-powerwall',group:'atlas-home',push}};
  try{
    await axios.post(`http://${HA_HOST}:${HA_PORT}/api/services/notify/${HA_NOTIFY_SERVICE}`,payload,{headers:{Authorization:`Bearer ${HA_TOKEN}`,'Content-Type':'application/json'},timeout:10000});
    console.log('[ha-notify]',payload.title,':',payload.message.slice(0,60));
  }catch(e){console.error('[ha-notify]',e.message);}
}

const ENERGY_HISTORY_RANGES = Object.freeze({
  day:   { start: '-24h', window: '15m' },
  week:  { start: '-7d',  window: '2h' },
  month: { start: '-30d', window: '1d' }
});

function readEnergyHistory(rangeName) {
  if (!INFLUX_ENABLED) return Promise.reject(new Error('InfluxDB is not active'));
  const range = ENERGY_HISTORY_RANGES[rangeName];
  if (!range) return Promise.reject(new Error('range must be day, week, or month'));
  const bucket = process.env.INFLUX_BUCKET || 'powerwall';
  const query = `
    from(bucket: "${bucket}")
      |> range(start: ${range.start})
      |> filter(fn: (r) => r._measurement == "energy")
      |> filter(fn: (r) => r._field == "solar_kw" or r._field == "home_kw" or r._field == "grid_kw" or r._field == "battery_pct")
      |> aggregateWindow(every: ${range.window}, fn: mean, createEmpty: false)
      |> keep(columns: ["_time", "_field", "_value"])
  `;
  return new Promise((resolve, reject) => {
    const points = new Map();
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const item = tableMeta.toObject(row);
        const at = new Date(item._time).toISOString();
        if (!points.has(at)) points.set(at, { at });
        points.get(at)[item._field] = Number(item._value);
      },
      error: reject,
      complete() {
        resolve({ range: rangeName, window: range.window, points: [...points.values()].sort((a, b) => a.at.localeCompare(b.at)) });
      }
    });
  });
}
async function sendPWAlert(msg,p,t){
  if(Date.now()-lastAlertSent<3600000)return;lastAlertSent=Date.now();
  const severity=p==='urgent'?'critical':p==='high'?'time-sensitive':'active';
  await sendHANotification(msg,severity,'Powerwall Alert','atlas-powerwall-status');
}

// ── Weather ───────────────────────────────────────────────────────
const WMO={0:'Clear',1:'Mainly Clear',2:'Partly Cloudy',3:'Overcast',45:'Foggy',48:'Icy Fog',51:'Light Drizzle',53:'Drizzle',55:'Heavy Drizzle',61:'Light Rain',63:'Rain',65:'Heavy Rain',71:'Light Snow',73:'Snow',75:'Heavy Snow',80:'Rain Showers',81:'Showers',82:'Heavy Showers',95:'Thunderstorm',96:'T-Storm + Hail',99:'Severe T-Storm'};
const DIRS=['N','NE','E','SE','S','SW','W','NW'];
const windDir=d=>DIRS[Math.round(d/45)%8];
const wIcon=c=>c===0?'☀️':c<=2?'🌤️':c===3?'☁️':c<=48?'🌫️':c<=55?'🌦️':c<=65?'🌧️':c<=75?'❄️':c<=82?'🌦️':c>=95?'⛈️':'🌡️';

// Events that warrant an alert ; everything else is suppressed
const NWS_SEND = [
  'tornado warning','tornado emergency',
  'severe thunderstorm warning',
  'flash flood warning','flood warning',
  'tornado watch','severe thunderstorm watch',
  'winter storm warning','ice storm warning',
  'tropical storm warning','hurricane warning',
  'blizzard warning','extreme wind warning'
];

function nwsPriority(event){
  const e=(event||'').toLowerCase();
  if(e.includes('tornado warning')||e.includes('tornado emergency')||e.includes('extreme wind'))
    return{p:'urgent',t:'rotating_light,warning'};
  if(e.includes('severe thunderstorm warning')||e.includes('flash flood warning'))
    return{p:'urgent',t:'warning,cloud_lightning'};
  if(e.includes('hurricane warning')||e.includes('tropical storm warning'))
    return{p:'urgent',t:'warning,cyclone'};
  if(e.includes('warning'))return{p:'high',t:'warning'};
  if(e.includes('watch'))return{p:'high',t:'eyes,warning'};
  return{p:'default',t:'cloud'};
}

function shouldSendAlert(event){
  const e=(event||'').toLowerCase();
  return NWS_SEND.some(k=>e.includes(k));
}

function formatNWSMessage(a){
  const area = (a.areas||'').split(';')[0].trim();
  let expires = '';
  if(a.expires){
    const d = new Date(a.expires);
    expires = '\n⏰ Until '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'})+' CDT';
  }
  // Pull first meaningful sentence from headline for the detail line
  const detail = (a.headline||'').replace(/^[^.]+\.\s*/,'').replace(/\.\s*$/,'').trim();
  return a.event+'\n📍 '+area+expires+(detail?'\n'+detail:'');
}

async function pollWeather(){
  if (!LIVE_ENABLED || !Number.isFinite(LAT) || !Number.isFinite(LON)) return;
  try{
    const r=await axios.get('https://api.open-meteo.com/v1/forecast',{params:{
      latitude:LAT,longitude:LON,
      current:'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,visibility',
      hourly:'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,visibility,uv_index',
      daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,precipitation_hours,wind_speed_10m_max,uv_index_max,sunrise,sunset',
      temperature_unit:'fahrenheit',wind_speed_unit:'mph',precipitation_unit:'inch',
      timezone:'America/Chicago',forecast_days:10
    },timeout:10000});
    weatherCache=r.data;
    writeWeatherPoints(r.data);
    console.log('[weather]',Math.round(r.data.current.temperature_2m)+'°F',WMO[r.data.current.weather_code]||'');
  }catch(e){
    console.error('[weather]',e.message);
    // FAST RETRY while we have never succeeded.
    // The normal cadence is 30 min. On a reboot the first fetch can fail
    // because DNS isn't up yet ; and a 30-minute wait meant the deck showed
    // no weather for half an hour after every boot. If the cache is still
    // empty, retry in 60s instead of waiting for the next slot.
    if(!weatherCache){
      console.error('[weather] no cache yet - retrying in 60s');
      setTimeout(pollWeather,60000);
    }
  }
}

async function pollNWS(){
  if (!LIVE_ENABLED || !NWS_ZONES || !process.env.NWS_USER_AGENT) return;
  try{
    const r=await axios.get('https://api.weather.gov/alerts/active?zone='+NWS_ZONES,{headers:{'User-Agent':process.env.NWS_USER_AGENT,'Accept':'application/geo+json'},timeout:10000});
    const features=r.data.features||[];
    activeWeatherAlerts=features.map(f=>({id:f.properties.id,event:f.properties.event,headline:f.properties.headline,severity:f.properties.severity,areas:f.properties.areaDesc,expires:f.properties.expires}));
    for(const a of activeWeatherAlerts){
      if(!seenAlertIds.has(a.id)){
        seenAlertIds.add(a.id);
        if(shouldSendAlert(a.event)){
          const{p,t}=nwsPriority(a.event);
          const severity=p==='urgent'?'critical':p==='high'?'time-sensitive':'active';
          await sendHANotification(formatNWSMessage(a),severity,'⚠️ '+a.event,'atlas-weather-'+a.id);
          lastAllClearSent=false;
        } else {
          console.log('[nws] Suppressed non-critical alert:',a.event);
        }
      }
    }
    if(activeWeatherAlerts.length===0&&!lastAllClearSent&&seenAlertIds.size>0){lastAllClearSent=true;seenAlertIds.clear();await sendHANotification('No active alerts returned for the configured zones.','active','✅ Weather All Clear','atlas-weather-clear');}
  }catch(e){console.error('[nws]',e.message);}
}

// ── Tesla poll ────────────────────────────────────────────────────
async function poll(){
  if (authorizationBlocked) return;
  try{
    const token=await getToken();const headers={Authorization:'Bearer '+token};
    const base=FLEET_API+'/api/1/energy_sites/'+TESLA_SITE_ID;
    const[liveRes,infoRes]=await Promise.all([axios.get(base+'/live_status',{headers,timeout:15000}),axios.get(base+'/site_info',{headers,timeout:15000})]);
    const live=liveRes.data.response,info=infoRes.data.response;
    pollErrors=0;
    const battery=live.percentage_charged??0,solar=(live.solar_power??0)/1000,home=(live.load_power??0)/1000,grid=(live.grid_power??0)/1000;
    const gridUp=live.grid_status==='Active',charging=(live.battery_power??0)<0,mode=info.default_real_mode??'unknown',reserve=info.backup_reserve_percent??0;
    latestData={battery,reserve,storm:live.storm_mode_active??false,island:live.island_status??'unknown',solar:+solar.toFixed(2),home:+home.toFixed(2),grid:+grid.toFixed(2),grid_up:gridUp,charging,mode,site_name:info.site_name,raw:live,polled_at:new Date().toISOString()};
    updateFin(latestData);
    writeEnergyPoint(latestData);
    writeFinPoint(fin);
    writeMonthPoint();
    const c=calcFin(fin);
    if(battery<LOW_THRESHOLD&&!gridUp)await sendPWAlert('Battery at '+battery.toFixed(1)+'% ; grid offline.','urgent','warning');
    if(!gridUp)await sendPWAlert('Grid offline. Battery at '+battery.toFixed(1)+'%.','high','warning');
    if(latestData.storm)await sendPWAlert('Storm Watch active ; charging to 100%.','default','cloud_lightning');
    console.log('['+new Date().toLocaleTimeString()+'] Solar:'+solar.toFixed(2)+'kW Home:'+home.toFixed(2)+'kW Bat:'+battery.toFixed(1)+'% ('+mode+') Grid:'+(gridUp?'UP':'DOWN')+' | Export:'+fin.export_kwh.toFixed(3)+'kWh Credit:$'+c.export_credit.toFixed(3)+' Banked:$'+c.banked.toFixed(3)+' → Influx');
  }catch(err){
    pollErrors++;
    if(err.response?.status===401){
      authorizationBlocked=true;
      console.error('[poll] Tesla authorization was rejected; polling is paused until credentials are renewed and the adapter is restarted.');
      return;
    }
    console.error('[poll] Error #'+pollErrors+':',err.message);
    if(pollErrors>=5)await sendPWAlert('Powerwall polling failed 5x.','high','sos');
  }
}

// ── Routes ────────────────────────────────────────────────────────

app.get('/auth/start', (req, res) => {
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  pendingAuthorization = { state, createdAt: Date.now() };
  const authorize = new URL(AUTHORIZE_URL);
  authorize.search = new URLSearchParams({
    client_id: TESLA_CLIENT_ID,
    locale: 'en-US',
    prompt: 'login',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: TESLA_SCOPES,
    state,
    nonce,
    prompt_missing_scopes: 'true',
    require_requested_scopes: 'true'
  }).toString();
  res.redirect(302, authorize.toString());
});

// OAuth callback ; MUST be before static middleware or express.static intercepts it
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const state = String(req.query.state || '');
  const expected = pendingAuthorization;
  pendingAuthorization = null;
  if (req.query.error) return res.status(400).send('Tesla authorization was not completed.');
  if (!code || !expected || Date.now() - expected.createdAt > 10 * 60 * 1000) {
    return res.status(400).send('Authorization request is missing or expired. Start again from Atlas.');
  }
  const suppliedState = Buffer.from(state);
  const expectedState = Buffer.from(expected.state);
  if (suppliedState.length !== expectedState.length || !crypto.timingSafeEqual(suppliedState, expectedState)) {
    return res.status(400).send('Authorization state validation failed. Start again from Atlas.');
  }
  try {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: TESLA_CLIENT_ID,
      client_secret: TESLA_CLIENT_SECRET,
      code: String(code),
      audience: FLEET_API,
      redirect_uri: REDIRECT_URI,
      scope: TESLA_SCOPES
    });
    const r = await axios.post(AUTH_URL, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });
    if (!r.data.refresh_token || !r.data.access_token) throw new Error('Tesla did not return the required tokens');
    saveRefreshToken(r.data.refresh_token);
    TESLA_REFRESH_TOKEN = r.data.refresh_token;
    accessToken  = r.data.access_token;
    tokenExpiry  = Date.now() + (r.data.expires_in * 1000) - 60000;
    authorizationBlocked = false;
    pollErrors = 0;
    console.log('[auth] OAuth callback ; new token saved to Windows Credential Manager, polling resumed');
    setTimeout(poll, 1000);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.send('<!doctype html><meta charset="utf-8"><title>Atlas Energy</title><style>body{font:20px system-ui;background:#09111f;color:#eaf2ff;padding:3rem}h1{color:#6ee7ff}</style><h1>Atlas Energy authorized</h1><p>The token is protected in Windows Credential Manager. You can close this tab.</p>');
  } catch(e) {
    console.error('[auth] Callback exchange failed:', e.response?.data?.error || e.message);
    res.status(500).send('Token exchange failed: ' + (e.response?.data?.error_description || e.message));
  }
});

app.use(express.static(path.join(__dirname,'public')));

app.get('/api/powerwall',(req,res)=>{
  if(!latestData)return res.status(503).json({error:'No data yet'});
  const c=calcFin(fin);
  res.json({...latestData,vehicle_charge_snapshot:basicVehicle.snapshot(),weather_alerts:activeWeatherAlerts,
    financials:process.env.ATLAS_RATES_CONFIGURED === '1' ? {
      today:{import_kwh:+fin.import_kwh.toFixed(3),export_kwh:+fin.export_kwh.toFixed(3),solar_kwh:+fin.solar_kwh.toFixed(3),home_kwh:+fin.home_kwh.toFixed(3),import_cost:+c.energy_charge.toFixed(3),export_credit:+c.export_credit.toFixed(3),credit_applied:+c.credit_applied.toFixed(3),net_energy:+c.net_energy.toFixed(3),banked:+c.banked.toFixed(3),solar_savings:+c.solar_savings.toFixed(3)},
      monthly:monthEstimate(),rates:RATES
    } : null
  });
});

app.get('/api/weather-forecast',(req,res)=>{
  if(!weatherCache)return res.status(503).json({error:'No weather data yet'});
  const cur=weatherCache.current;
  const hourly=weatherCache.hourly.time.slice(0,48).map((t,i)=>({time:t,temp_f:Math.round(weatherCache.hourly.temperature_2m[i]),feels_like_f:Math.round(weatherCache.hourly.apparent_temperature[i]),humidity:weatherCache.hourly.relative_humidity_2m[i],precip_prob:weatherCache.hourly.precipitation_probability[i],precip_in:weatherCache.hourly.precipitation[i],wind_mph:Math.round(weatherCache.hourly.wind_speed_10m[i]),wind_gust_mph:Math.round(weatherCache.hourly.wind_gusts_10m[i]),visibility_mi:+(weatherCache.hourly.visibility[i]/1609.344).toFixed(1),uv_index:+weatherCache.hourly.uv_index[i].toFixed(1),code:weatherCache.hourly.weather_code[i],desc:WMO[weatherCache.hourly.weather_code[i]]||'Unknown',icon:wIcon(weatherCache.hourly.weather_code[i])}));
  const daily=weatherCache.daily.time.map((t,i)=>({date:t,temp_max:Math.round(weatherCache.daily.temperature_2m_max[i]),temp_min:Math.round(weatherCache.daily.temperature_2m_min[i]),precip_in:weatherCache.daily.precipitation_sum[i],precip_prob:weatherCache.daily.precipitation_probability_max[i],precip_hours:weatherCache.daily.precipitation_hours[i],wind_max:Math.round(weatherCache.daily.wind_speed_10m_max[i]),uv_max:+weatherCache.daily.uv_index_max[i].toFixed(1),sunrise:weatherCache.daily.sunrise[i],sunset:weatherCache.daily.sunset[i],code:weatherCache.daily.weather_code[i],desc:WMO[weatherCache.daily.weather_code[i]]||'Unknown',icon:wIcon(weatherCache.daily.weather_code[i])}));
  res.json({location:process.env.WEATHER_LOCATION_LABEL || 'Configured location',current:{temp_f:Math.round(cur.temperature_2m),feels_like_f:Math.round(cur.apparent_temperature),humidity:cur.relative_humidity_2m,wind_mph:Math.round(cur.wind_speed_10m),wind_gust_mph:Math.round(cur.wind_gusts_10m),wind_dir:windDir(cur.wind_direction_10m),visibility_mi:+(cur.visibility/1609.344).toFixed(1),precip_in:cur.precipitation,cloud_pct:cur.cloud_cover||0,code:cur.weather_code,desc:WMO[cur.weather_code]||'Unknown',icon:wIcon(cur.weather_code)},hourly,daily});
});

app.get('/api/financials',(req,res)=>{if(process.env.ATLAS_RATES_CONFIGURED !== '1')return res.status(503).json({error:'Configure and verify utility rates before using financial estimates'});const c=calcFin(fin);res.json({today:{...fin,...c},monthly:monthEstimate(),rates:RATES});});
app.get('/api/energy-history', async (req, res) => {
  const range = String(req.query.range || 'day').toLowerCase();
  if (!ENERGY_HISTORY_RANGES[range]) return res.status(400).json({ error: 'range must be day, week, or month' });
  try {
    res.json(await readEnergyHistory(range));
  } catch (error) {
    console.error('[energy-history]', error.message);
    res.status(503).json({ error: 'Energy history is temporarily unavailable' });
  }
});
app.get('/api/calendar-history', async (req, res) => {
  try { res.json(await readCalendarHistory(req.query)); }
  catch (error) {
    res.status(error.status || 503).json({ error: error.status === 400 ? error.message : 'Tesla history unavailable', upstream_status: error.upstream_status || null });
  }
});
app.get('/api/health',(req,res)=>res.json({ok:true,adapter:'atlas-energy',poll_ready:!!latestData,authorization:!LIVE_ENABLED?'disabled':authorizationBlocked?'renewal-required':latestData?'ready':'unverified',authorization_path:'/auth/start',secret_source:process.env.ATLAS_SECRET_SOURCE||'environment',influx_enabled:INFLUX_ENABLED,poll_errors:pollErrors,uptime:process.uptime(),weather_alerts:activeWeatherAlerts.length}));

app.post('/api/reserve',async(req,res)=>{
  const{percent}=req.body;if(percent===undefined||percent<0||percent>100)return res.status(400).json({error:'percent must be 0-100'});
  try{const t=await getToken();await axios.post(FLEET_API+'/api/1/energy_sites/'+TESLA_SITE_ID+'/backup',{backup_reserve_percent:percent},{headers:{Authorization:'Bearer '+t}});console.log('[cmd] Reserve ->',percent+'%');res.json({ok:true});setTimeout(poll,2000);}catch(e){res.status(500).json({error:e.response?.data||e.message});}
});
app.post('/api/mode',async(req,res)=>{
  const{mode}=req.body;if(!['self_consumption','backup','autonomous'].includes(mode))return res.status(400).json({error:'invalid mode'});
  try{const t=await getToken();await axios.post(FLEET_API+'/api/1/energy_sites/'+TESLA_SITE_ID+'/operation',{default_real_mode:mode},{headers:{Authorization:'Bearer '+t}});console.log('[cmd] Mode ->',mode);res.json({ok:true});setTimeout(poll,2000);}catch(e){res.status(500).json({error:e.response?.data||e.message});}
});
app.post('/api/storm',async(req,res)=>{
  const{enabled}=req.body;try{const t=await getToken();await axios.post(FLEET_API+'/api/1/energy_sites/'+TESLA_SITE_ID+'/storm_mode',{user_storm_mode_active:!!enabled},{headers:{Authorization:'Bearer '+t}});res.json({ok:true});setTimeout(poll,2000);}catch(e){res.status(500).json({error:e.response?.data||e.message});}
});
app.post('/api/max-backup',async(req,res)=>{
  try{const t=await getToken();const h={Authorization:'Bearer '+t},b=FLEET_API+'/api/1/energy_sites/'+TESLA_SITE_ID;await Promise.all([axios.post(b+'/backup',{backup_reserve_percent:100},{headers:h}),axios.post(b+'/operation',{default_real_mode:'backup'},{headers:h})]);console.log('[cmd] MAX BACKUP');res.json({ok:true});setTimeout(poll,2000);}catch(e){res.status(500).json({error:e.response?.data||e.message});}
});
app.post('/api/month-seed', (req, res) => {
  const { import_kwh, export_kwh, solar_kwh, home_kwh } = req.body;
  if (import_kwh == null || export_kwh == null || solar_kwh == null) {
    return res.status(400).json({ error: 'Required: import_kwh, export_kwh, solar_kwh' });
  }
  moFin.cycle      = cycleKey();
  moFin.import_kwh = parseFloat(import_kwh);
  moFin.export_kwh = parseFloat(export_kwh);
  moFin.solar_kwh  = parseFloat(solar_kwh);
  moFin.home_kwh   = parseFloat(home_kwh || 0);
  saveMonthState();
  console.log(`[moFin] Manual seed ; Import:${moFin.import_kwh} Export:${moFin.export_kwh} Solar:${moFin.solar_kwh}`);
  res.json({ status: 'ok', moFin });
});

app.post('/api/set-bank', (req, res) => {
  const n = parseFloat(req.body && req.body.bank);
  if (isNaN(n) || n < 0 || n > 100000) return res.status(400).json({ error: 'bank must be a non-negative number' });
  RATES.bank = n;
  saveBank(n);
  console.log('[set-bank] Current UTILITY bank set to $' + n.toFixed(2));
  res.json({ status: 'ok', bank: RATES.bank });
});

app.post('/api/restore',async(req,res)=>{
  try{const t=await getToken();const h={Authorization:'Bearer '+t},b=FLEET_API+'/api/1/energy_sites/'+TESLA_SITE_ID;await Promise.all([axios.post(b+'/backup',{backup_reserve_percent:20},{headers:h}),axios.post(b+'/operation',{default_real_mode:'self_consumption'},{headers:h})]);console.log('[cmd] Restored');res.json({ok:true});setTimeout(poll,2000);}catch(e){res.status(500).json({error:e.response?.data||e.message});}
});

(async () => {
  if (LIVE_ENABLED) await initFinFromInflux();
  if (LIVE_ENABLED && !loadMonthState()) await initMonthFromInflux();
  if (LIVE_ENABLED) loadBank();
  app.listen(PORT, HOST, () => console.log('Atlas Energy adapter -> http://' + HOST + ':' + PORT));
  if (!LIVE_ENABLED) return;
  poll();
  setInterval(poll, 30000);
  if (process.env.ATLAS_TESLA_VEHICLE_READ_ENABLED === '1') {
    const checkVehicle = () => basicVehicle.tick().catch(() => console.error('[vehicle] Collector needs review'));
    checkVehicle();
    setInterval(checkVehicle, 60000); // Persisted gate inside the reader enforces 30 minutes.
  }
  pollWeather();
  pollNWS();
  setInterval(pollWeather, 30 * 60 * 1000);
  setInterval(pollNWS, 5 * 60 * 1000);
})();
