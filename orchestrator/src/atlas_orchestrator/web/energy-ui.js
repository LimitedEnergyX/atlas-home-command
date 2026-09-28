"use strict";
(() => {
  const colors = { home: "#3e6be6", vehicle: "#f45158", battery: "#00b66b", solar: "#ffbf00", grid: "#929292", generator: "#c99465" };
  const definitions = {
    solar: { title: "Solar", totals: [["Total Generated", "solar_kwh"]], groups: [["Used By", "solar_kwh", [["Home", "solar_to_home", "home"], ["Powerwall", "solar_to_battery", "battery"], ["Grid", "solar_to_grid", "grid"]]]] },
    home: { title: "House Load", totals: [["Total Used", "home_kwh"]], groups: [["Used From", "home_kwh", [["Powerwall", "battery_to_home", "battery"], ["Solar", "solar_to_home", "solar"], ["Grid", "grid_to_home", "grid"], ["Generator", "generator_to_home", "generator"]]]] },
    battery: { title: "Powerwall", totals: [["↑ Discharged", "battery_discharge_kwh"], ["↓ Charged", "battery_charge_kwh"]], groups: [["↑ Used By", "battery_discharge_kwh", [["Home", "battery_to_home", "home"], ["Grid", "battery_to_grid", "grid"]]], ["↓ Charged From", "battery_charge_kwh", [["Solar", "solar_to_battery", "solar"], ["Grid", "grid_to_battery", "grid"], ["Generator", "generator_to_battery", "generator"]]]] },
    grid: { title: "Grid", totals: [["↑ Imported", "grid_import_kwh"], ["↓ Exported", "grid_export_kwh"]], groups: [["↑ Used By", "grid_import_kwh", [["Home", "grid_to_home", "home"], ["Powerwall", "grid_to_battery", "battery"]]], ["↓ Exported From", "grid_export_kwh", [["Powerwall", "battery_to_grid", "battery"], ["Solar", "solar_to_grid", "solar"], ["Generator", "generator_to_grid", "generator"]]]] },
  };
  definitions.vehicle = { title: "Vehicle", totals: [["Charged", "vehicle_kwh"]], groups: [["Charged From", "vehicle_kwh", [["Powerwall", "battery_to_vehicle", "battery"], ["Solar", "solar_to_vehicle", "solar"], ["Grid", "grid_to_vehicle", "grid"]]]] };
  for (const [view, field] of [["solar", "solar_to_vehicle"], ["battery", "battery_to_vehicle"], ["grid", "grid_to_vehicle"]]) definitions[view].groups[0][2].splice(1, 0, ["Vehicle", field, "vehicle"]);
  const paths = { home: "M3 11 12 3l9 8v10h-6v-7H9v7H3Z", battery: "M8 2h8v2h3v18H5V4h3Zm5 4-5 8h4l-1 5 5-8h-4Z", solar: "M12 1v3M4 4l2 2M1 10h3M20 10h3M18 6l2-2M8 10a4 4 0 0 1 8 0M5 13h14l3 9H2Zm-1 5h16M9 13 8 22m7-9 1 9", grid: "M9 2h6l5 20M9 2 4 22M6 8h12M4 14h16M8 8l10 6M16 8 6 14M6 14l13 8M18 14 5 22", generator: "M3 8h18v12H3ZM7 4h10v4M8 14h8" };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  paths.vehicle = "M3 14 5 7h14l2 7v6h-3v-3H6v3H3Zm1 0h16M7 7l1-3h8l1 3M6 14v2m12-2v2";
  const valid = value => typeof value === "number" && Number.isFinite(value);
  const dateKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const nice = (value, digits = 1) => Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  function amount(value, largeUnit = false) {
    if (!valid(value)) return { value: "Not available", unit: "" };
    const mega = largeUnit && Math.abs(value) >= 1000;
    return { value: nice(mega ? value / 1000 : value), unit: mega ? "MWh" : "kWh" };
  }
  function percent(value, denominator) {
    if (!valid(value) || !valid(denominator) || denominator <= 0) return "";
    const valuePct = value / denominator * 100;
    return valuePct > 0 && valuePct < 1 ? "<1%" : `${Math.round(valuePct)}%`;
  }
  function stepDate(date, period, direction) {
    const at = new Date(`${date}T12:00:00Z`);
    if (period === "year") { at.setUTCMonth(0, 1); at.setUTCFullYear(at.getUTCFullYear() + direction); }
    else if (period === "month") { at.setUTCDate(1); at.setUTCMonth(at.getUTCMonth() + direction); }
    else at.setUTCDate(at.getUTCDate() + direction);
    return at.toISOString().slice(0, 10);
  }
  const visibleRows = (rows, totals) => rows.filter(row => row[2] !== "generator" || totals[row[1]] > 0);
  const icon = key => `<svg viewBox="0 0 24 24" aria-hidden="true" style="color:${colors[key]}"><path d="${paths[key]}" fill="${key === "home" || key === "battery" ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

  // Same source interval values drive totals, bar charts, and directional flow rows.
  function chartMarkup(data, view, rawWidth = 700, charge = false) {
    const width = Math.max(250, Math.round(rawWidth)), height = charge ? (width < 480 ? 115 : 90) : width < 480 ? 220 : 180;
    const left = 10, right = width - 53, top = 30, bottom = height - 32;
    const start = Date.parse(data.start), end = Date.parse(data.end);
    const signed = !charge && definitions[view].groups.length === 2;
    const source = charge ? (data.charge_level || []).filter(row => valid(row.percent)) : data.buckets || [];
    if (!source.length) return '<p class="energy-empty">No chart data for this period.</p>';
    const day = data.period === "day";
    let series = charge ? [["Charge Level", "percent", "battery", 1]] : definitions[view].groups.flatMap((group, index) => visibleRows(group[2], data.totals || {}).map(row => [...row, index === 1 ? -1 : 1]));
    series = series.filter(item => item[2] !== "vehicle" || valid(data.totals?.[item[1]]));
    if (!charge && view === "vehicle" && !source.some(row => series.some(item => valid(row.values?.[item[1]])))) return '<p class="energy-empty">Vehicle charging history is not supplied by the current Atlas feed.</p>';
    const factor = charge ? 1 : day ? 3600 / data.interval_seconds : 1;
    if (!valid(factor)) return '<p class="energy-empty">Interval duration unavailable.</p>';
    const rows = source.map(row => ({ ...row, values: charge ? { percent: row.percent } : row.values }));
    let max = charge ? 100 : 0;
    for (const row of rows) for (const direction of [1, -1]) {
      const selected = series.filter(item => item[3] === direction);
      const values = selected.map(item => row.values[item[1]]);
      if (values.every(valid)) max = Math.max(max, values.reduce((a, b) => a + b, 0) * factor);
    }
    max = max || 1;
    if (!charge) { const power = 10 ** Math.floor(Math.log10(max)); max = Math.ceil(max / power / .5) * power * .5; }
    const unit = charge ? "%" : day ? "kW" : max >= 1000 ? "MWh" : "kWh";
    const unitScale = unit === "MWh" ? 1000 : 1;
    const zero = signed ? (top + bottom) / 2 : bottom;
    const scale = (zero - top) / max;
    const y = value => zero - value * scale;
    const dayX = at => left + (Date.parse(at) - start) / (end - start) * (right - left);
    const slots = data.period === "year" ? 12 : new Date(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth() + 1, 0).getDate();
    const slotWidth = (right - left) / slots;
    const x = row => day || charge ? dayX(row.at) : left + ((data.period === "year" ? Number(row.key.slice(5, 7)) : Number(row.key.slice(8, 10))) - .5) * slotWidth;
    const bits = [`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(charge ? "Powerwall charge level" : definitions[view].title + " energy history")}">`];
    for (const value of signed ? [max, max / 2, 0, -max / 2, -max] : [max, max / 2, 0]) {
      bits.push(`<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" stroke="#343637" ${value === 0 ? 'stroke-dasharray="2 7"' : ""}/><text x="${right + 8}" y="${y(value) + 5}" fill="#a6aaa9" font-size="12">${nice(Math.abs(value) / unitScale, Math.abs(value / unitScale) % 1 ? 1 : 0)}</text>`);
    }
    bits.push(`<text x="${right + 8}" y="16" fill="#a6aaa9" font-size="12">${unit}</text>`);
    if (signed) bits.push(`<text x="${left}" y="17" class="energy-axis-label">${view === "battery" ? "Discharge" : "Import"}</text><text x="${left}" y="${bottom - 6}" class="energy-axis-label">${view === "battery" ? "Charge" : "Export"}</text>`);
    if (day || charge) {
      const accumulated = rows.map(() => ({ 1: 0, "-1": 0 }));
      series.forEach(([, field, color, direction]) => {
        let segment = [];
        const flush = () => {
          if (!segment.length) return;
          const upper = segment.map(point => `${point.x.toFixed(2)},${point.upper.toFixed(2)}`).join(" L");
          const lower = [...segment].reverse().map(point => `${point.x.toFixed(2)},${point.lower.toFixed(2)}`).join(" L");
          bits.push(`<path d="M${upper} L${lower}Z" fill="${colors[color]}" fill-opacity=".16"/><path d="M${upper}" fill="none" stroke="${colors[color]}" stroke-width="1.6"/>`);
          segment = [];
        };
        rows.forEach((row, index) => {
          const value = row.values[field];
          if (!valid(value) || (!charge && row.partial)) { flush(); accumulated[index][direction] = NaN; return; }
          const previous = rows[index - 1];
          const maxGap = charge ? 25 * 60000 : data.interval_seconds * 1500;
          if (previous && Date.parse(row.at) - Date.parse(previous.at) > maxGap) flush();
          const baseline = accumulated[index][direction];
          if (!Number.isFinite(baseline)) { flush(); return; }
          segment.push({ x: x(row), lower: y(baseline * direction), upper: y((baseline + value * factor) * direction) });
          accumulated[index][direction] += value * factor;
        });
        flush();
      });
      // Place labels at local clock times, even on 23- and 25-hour DST days.
      for (let instant = start; instant < end; instant += 3600000) {
        const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(instant));
        if ([6, 12, 18].includes(hour)) bits.push(`<text x="${dayX(new Date(instant).toISOString())}" y="${height - 7}" text-anchor="middle" class="energy-axis-label">${hour === 6 ? "6 AM" : hour === 12 ? "12 PM" : "6 PM"}</text>`);
      }
    } else {
      rows.forEach(row => {
        const bases = { 1: 0, "-1": 0 };
        const tooltip = `${row.key}${row.partial ? " (partial)" : ""}\n` + series.map(([label, field]) => `${label}: ${valid(row.values[field]) ? nice(row.values[field]) + " kWh" : "not available"}`).join("\n");
        bits.push(`<g data-energy-bucket="${esc(row.key)}" tabindex="0" role="button" aria-label="Open ${esc(row.key)} details"><title>${esc(tooltip)}</title>`);
        for (const [, field, color, direction] of series) {
          const value = row.values[field];
          if (!valid(value)) { bases[direction] = NaN; continue; }
          if (!Number.isFinite(bases[direction])) continue;
          const from = y(bases[direction] * direction), to = y((bases[direction] + value) * direction);
          bits.push(`<rect x="${x(row) - slotWidth * .32}" y="${Math.min(from, to)}" width="${slotWidth * .64}" height="${Math.abs(to - from)}" rx="2" fill="${colors[color]}"/>`);
          bases[direction] += value;
        }
        bits.push("</g>");
      });
      const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
      for (let i = 1; i <= slots; i++) if (data.period === "year" || i % 7 === 0) bits.push(`<text x="${left + (i - .5) * slotWidth}" y="${height - 7}" text-anchor="middle" class="energy-axis-label">${data.period === "year" ? months[i - 1] : i}</text>`);
    }
    bits.push("</svg>");
    return bits.join("");
  }

  // Charging references come from the reviewed local snapshot, never bundled owner data.
  function chargingHistoryMarkup(charge) {
    const chargingRecords = (Array.isArray(charge?.records) ? charge.records : []).filter(row => row && valid(row.kwh) && row.kwh >= 0);
    // Range is shown only when supplied by the vehicle or a reviewed reference.
    const miles = value => valid(value) ? `${nice(value,0)} rated mi added` : "Miles not recorded";
    const superKwh = chargingRecords.filter(row => row.source === "Supercharger").reduce((sum,row) => sum + row.kwh,0);
    const referenceRows = chargingRecords.slice().reverse().map(row => `<li><div><strong>${esc(row.date)} · ${esc(row.source)}</strong><small>${esc(row.detail)}</small>${row.source === "Home" ? `<small>Solar ${valid(row.solar) ? nice(row.solar) + ' kWh' : 'Unknown'} · Powerwall ${valid(row.battery) ? nice(row.battery) + ' kWh' : 'Unknown'} · Grid ${valid(row.grid) ? nice(row.grid) + ' kWh' : 'Unknown'}</small>` : ''}</div><div><strong>${nice(row.kwh,2)} kWh</strong><small>${miles(row.rated_miles)}</small></div></li>`).join("");
    const observations = (Array.isArray(charge?.observations) ? charge.observations : []).filter(row => row && Number.isFinite(Date.parse(row.observed_at)));
    const recent = observations.slice(-20).reverse();
    const sampleRows = recent.map(row => {
      const at = new Date(row.observed_at).toLocaleString("en-US", {timeZone:"America/Chicago", month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
      const energy = valid(row.charge_energy_added) ? `${nice(row.charge_energy_added,2)} kWh` : "Unknown";
      const range = valid(row.charge_miles_added_rated) ? `${nice(row.charge_miles_added_rated,0)} rated mi added` : "Miles not recorded";
      return `<li><div><strong>${esc(at)} Central</strong><small>${esc(row.charging_state)} · Source unknown</small></div><div><strong>${energy}</strong><small>${range}</small></div></li>`;
    }).join("");
    return `<div class="athena-source-summary"><article><span>Supercharger references</span><strong>${chargingRecords.some(row => row.source === 'Supercharger') ? nice(superKwh,2) + ' kWh' : 'Not recorded'}</strong><small>${chargingRecords.some(row => row.source === 'Supercharger') ? "Source records below" : 'No imported references'}</small></article><article><span>Home references</span><strong>${chargingRecords.some(row => row.source === 'Home') ? nice(chargingRecords.filter(row => row.source === 'Home').reduce((sum,row) => sum + row.kwh,0),2) + ' kWh' : 'Not recorded'}</strong><small>Source split only when supplied</small></article></div>
      <p class="energy-chart-note">References may cover different dates. They are not a complete charging total or a live source split.</p>
      <details class="athena-record-detail"><summary>Charging references</summary><ul class="athena-record-list">${referenceRows || (charge?.references_status === 'invalid' ? '<li>Charging references need review. The saved file could not be validated.</li>' : '<li>No charging references imported.</li>')}</ul></details>
      <details class="athena-record-detail"><summary>Saved readings · ${observations.length} available</summary><p class="energy-chart-note">Latest 20 readings. Energy is the vehicle's cumulative session counter, not energy since the previous check. Do not add rows. Sessions may be incomplete or missed. Home versus away and energy source are unknown.</p>${recent.length ? `<ul class="athena-record-list">${sampleRows}</ul>` : '<p class="energy-data-status">Waiting for the next saved charging observation.</p>'}</details>`;
  }
  if (typeof module !== "undefined") module.exports = { definitions, amount, percent, stepDate, chartMarkup, chargingHistoryMarkup };
  if (typeof document === "undefined") return;
  const selectionKey = "atlas-energy-selection-v1";
  const ui = { view: "home", period: "day", date: dateKey(), data: null, request: 0, loadedKey: null, loadedAt: 0, busy: false };
  // Keep the selected history view and period across refreshes.
  try {
    const saved = JSON.parse(window.sessionStorage?.getItem(selectionKey) || "null");
    if (window.location?.hash === "#energy" && saved) {
      if (Object.hasOwn(definitions, saved.view)) ui.view = saved.view;
      if (["day", "month", "year"].includes(saved.period)) ui.period = saved.period;
      if (/^\d{4}-\d{2}-\d{2}$/.test(saved.date) && saved.date >= "2010-01-01" && saved.date <= dateKey() && new Date(`${saved.date}T12:00:00Z`).toISOString().slice(0, 10) === saved.date) ui.date = saved.date;
    }
  } catch (_) { /* Storage can be disabled; navigation still works in memory. */ }
  const $ = id => document.getElementById(id);
  function render() {
    try { window.sessionStorage?.setItem(selectionKey, JSON.stringify({ view: ui.view, period: ui.period, date: ui.date })); } catch (_) {}
    const data = ui.data || {}, definition = definitions[ui.view];
    const reference = data.references?.find(item => item.view === ui.view);
    const totals = data.status === "reference" ? reference?.values || {} : data.totals || {};
    const date = new Date(`${ui.date}T12:00:00Z`);
    const title = ui.period === "year" ? String(date.getUTCFullYear()) : ui.period === "month" ? date.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) : ui.date === dateKey() ? "Today" : ui.date === stepDate(dateKey(), "day", -1) ? "Yesterday" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    $("energy-period-title").textContent = title;
    $("energy-date").value = ui.date;
    $("energy-date").max = dateKey();
    $("energy-period").value = ui.period;
    $("energy-next").disabled = stepDate(ui.date, ui.period, 1) > dateKey();
    $("energy-prev").disabled = stepDate(ui.date, ui.period, -1) < "2010-01-01";
    $("energy-current").textContent = ui.period === "day" ? "Today" : ui.period === "month" ? "This Month" : "This Year";
    document.querySelectorAll("[data-energy-view]").forEach(button => { button.setAttribute("aria-pressed", String(button.dataset.energyView === ui.view)); button.style.setProperty("--energy-color", colors[button.dataset.energyView]); });
    $("energy-history-view").hidden = ui.view === "vehicle";
    $("energy-vehicle-view").hidden = ui.view !== "vehicle";
    // Basic charge samples are not historical energy. Keep one set of live cards
    // in the Vehicle panel, independent of calendar availability and fetches.
    if (ui.view === "vehicle") return;
    const largeUnit = ui.period === "year" && ["solar", "home"].includes(ui.view);
    $("energy-headline").innerHTML = definition.totals.map(([label, field]) => { const formatted = amount(totals[field], largeUnit); return `<div><span>${label}</span><strong>${formatted.value}<small>${formatted.unit}</small></strong></div>`; }).join("");
    const time = data.fetched_at ? new Date(data.fetched_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    $("energy-history-status").textContent = ui.busy ? "Loading Tesla history…" : data.recorded ? `Recorded sample · ${data.date} · Not live` : data.status === "reference" ? "Screenshot snapshot · Capture date unconfirmed" : data.status === "cached" ? `Saved Tesla data · Last fetched ${time}` : data.status === "healthy" ? `Tesla · ${time}${data.in_progress ? " · Period in progress" : ""}${data.has_gaps ? " · Data gaps" : ""}${data.buckets?.some(row => row.stale) ? " · Saved chart data" : ""}` : "Tesla history unavailable";
    if (ui.view === "vehicle" && !valid(totals.vehicle_kwh)) $("energy-history-status").textContent = "Vehicle History Not Available · Not A Zero Reading";
    $("energy-history-chart").innerHTML = chartMarkup(data, ui.view, $("energy-history-chart").clientWidth);
    $("energy-chart-note").textContent = data.buckets?.length ? (ui.period === "day" ? `${nice(data.interval_seconds / 60, 0)}-minute average power · Incomplete intervals omitted` : "Tap a bar for details · Unavailable periods stay blank") : "No values inferred from screenshot charts.";
    const charge = ui.view === "battery" && ui.period === "day";
    $("energy-charge-section").hidden = !charge;
    if (charge) $("energy-charge-chart").innerHTML = chartMarkup(data, ui.view, $("energy-charge-chart").clientWidth, true) + (data.charge_level_stale ? '<p class="energy-chart-note">Saved charge-level data</p>' : "");
    $("energy-flow-groups").innerHTML = definition.groups.map(([title, denominator, rows]) => `<section><h3>${title}</h3><div class="energy-flow-table">${visibleRows(rows, totals).map(([label, field, color]) => { const value = amount(totals[field], largeUnit); return `<div class="energy-flow-row">${icon(color)}<span><b>${percent(totals[field], totals[denominator])}</b> ${label}</span><strong>${value.value} <small>${value.unit}</small></strong></div>`; }).join("")}</div></section>`).join("");
    const localDate = value => value ? new Date(value).toLocaleString([], { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) : "Not available";
    $("energy-data-details").innerHTML = `<p>Source: ${esc(data.source || "Unavailable")}. Calendar: America/Chicago. Energy: kWh, converted from Tesla Wh.</p><p>Records: ${esc(data.interval_count || 0)}. First interval: ${esc(localDate(data.coverage_start))}. Last interval: ${esc(localDate(data.coverage_end))}.</p>${data.history_start ? `<p>Saved Tesla history begins ${esc(localDate(data.history_start))}. This is the first returned record, not a confirmed installation date.</p>` : ""}<p>Percentages are calculated from energy, so they can differ from rounded Tesla app percentages. Missing intervals are not treated as zero.</p>${(data.context || []).map(note => `<p>${esc(note.event_month)}: ${esc(note.title)} (${esc(note.source)}). ${esc(note.note)}</p>`).join("")}${data.references?.length ? `<details><summary>${data.references.length} screenshot references</summary>${data.references.map(item => `<p>${esc(item.file)} · ${esc(item.view)} · ${esc(item.period_label)} · ${esc(item.note)}</p>`).join("")}</details>` : ""}`;
  }
  async function load(force = false) {
    const key = `${ui.period}:${ui.date}`;
    const request = ++ui.request;
    if (!force && !ui.busy && ui.data && ui.loadedKey === key && Date.now() - ui.loadedAt < 300000) { render(); return; }
    ui.busy = true; ui.data = null; render();
    try {
      const response = await fetch(`/v1/energy/calendar?period=${ui.period}&date=${ui.date}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(40000) });
      const data = response.ok ? await response.json() : { status: "unavailable" };
      if (request !== ui.request) return;
      if (data.recorded && /^\d{4}-\d{2}-\d{2}$/.test(data.date || "")) ui.date = data.date;
      ui.data = data; ui.loadedKey = `${ui.period}:${ui.date}`; ui.loadedAt = data.status === "healthy" || data.status === "cached" ? Date.now() : 0;
    } catch (_) { if (request !== ui.request) return; ui.data = { status: "unavailable" }; }
    ui.busy = false; render();
  }
  document.querySelectorAll("[data-energy-view]").forEach(button => {
    const key = button.dataset.energyView;
    button.innerHTML = `${icon(key)}<span>${definitions[key].title}</span>`;
    button.addEventListener("click", () => { ui.view = key; render(); });
  });
  const inspectBucket = event => {
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    const target = event.target.closest("[data-energy-bucket]");
    if (!target) return;
    const key = target.dataset.energyBucket;
    if (ui.period === "year" && /^\d{4}-\d{2}$/.test(key)) { ui.period = "month"; ui.date = `${key}-01`; }
    else if (ui.period === "month" && /^\d{4}-\d{2}-\d{2}$/.test(key)) { ui.period = "day"; ui.date = key; }
    else return;
    event.preventDefault(); load();
  };
  $("energy-history-chart").addEventListener("click", inspectBucket);
  $("energy-history-chart").addEventListener("keydown", inspectBucket);
  $("energy-period").addEventListener("change", event => { ui.period = event.target.value; load(); });
  $("energy-date").addEventListener("change", event => { if (event.target.value && event.target.value <= dateKey() && event.target.value >= "2010-01-01") { ui.date = event.target.value; load(); } else render(); });
  for (const [id, direction] of [["energy-prev", -1], ["energy-next", 1]]) $(id).addEventListener("click", () => { const next = stepDate(ui.date, ui.period, direction); if (next <= dateKey() && next >= "2010-01-01") { ui.date = next; load(); } });
  $("energy-current").addEventListener("click", () => { ui.date = dateKey(); load(true); });
  function renderChargingHistory(charge) {
    const target = $("athena-charging-records");
    if (!target) return;
    const opened = [...target.querySelectorAll("details")].map(item => item.open);
    target.innerHTML = chargingHistoryMarkup(charge);
    target.querySelectorAll("details").forEach((item,index) => { item.open = Boolean(opened[index]); });
  }
  window.AtlasEnergy = { load, render, renderChargingHistory, open(resetView = true) {
    if (resetView) ui.view = "home";
    return load();
  } };
})();
