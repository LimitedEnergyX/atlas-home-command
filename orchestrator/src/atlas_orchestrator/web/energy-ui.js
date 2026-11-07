"use strict";
(() => {
  // 2026-11-02: colour-blind-safe palette; must match .flow-icon colours in atlas.css.
  const colors = { home: "#60a5fa", vehicle: "#f472b6", battery: "#2dd4bf", solar: "#facc15", grid: "#a3a3a3", generator: "#f97316" };
  const gridDefs = `<defs><pattern id="energy-grid-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${colors.grid}" fill-opacity=".35"/><line x1="0" y1="0" x2="0" y2="6" stroke="${colors.grid}" stroke-width="2.5" stroke-opacity=".9"/></pattern></defs>`;
  const fillFor = key => key === "grid" ? "url(#energy-grid-hatch)" : colors[key];
  const dashFor = key => key === "grid" ? ' stroke-dasharray="5 3"' : "";
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
  const icon = key => `<svg viewBox="0 0 24 24" aria-hidden="true" class="flow-icon is-${key}"><path d="${paths[key]}" fill="${key === "home" || key === "battery" ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

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
    const bits = [`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(charge ? "Powerwall charge level" : definitions[view].title + " energy history")}">`, gridDefs];
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
          bits.push(`<path d="M${upper} L${lower}Z" fill="${fillFor(color)}" fill-opacity="${color === "grid" ? 1 : .5}"/><path d="M${upper}" fill="none" stroke="${colors[color]}" stroke-width="2"${dashFor(color)}/>`);
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
          bits.push(`<rect x="${x(row) - slotWidth * .32}" y="${Math.min(from, to)}" width="${slotWidth * .64}" height="${Math.abs(to - from)}" rx="2" fill="${fillFor(color)}" fill-opacity="${color === "grid" ? 1 : .6}" stroke="${colors[color]}" stroke-width="2"${dashFor(color)}/>`);
          bases[direction] += value;
        }
        bits.push("</g>");
      });
      const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
      for (let i = 1; i <= slots; i++) if (data.period === "year" || i % 7 === 0) bits.push(`<text x="${left + (i - .5) * slotWidth}" y="${height - 7}" text-anchor="middle" class="energy-axis-label">${data.period === "year" ? months[i - 1] : i}</text>`);
    }
    bits.push("</svg>");
    if (!charge && series.length) bits.push(`<div class="energy-chart-legend">${series.map(([label, , color]) => `<span><b class="ecl-swatch${color === "grid" ? " ecl-grid" : ""}" style="border-color:${colors[color]};background-color:${colors[color]}99" aria-hidden="true"></b>${esc(label)}</span>`).join("")}</div>`);
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
    const vehicleHistory = ui.view === "vehicle" && valid(totals.vehicle_kwh);
    $("energy-history-view").hidden = false; // 2026-11-02: Vehicle tab uses the same layout; tiles sit below the graph.
    $("energy-vehicle-view").hidden = ui.view !== "vehicle";
    placeAthenaHistory(); // 2026-10-16 ui: balance the two columns on wide screens
    // Basic charge samples are not historical energy. Keep one set of live cards
    // in the Vehicle panel, independent of calendar availability and fetches.
    if (ui.view === "vehicle" && !vehicleHistory) return;
    const largeUnit = ui.period === "year" && ["solar", "home"].includes(ui.view);
    $("energy-headline").innerHTML = definition.totals.map(([label, field]) => { const formatted = amount(totals[field], largeUnit); return `<div><span>${label}</span><strong>${formatted.value}<small>${formatted.unit}</small></strong></div>`; }).join("");
    if (["home", "solar"].includes(ui.view) && valid(totals.self_powered_pct)) $("energy-headline").insertAdjacentHTML("beforeend", `<div><span>Self-Powered</span><strong>${Math.round(totals.self_powered_pct)}<small>%</small></strong></div>`);
    const time = data.fetched_at ? new Date(data.fetched_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    const exampleHistory = data.demo === true || data.example === true || data.recorded === true;
    const historyLabel = ui.busy ? "Loading Tesla history…" : data.status === "not-included" ? "Not included in this illustrative capture" : data.status === "reference" ? "Screenshot snapshot · Capture date unconfirmed" : data.status === "cached" ? `Saved Tesla data · Last fetched ${time}` : data.status === "healthy" ? `Tesla · ${time}${data.in_progress ? " · Period in progress" : ""}${data.has_gaps ? " · Data gaps" : ""}${data.buckets?.some(row => row.stale) ? " · Saved chart data" : ""}` : "Tesla history unavailable";
    $("energy-history-status").textContent = exampleHistory && !ui.busy ? `${historyLabel} · Example recorded sample, not live` : historyLabel;
    if (ui.view === "vehicle" && !valid(totals.vehicle_kwh)) $("energy-history-status").textContent = "Vehicle History Not Available · Not A Zero Reading";
    // Powerwall's extra chart changes the desktop grid width. Apply the target
    // layout before measuring, otherwise the next view inherits the old scale.
    const charge = ui.view === "battery" && ui.period === "day";
    $("energy-charge-section").hidden = !charge;
    $("energy-history-chart").innerHTML = chartMarkup(data, ui.view, $("energy-history-chart").clientWidth);
    $("energy-chart-note").textContent = data.buckets?.length ? (ui.period === "day" ? `${nice(data.interval_seconds / 60, 0)}-minute average power · Incomplete intervals omitted` : "Tap a bar for details · Unavailable periods stay blank") + (ui.period === "year" && ui.date.startsWith("2025") ? " · HVAC upgrade: Dec 2025 (reported)" : "") : "No values inferred from screenshot charts.";
    if (["home", "solar", "vehicle"].includes(ui.view) && valid(totals.vehicle_kwh) && data.vehicle?.basis) $("energy-chart-note").textContent += ` \u00b7 Athena: ${data.vehicle.basis}`;
    if (ui.view === "home" && valid(totals.vehicle_kwh)) $("energy-chart-note").textContent += " \u00b7 House Load Excludes Athena Charging";
    else if (ui.view === "home" && !valid(totals.vehicle_kwh)) $("energy-chart-note").textContent += " \u00b7 Athena split unavailable for this day: House Load may include charging";
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
      ui.data = data; ui.loadedKey = key; ui.loadedAt = data.status === "healthy" || data.status === "cached" ? Date.now() : 0;
      if (ui.period === "day" && ui.date === dateKey() && (data.status === "healthy" || data.status === "cached")) publishToday(data);
    } catch (_) { if (request !== ui.request) return; ui.data = { status: "unavailable" }; }
    ui.busy = false; render();
  }
  // 2026-10-16 ui: on wide two-column layouts the Vehicle view's Charging Records sit under
  // Energy Financials so the right column does not leave a large empty gap.
  function placeAthenaHistory() {
    if (typeof window.matchMedia !== "function" || typeof document.querySelector !== "function") return;
    const wideEnergy = window.matchMedia("(min-width: 1251px)");
    const history = document.querySelector("#panel-energy .athena-history");
    const sidebar = document.querySelector("#panel-energy .energy-sidebar");
    const home = $("energy-vehicle-view");
    if (!history || !sidebar || !home) return;
    const target = ui.view === "vehicle" && wideEnergy.matches ? sidebar : home;
    if (history.parentNode !== target) target.appendChild(history);
    history.classList.toggle("in-sidebar", target === sidebar);
  }
  if (typeof window.matchMedia === "function") window.matchMedia("(min-width: 1251px)").addEventListener("change", placeAthenaHistory);
  document.querySelectorAll("[data-energy-view]").forEach(button => {
    const key = button.dataset.energyView;
    const short = { home: "Home", battery: "PW" }[key]; // 2026-10-17 mobile: short labels at narrow widths only
    button.innerHTML = short ? `${icon(key)}<span class="ev-full">${definitions[key].title}</span><span class="ev-short" aria-hidden="true">${short}</span>` : `${icon(key)}<span>${definitions[key].title}</span>`;
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
  let latestCharge = null;
  const efficiencyInput = $("athena-efficiency");
  try { const saved = Number(localStorage.getItem("atlas-athena-mi-per-kwh")); if (saved >= .1 && saved <= 10) efficiencyInput.value = String(saved); } catch (_) {}
  function renderChargingHistory(charge) {
    latestCharge = charge;
    const target = $("athena-charging-records");
    if (!target) return;
    const opened = [...target.querySelectorAll("details")].map(item => item.open);
    target.innerHTML = chargingHistoryMarkup(charge, Number(efficiencyInput?.value), typeof state !== "undefined" ? state.energy?.cost_model?.marginal_rate : null);
    target.querySelectorAll("details").forEach((item,index) => { item.open = Boolean(opened[index]) && !item.hasAttribute("data-popup"); });
  }
  efficiencyInput?.addEventListener("input", () => {
    try { localStorage.setItem("atlas-athena-mi-per-kwh", efficiencyInput.value); } catch (_) {}
    renderChargingHistory(latestCharge);
  });
  let todayData = null;
  // One CT calendar-day source for every "Today" figure (never the rolling 24 h history).
  function publishToday(data) {
    todayData = data;
    if (window.AtlasEnergy) window.AtlasEnergy.today = data;
    if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("atlas-energy-today"));
  }
  async function loadToday() {
    try {
      const response = await fetch(`/v1/energy/calendar?period=day&date=${dateKey()}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(40000) });
      if (!response.ok) return;
      const data = await response.json();
      if (data.status === "healthy" || data.status === "cached") publishToday(data);
    } catch (_) { /* keep the last good totals */ }
  }
  // 2026-11-03 bluetti-ui: Bluetti Elite 300 (portable battery) card on the Energy page. Read-only display; never sends controls.
  const bluettiNum = v => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);
  function bluettiDuration(min) { const m = bluettiNum(min); if (m === null || m <= 0) return null; const r = Math.round(m); return r >= 60 ? `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")} min` : `${r} min`; }
  function bluettiWatts(w) { const n = bluettiNum(w); if (n === null) return "\u2014"; return Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(2)} kW` : `${Math.round(n)} W`; }
  function bluettiStale(b) { const at = b && Date.parse(b.observed_at); return !Number.isFinite(at) || Date.now() - at > 20 * 60000; }
  const bluettiIn = b => (bluettiNum(b.grid_input_w) || 0) + (bluettiNum(b.pv_input_w) || 0);
  const bluettiOut = b => (bluettiNum(b.ac_out_w) || 0) + (bluettiNum(b.dc_out_w) || 0);
  function bluettiStatus(b) {
    if (!b) return "No Reading Yet";
    if (b.available === false) return "Offline (Cloud)";
    const inW = bluettiIn(b), outW = bluettiOut(b), pct = bluettiNum(b.battery_pct);
    let text;
    if (inW > 20 && (pct === null || pct < 100)) { const full = bluettiDuration(b.full_charge_time_min); text = `Charging ${(inW / 1000).toFixed(1)} kW${full ? ` \u00b7 Full In ${full}` : ""}${outW > 5 ? ` \u00b7 Out ${bluettiWatts(outW)}` : ""}`; }
    else if (outW > 5 && inW <= 20) { const left = bluettiDuration(b.battery_time_min); text = `On Battery \u00b7 AC Out ${bluettiWatts(b.ac_out_w)}${bluettiNum(b.dc_out_w) > 5 ? ` \u00b7 DC Out ${bluettiWatts(b.dc_out_w)}` : ""}${left ? ` \u00b7 ~${left} Left` : ""}`; }
    else if (inW > 20) text = outW > 5 ? `Full \u00b7 Passing ${bluettiWatts(outW)} Through` : "Full \u00b7 On Wall Power";
    else text = "Idle";
    return bluettiStale(b) ? `${text} \u00b7 Stale Reading` : text;
  }
  function renderBluetti(b) {
    const card = $("energy-bluetti-card"); if (!card) return;
    const set = (id, text) => { const node = $(id); if (node) node.textContent = text; };
    const live = Boolean(b) && b.available !== false, pct = b ? bluettiNum(b.battery_pct) : null;
    set("energy-bluetti-pct", pct === null ? "\u2014" : `${Math.round(pct)}%`);
    const meter = $("energy-bluetti-meter");
    if (meter) { meter.style.width = `${pct === null ? 0 : Math.max(0, Math.min(100, pct))}%`; meter.className = pct !== null && pct < 25 ? "bad" : ""; }
    set("energy-bluetti-state", bluettiStatus(b));
    card.classList.toggle("is-offline", !live);
    set("energy-bluetti-grid", live ? bluettiWatts(b.grid_input_w) : "\u2014");
    set("energy-bluetti-solar", live ? bluettiWatts(b.pv_input_w) : "\u2014");
    set("energy-bluetti-ac", live ? bluettiWatts(b.ac_out_w) : "\u2014");
    set("energy-bluetti-dc", live ? bluettiWatts(b.dc_out_w) : "\u2014");
    set("energy-bluetti-mode", b && b.working_mode ? `${b.working_mode}${b.sleep_mode_on ? " \u00b7 Sleep" : ""}` : "\u2014");
    const onoff = v => v === true ? "On" : v === false ? "Off" : "\u2014";
    set("energy-bluetti-outlets", b ? `AC ${onoff(b.ac_on)}${b.ac_eco_on ? " (Eco)" : ""} \u00b7 DC ${onoff(b.dc_on)}${b.dc_eco_on ? " (Eco)" : ""}` : "\u2014");
    const charging = live && bluettiIn(b) > 20;
    set("energy-bluetti-time-label", charging ? "Time To Full" : "Time Left");
    set("energy-bluetti-time", live ? (bluettiDuration(charging ? b.full_charge_time_min : b.battery_time_min) || "\u2014") : "\u2014");
    const at = b && Date.parse(b.observed_at);
    set("energy-bluetti-observed", `Cloud Data \u00b7 Offline During Internet Outage${Number.isFinite(at) ? ` \u00b7 As Of ${new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT` : ""}`);
  }
  window.AtlasBluetti = { status: bluettiStatus, duration: bluettiDuration, watts: bluettiWatts };
  // 2026-11-03 bluetti-ui2: Atlas Windows UPS card (Energy page, bottom right). Same source and wording as the
  // Command page Batteries row: GET /v1/command-center -> ups (Win32_Battery + Windows power policy). Read-only.
  const upsTitle = v => String(v ?? "").replace(/\b[a-z]/g, c => c.toUpperCase());
  let upsLast = null;
  function renderUps(u) {
    const card = $("energy-ups-card"); if (!card) return;
    const set = (id, text) => { const node = $(id); if (node) node.textContent = text; };
    const pct = u ? bluettiNum(u.chargePercent) : null, power = u ? upsTitle(u.power || "Unknown") : null;
    const onBattery = Boolean(power) && /battery/i.test(power);
    set("energy-ups-pct", pct === null ? "\u2014" : `${Math.round(pct)}%`);
    const meter = $("energy-ups-meter");
    if (meter) { meter.style.width = `${pct === null ? 0 : Math.max(0, Math.min(100, pct))}%`; meter.className = pct !== null && pct < 25 ? "bad" : ""; }
    const rt = u && bluettiNum(u.runtimeMinutes) !== null ? `~${Math.round(Number(u.runtimeMinutes))} min` : "\u2014";
    set("energy-ups-model", u && u.model ? `Atlas \u00b7 ${u.model}` : "Atlas \u00b7 Windows UPS");
    set("energy-ups-state", u ? `${power} \u00b7 ${rt} Runtime (Windows Estimate)` : "Reading Unavailable");
    card.classList.toggle("is-offline", !u || onBattery);
    set("energy-ups-power", power || "\u2014");
    set("energy-ups-runtime", rt);
    const win = (u && u.windows) || {};
    set("energy-ups-policy", u ? `Warn ${win.lowLevelDC ?? "\u2014"}% \u00b7 ${upsTitle(win.criticalActionDC || "\u2014")} At ${win.criticalLevelDC ?? "\u2014"}%` : "\u2014");
    const al = (u && u.alerts) || {};
    set("energy-ups-alerts", al.lowPercent != null ? `Low ${al.lowPercent}% \u00b7 Critical ${al.criticalPercent ?? "\u2014"}%` : "\u2014");
    const wt = (u && u.watcher) || {};
    set("energy-ups-watcher", u ? `${wt.processes ?? 0} Running` : "\u2014");
    const at = upsLast ? new Date(upsLast).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : null;
    set("energy-ups-observed", `Runtime Is A Windows Estimate; UPS Panel Reads Lower.${at ? ` \u00b7 As Of ${at} CT` : ""}`);
  }
  async function loadUps() {
    try {
      const response = await fetch("/v1/command-center", { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = response.ok ? await response.json() : null;
      if (data && data.ups) { upsLast = Date.now(); renderUps(data.ups); } else if (!upsLast) renderUps(null);
    } catch (_) { if (!upsLast) renderUps(null); }
  }
  const energyShown = () => { const p = $("panel-energy"); return Boolean(p) && !p.hidden && !document.hidden; };
  window.AtlasEnergy = { load, render, renderChargingHistory, renderBluetti, renderUps, loadUps, open(resetView = true) {
    loadUps(); // 2026-11-03 bluetti-ui2
    if (resetView) ui.view = "home";
    return load();
  } };
  window.AtlasEnergy.today = todayData;
  if (typeof document.createElement === "function") {
    loadToday();
    setInterval(loadToday, 300000);
    loadUps(); setInterval(() => { if (energyShown()) loadUps(); }, 60000);
  }
})();

/* ===== SOL LAYOUT START (2026-10-30; promoted from pilot) ===== */
/* Sol Layout (promoted 2026-10-30). Applies to #energy; #energy-pilot aliases to #energy. PREVIEW ONLY: this file never sends any Powerwall write. */
(() => {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined" || typeof document.createElement !== "function" || typeof window.addEventListener !== "function") return;
  const aliasPilot = () => { if (location.hash === "#energy-pilot") { history.replaceState(null, "", "#energy"); activate(); } };
  window.addEventListener("hashchange", aliasPilot);

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, html = "") => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (html) n.innerHTML = html; return n; };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MODES = { self_consumption: "Self-Powered", backup: "Backup-Only" }; // t644u: Time-Based Control (autonomous) removed - it can export to grid; Alex never wants Powerwall export. No export, VPP or grid-charging options.
  const PW_KWH = 13.5;            // Assumed usable Powerwall capacity (model to be confirmed).
  const ATHENA_BAND_KWH = 47.5;   // Assumed Athena 80% -> 10% band; ~61 kWh total with Powerwall.
  const LOG_KEY = "atlas.solPilot.previewLog";
  const state = { live: null, ok: false, storm: null, ageS: null };

  function activate() {
    for (const p of document.querySelectorAll(".tab-panel")) p.hidden = p.id !== "panel-energy";
    for (const t of document.querySelectorAll("[role=tab][data-tab]")) { const a = t.dataset.tab === "energy"; t.classList.toggle("active", a); t.setAttribute("aria-selected", String(a)); }
    try { window.AtlasEnergy && window.AtlasEnergy.open && window.AtlasEnergy.open(false); } catch (e) { console.warn("Sol Pilot: AtlasEnergy.open", e); }
  }

  function build() {
    const panel = $("panel-energy"); if (!panel || panel.dataset.solPilot) return; panel.dataset.solPilot = "1";
    const hero = panel.querySelector(".page-heading");
    /* Pilot badge removed on promotion; Preview Mode chip lives in the Controls column. */
    const offline = el("p", { class: "solp-offline", id: "solp-offline", hidden: "" }, "Offline — Local Data Only");
    hero.after(offline);
    panel.classList.add("has-frame"); /* ATLAS FRAME */
    const grid = el("div", { class: "solp-grid atlas-frame" });
    const main = el("div", { class: "solp-main atlas-frame-main" });
    const colA = el("div", { class: "solp-col solp-col-a" });
    const colB = el("div", { class: "solp-col solp-col-b" });
    const side = el("div", { class: "solp-side atlas-frame-rail" });
    offline.after(grid);
    colA.append(panel.querySelector("#energy-exterior-view"));
    colB.append(panel.querySelector(".energy-history-heading"), panel.querySelector("#energy-detail-view"));
    main.append(colA, colB);
    { const bottom = panel.querySelector("#energy-bottom-row"); if (bottom) main.append(bottom); } // 2026-11-03 bluetti-ui2: Bluetti + UPS row at the bottom of the main grid
    side.append(buildRail(), buildPending());
    grid.append(main, side);
    addPendingFlow();
    document.body.append(buildDialog());
    setTimeout(() => { try { window.dispatchEvent(new Event("resize")); window.AtlasEnergy?.load?.(true); } catch (e) { console.warn(e); } }, 400);
  }

  function addPendingFlow() {
    const svg = document.querySelector("#panel-energy .energy-house-flows"); const house = $("energy-house-view");
    if (!svg || !house) return;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.id = "flow-athena-house-pending"; p.setAttribute("d", "M20.2 33.2 C27 29.5 36 28.5 43.7 32");
    svg.append(p);
    house.append(el("div", { class: "solp-flow-label" }, "Athena → House (Pending)"));
  }

  function buildRail() {
    const r = el("details", { class: "solp-rail", id: "solp-rail", open: "", "data-disabled": "true" }); r._atlasRestoring = true; setTimeout(() => { r._atlasRestoring = false; }, 1500); /* t973u: rendered open on load; a click during page load must not pop it into the shared pop-up */
    r.innerHTML = `<summary><h2>Powerwall Controls <span class="solp-chip">Preview Mode</span></h2></summary>
      <div class="solp-readback" aria-live="polite">
        <div><span>Mode</span><b id="solp-rb-mode">—</b></div>
        <div><span>Backup Reserve</span><b id="solp-rb-reserve">—</b></div>
        <div><span>Storm Watch</span><b id="solp-rb-storm">—</b></div>
        <div><span>Grid</span><b id="solp-rb-grid">—</b></div>
        <div><span>Powerwall</span><b id="solp-rb-batt">—</b></div>
        <div><span>Last Poll</span><b id="solp-rb-age" class="solp-age">—</b></div>
        <div><span>Cloud Link</span><b id="solp-rb-cloud">—</b></div>
        <div><span>Powershare</span><b><span class="solp-chip">Pending</span></b></div>
      </div>
      <p class="solp-disabled-note" id="solp-disabled-note">Controls Disabled — Waiting For Live Powerwall Data.</p>
      <div class="solp-ctl"><label for="solp-reserve">Backup Reserve <span id="solp-reserve-val">—</span></label>
        <input id="solp-reserve" type="range" min="0" max="100" step="5" value="20">
        <button type="button" data-act="reserve">Review & Confirm</button></div>
      <div class="solp-ctl"><label for="solp-mode">Operating Mode</label>
        <select id="solp-mode">${Object.entries(MODES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <button type="button" data-act="mode">Review & Confirm</button></div>
      <div class="solp-ctl"><label>Storm Watch <span id="solp-storm-val">—</span></label>
        <button type="button" data-act="storm" id="solp-storm-btn">Toggle Storm Watch…</button></div>
      <div class="solp-ctl"><button type="button" class="warn" data-act="max">Prepare For Outage (Max Backup)…</button></div>
      <div class="solp-ctl"><button type="button" data-act="restore">Restore Previous Settings…</button></div>
      <p class="solp-note">Preview Mode: Nothing Is Sent To The Powerwall. Writes Route Through Tesla Cloud (Fleet API) Today; A Local Gateway Fallback Is Planned. No Export, VPP Or Grid Charging Options.</p>
      <div><b>Recent Preview Actions</b><ol class="solp-log" id="solp-log"></ol></div>`;
    r.addEventListener("input", (e) => { if (e.target.id === "solp-reserve") $("solp-reserve-val").textContent = e.target.value + "%"; });
    r.addEventListener("click", (e) => { const b = e.target.closest("button[data-act]"); if (b) openConfirm(b.dataset.act); });
    return r;
  }

  function buildPending() {
    const w = el("section", { class: "solp-pending-grid", "aria-label": "Pending Features" });
    w.innerHTML = `
      <article class="solp-pending"><h3>Wall Connector <em>Not installed</em></h3><ul><li>Power: —</li><li>Session kWh: —</li><li>Voltage: —</li><li>Plugged In: —</li><li>Faults: —</li></ul></article>
      <article class="solp-pending"><h3>Outage Runtime <em>Estimate · Powershare Pending</em></h3>
        <p class="solp-est">Powerwall Only: <b id="solp-rt-pw">—</b></p><p class="solp-est">Powerwall + Athena (80% → 10%): <b id="solp-rt-all">—</b></p>
        <p class="solp-note" id="solp-rt-basis">Estimate At Current House Load. Assumes ${PW_KWH} kWh Powerwall + ${ATHENA_BAND_KWH} kWh Athena Band (~61 kWh Total).</p></article>
      <article class="solp-pending"><h3>Backup Alerts <em>Pending</em></h3><ul><li>Athena Backing Up House</li><li>Near 10% Floor</li><li>Outage While Unplugged</li><li>Grid Restored</li></ul></article>
      <article class="solp-pending wide"><h3>Charging Session History <em>Not installed</em></h3><p class="solp-note">No wall-connector session history is connected in this package.</p></article>`;
    return w;
  }

  function buildDialog() {
    const d = el("dialog", { class: "solp-dlg", id: "solp-dlg", "aria-labelledby": "solp-dlg-title" });
    d.innerHTML = `<div class="solp-dlg-inner"><header><h2 id="solp-dlg-title">Confirm</h2><button type="button" data-close aria-label="Close">×</button></header>
      <div class="solp-dlg-body" id="solp-dlg-body"></div>
      <footer><button type="button" data-close>Cancel</button><button type="button" id="solp-dlg-go" class="warn">Confirm (Preview Only)</button></footer></div>`;
    d.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) d.close(); });
    return d;
  }

  function plan(act) {
    const L = state.live || {};
    const curMode = MODES[L.mode] || L.mode || "Unknown", curRes = L.reserve_pct != null ? L.reserve_pct + "%" : "Unknown";
    const storm = state.storm == null ? "Unknown" : state.storm ? "On" : "Off";
    if (act === "reserve") { const v = +$("solp-reserve").value; return { title: "Change Backup Reserve", cur: curRes, next: v + "%", url: "/api/reserve", body: { percent: v } }; }
    if (act === "mode") { const v = $("solp-mode").value; return { title: "Change Operating Mode", cur: curMode, next: MODES[v], url: "/api/mode", body: { mode: v } }; }
    if (act === "storm") { const v = !(state.storm === true); return { title: "Storm Watch", cur: storm, next: v ? "On" : "Off", url: "/api/storm", body: { enabled: v } }; }
    if (act === "max") return { title: "Prepare For Outage (Max Backup)", cur: `${curRes} · ${curMode}`, next: "100% · Backup-Only", url: "/api/max-backup", body: {} };
    return { title: "Restore Previous Settings", cur: `${curRes} · ${curMode}`, next: "20% · Self-Powered", url: "/api/restore", body: {}, note: "server.js restores fixed values (20% reserve, Self-Powered), not the last saved settings." };
  }

  function openConfirm(act) {
    if ($("solp-rail").dataset.disabled === "true") return;
    const p = plan(act), d = $("solp-dlg");
    $("solp-dlg-title").textContent = p.title;
    const req = `POST http://127.0.0.1:17082${p.url}\nContent-Type: application/json\n\n${JSON.stringify(p.body, null, 2)}\n\n→ server.js forwards to Tesla Fleet API (cloud): https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/energy_sites/<site>/…`;
    $("solp-dlg-body").innerHTML = `<div class="solp-change"><div><span>Current</span><b>${esc(p.cur)}</b></div><b aria-hidden="true">→</b><div><span>New</span><b>${esc(p.next)}</b></div></div>
      ${p.note ? `<p class="solp-note">${esc(p.note)}</p>` : ""}<p><b>Request That Would Be Sent</b></p><pre>${esc(req)}</pre><div id="solp-dlg-result"></div>`;
    $("solp-dlg-go").onclick = () => {
      $("solp-dlg-result").innerHTML = '<p class="solp-result">Preview Mode — Not Sent</p>';
      log(`${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} CT · ${p.title}: ${p.cur} → ${p.next} · Preview Mode — Not Sent`);
    };
    d.showModal();
  }

  function log(line) {
    let a = []; try { a = JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch {}
    if (line) { a.unshift(line); a = a.slice(0, 10); try { localStorage.setItem(LOG_KEY, JSON.stringify(a)); } catch {} }
    $("solp-log").innerHTML = a.length ? a.map((x) => `<li>${esc(x)}</li>`).join("") : "<li>None Yet</li>";
  }

  async function getJSON(url, ms = 10000) { const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }
  const L_storm = (L) => L ? (L.storm ?? L.storm_mode_active ?? L.raw?.storm_mode_active ?? null) : null;
  const fmtH = (h) => !isFinite(h) || h <= 0 ? "—" : h >= 48 ? (h / 24).toFixed(1) + " Days" : h.toFixed(1) + " Hours";

  async function poll() {
    try { state.live = await getJSON("/v1/energy/status"); state.ok = state.live.status === "healthy"; }
    catch (e) { state.ok = false; console.warn("Sol Pilot: status", e.message); }
    if (L_storm(state.live) != null) state.storm = L_storm(state.live);
    const offline = $("solp-offline");
    if (offline) {
      offline.hidden = state.ok;
      offline.textContent = state.ok ? "" : "Energy readings are unavailable.";
    }
    paint();
    try { window.dispatchEvent(new CustomEvent("atlas-sol-live", { detail: state.live || null })); } catch (e) { console.warn("Sol Hero hook", e); } // 2026-11-04 energy-page-upgrade
  }

  function paint() {
    const L = state.live || {};
    const age = L.polled_at ? (Date.now() - Date.parse(L.polled_at)) / 1000 : null;
    $("solp-rb-mode").textContent = MODES[L.mode] || L.mode || "—";
    $("solp-rb-reserve").textContent = L.reserve_pct != null ? L.reserve_pct + "%" : "—";
    $("solp-rb-storm").textContent = state.storm == null ? "Not In Feed" : state.storm ? "On" : "Off";
    $("solp-storm-val").textContent = $("solp-rb-storm").textContent;
    $("solp-rb-grid").textContent = L.grid_up == null ? "—" : L.grid_up ? "Online" : "Offline";
    $("solp-rb-batt").textContent = L.battery_pct != null ? L.battery_pct.toFixed(1) + "%" : "—";
    const a = $("solp-rb-age"); a.textContent = age == null ? "—" : age < 120 ? Math.round(age) + " s Ago" : Math.round(age / 60) + " min Ago";
    a.classList.toggle("amber", age != null && age > 90 && age <= 300); a.classList.toggle("red", age == null || age > 300);
    const cloudOk = state.ok && age != null && age <= 300;
    $("solp-rb-cloud").textContent = cloudOk ? "Connected (Tesla Cloud)" : "Down — No Cloud Writes";
    const disabled = !cloudOk;
    $("solp-rail").dataset.disabled = String(disabled);
    $("solp-disabled-note").hidden = !disabled;
    $("solp-disabled-note").textContent = !state.ok ? "Controls Disabled — Energy Service Unreachable." : "Controls Disabled — Powerwall Data Is Stale (Over 5 Minutes).";
    if (L.reserve_pct != null && !$("solp-reserve").dataset.touched) { $("solp-reserve").value = L.reserve_pct; $("solp-reserve-val").textContent = L.reserve_pct + "%"; $("solp-reserve").dataset.touched = "init"; }
    if (L.mode && MODES[L.mode] && !$("solp-mode").dataset.touched) { $("solp-mode").value = L.mode; $("solp-mode").dataset.touched = "init"; }
    const pins = L.house_pins;
    const rawLoad = Number(L.home_kw);
    const chargeNow = L.vehicle_charge_snapshot || {};
    const evNow = Number(chargeNow.charger_power);
    const splitLoad = pins && pins.athena_fresh && Number.isFinite(Number(pins.home_kw))
      ? Number(pins.home_kw)
      : (String(chargeNow.charging_state || "").toLowerCase() === "charging" && Number.isFinite(rawLoad) && Number.isFinite(evNow) && evNow > 0.1 && rawLoad + 0.05 >= evNow ? Math.max(0, rawLoad - evNow) : rawLoad);
    const load = splitLoad;
    if (load > 0.05 && L.battery_pct != null) {
      const pwKwh = PW_KWH * L.battery_pct / 100;
      $("solp-rt-pw").textContent = fmtH(pwKwh / load) + " (Est.)";
      $("solp-rt-all").textContent = fmtH((pwKwh + ATHENA_BAND_KWH) / load) + " (Est.)";
      $("solp-rt-basis").textContent = `Estimate At Current House Load ${load.toFixed(2)} kW, Powerwall ${L.battery_pct.toFixed(0)}% Of ${PW_KWH} kWh + ${ATHENA_BAND_KWH} kWh Athena Band (~61 kWh Total). Solar Not Counted.`;
    }
  }

  const visible = () => { const p = $("panel-energy"); return p && !p.hidden && !document.hidden; };
  function start() { document.body.classList.add("sol-pilot"); build(); log(); aliasPilot(); poll(); setInterval(() => { if (visible()) poll(); }, 30000); setInterval(() => { if (visible()) paint(); }, 5000); }
  if (document.readyState === "complete") start(); else window.addEventListener("load", start);
})();

/* ===== SOL LAYOUT END ===== */

/* ===== SOL HERO START (2026-11-04 energy-page-upgrade) ===== */
/* New Energy page top section: sun arc, house scene with power flows, 4 battery rails
   (Athena+Bluetti left, Powerwall+UPS right — physical house layout), mode banner.
   Display only. Reads /v1/energy/status (+ UPS via AtlasEnergy.loadUps). Never wakes Athena.
   2026-11-06 energy-4rails: physical rails + pop-overs; bottom Athena/Bluetti/UPS cards removed. */
(() => {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined" || typeof document.createElement !== "function") return;
  const $ = (id) => document.getElementById(id);
  const DASH = "\u2014";
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const kw = (v) => num(v) ? `${Math.abs(v).toFixed(2)} kW` : DASH;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MODES = { self_consumption: "Self-Powered", backup: "Backup-Only", autonomous: "Time-Based Control" };
  const PW_KWH = 13.5;
  const STALE_S = 300;
  const ct = (ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  let live = null;
  let popKind = null;

  function sunTimes(when) {
    if (typeof window.atlasSunTimes === "function") { try { return window.atlasSunTimes(when); } catch (_) {} }
    const lat = 31.2667, lon = -99.35; // Geographic center of Texas. Public sun-arc fallback only, not a household site.
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(when).split("-").map(Number);
    const rad = Math.PI / 180, J2000 = Date.UTC(2000, 0, 1, 12);
    const n = Math.round((Date.UTC(parts[0], parts[1] - 1, parts[2], 12) - J2000) / 86400000);
    const jStar = n - lon / 360;
    const M = ((357.5291 + 0.98560028 * jStar) % 360 + 360) % 360;
    const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    const L = (M + C + 180 + 102.9372) % 360;
    const transit = jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
    const decl = Math.asin(Math.sin(L * rad) * Math.sin(23.44 * rad));
    const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
    const H = Math.acos(Math.max(-1, Math.min(1, cosH))) / rad / 360;
    return { sunrise: J2000 + (transit - H) * 86400000, sunset: J2000 + (transit + H) * 86400000 };
  }
  function skyPosition(now) {
    const today = sunTimes(new Date(now));
    if (now >= today.sunrise && now <= today.sunset) return { night: false, t: (now - today.sunrise) / (today.sunset - today.sunrise), sunrise: today.sunrise, sunset: today.sunset };
    const day = 86400000;
    const start = now > today.sunset ? today.sunset : sunTimes(new Date(now - day)).sunset;
    const end = now > today.sunset ? sunTimes(new Date(now + day)).sunrise : today.sunrise;
    return { night: true, t: Math.max(0, Math.min(1, (now - start) / (end - start))), sunrise: end, sunset: start };
  }
  const stormOf = (L) => L ? (L.storm ?? L.storm_mode_active ?? L.raw?.storm_mode_active ?? null) : null;
  function liveState(L, now = Date.now()) {
    const age = L && L.polled_at ? (now - Date.parse(L.polled_at)) / 1000 : null;
    const ok = Boolean(L) && L.status === "healthy" && age != null && Number.isFinite(age) && age <= STALE_S;
    return { ok, age };
  }
  function modeInfo(L, now = Date.now()) {
    const { ok } = liveState(L, now);
    if (!ok) return { cls: "offline", icon: "\u26a0", text: "Offline", sub: "Powerwall Data Unavailable Or Stale \u00b7 Showing " + DASH };
    const pct = num(L.battery_pct) ? Math.round(L.battery_pct) : null;
    if (L.grid_up === false) {
      const load = Number(L.home_kw), hrs = pct != null && load > 0.05 ? (PW_KWH * pct / 100) / load : null;
      return { cls: "backup", icon: "\u26a0", text: "On Backup", sub: `Grid Down \u00b7 Powerwall ${pct ?? DASH}%${hrs ? ` \u00b7 About ${hrs.toFixed(1)} h At This Load (Est., Solar Not Counted)` : ""}` };
    }
    const storm = stormOf(L);
    if (storm === true) return { cls: "storm", icon: "\u26c8", text: "Storm Mode \u00b7 80% Reserve", sub: "Storm Watch On \u00b7 Holding Charge For An Outage" };
    const res = num(L.reserve_pct) ? `${Math.round(L.reserve_pct)}% Reserve` : "Reserve " + DASH;
    return { cls: "normal", icon: "\u26a1", text: `Normal \u00b7 ${res}`, sub: `Grid ${L.grid_up === true ? "Online" : DASH} \u00b7 ${MODES[L.mode] || L.mode || DASH} \u00b7 Storm Watch ${storm === false ? "Off" : "Not In Feed"}` };
  }
  function pwKw(L) {
    if (num(L?.battery_kw)) return L.battery_kw;
    return [L?.home_kw, L?.solar_kw, L?.grid_kw].every(num) ? L.home_kw - L.solar_kw - L.grid_kw : null;
  }

  function gaugeHtml(id, title, sub, fillId, pctId, subId, extraTube = "") {
    return `<button type="button" class="solh-gauge solh-g-${id}" id="solh-g-${id}" data-rail="${id}" aria-label="${esc(title)} details">
      <h3>${esc(title)}<small>${esc(sub)}</small></h3>
      <div class="solh-tube">${extraTube}<div class="solh-fill" id="${fillId}"></div></div>
      <div class="solh-pct" id="${pctId}">${DASH}</div>
      <div class="solh-sub" id="${subId}">${DASH}</div>
    </button>`;
  }

  function build() {
    const panel = $("panel-energy"), exterior = $("energy-exterior-view");
    if (!panel || !exterior || $("sol-hero")) return Boolean($("sol-hero"));
    const hero = document.createElement("section");
    hero.className = "sol-hero"; hero.id = "sol-hero"; hero.setAttribute("aria-label", "Live House Energy");
    hero.innerHTML = `
      <div class="solh-grid">
        <section class="solh-card solh-scene" id="solh-scene">
          <div class="solh-row solh-sky-row">
            <div class="solh-sky" id="solh-sky">
              <svg viewBox="0 0 1000 74" preserveAspectRatio="none" aria-hidden="true"><path class="solh-arc" d="M30 70 Q500 -40 970 70"/><path class="solh-arc-done" id="solh-arc-done" d=""/></svg>
              <div class="solh-sun-time solh-rise"><b id="solh-rise">${DASH}</b><span id="solh-rise-lbl">Sunrise</span></div>
              <div class="solh-sun-time solh-set"><b id="solh-set">${DASH}</b><span id="solh-set-lbl">Sunset</span></div>
              <div class="solh-sun" id="solh-sun"></div>
              <div class="solh-sun-pill" id="solh-sun-pill">${DASH}</div>
            </div>
          </div>
          <div class="solh-row solh-main-row">
            ${gaugeHtml("ath", "Athena", "Model Y", "solh-ath-fill", "solh-ath-pct", "solh-ath-sub")}
            ${gaugeHtml("bl", "Bluetti", "Elite 300", "solh-bl-fill", "solh-bl-pct", "solh-bl-sub")}
            <div class="solh-house" id="solh-house">
              <img src="/assets/atlas-house-photo.png" alt="Illustration of the hilltop house and solar array">
              <div class="solh-layer solh-l-night"></div><div class="solh-layer solh-l-night2"></div>
              <i class="solh-glow" data-pos="34.2,59.7"></i><i class="solh-glow" data-pos="44.3,57"></i><i class="solh-glow" data-pos="59.8,49.5"></i><i class="solh-glow" data-pos="67.4,48.4"></i><i class="solh-glow" data-pos="76.3,46.2"></i><i class="solh-glow" data-pos="82.4,44.6"></i>
              <svg class="solh-flows" viewBox="0 0 100 56.25" preserveAspectRatio="none" aria-hidden="true">
                <polygon class="solh-panel-glow" points="55.9,8.3 74.7,7.3 85.2,17.1 65.9,19.5"/>
                <path class="solh-flow-base" d="M71 13.2 C76 16 81 20 85.3 24.2"/>
                <path class="solh-flow-base" d="M96.5 52 C95 42 89 31 85.3 24.2"/>
                <path class="solh-flow-base" d="M85.3 24.2 C71 20.5 54 23 43.7 32"/>
                <path class="solh-flow-base" d="M85.3 24.2 C80 27.5 72 31 62 34.5 C50 38.5 36 39.5 27 37 C24 36 22 34.8 20.2 33.2"/>
                <path id="solh-f-solar" class="solh-flow solh-c-solar" d="M71 13.2 C76 16 81 20 85.3 24.2"/>
                <path id="solh-f-grid" class="solh-flow solh-c-grid" d="M96.5 52 C95 42 89 31 85.3 24.2"/>
                <path id="solh-f-pw" class="solh-flow solh-c-pw" d="M85.3 24.2 C71 20.5 54 23 43.7 32"/>
                <path id="solh-f-athena" class="solh-flow solh-c-athena" d="M85.3 24.2 C80 27.5 72 31 62 34.5 C50 38.5 36 39.5 27 37 C24 36 22 34.8 20.2 33.2"/>
              </svg>
              <div class="solh-hub solh-hub-house" data-pos="43.7,56.9"></div>
              <div class="solh-hub solh-hub-pw" data-pos="85.3,43"></div>
              <div class="solh-label solh-lb-solar" id="solh-lb-solar" data-pos="74,26"><small>Solar</small>${DASH}</div>
              <div class="solh-label solh-lb-house" id="solh-lb-house-wrap" data-pos="58,38"><small>House</small><span id="solh-lb-house">${DASH}</span></div>
              <div class="solh-label solh-lb-grid" id="solh-lb-grid" data-pos="90,86"><small>Grid</small>${DASH}</div>
              <div class="solh-label solh-lb-pw" id="solh-lb-pw" data-pos="88,33"><small>Powerwall</small>${DASH}</div>
              <div class="solh-label solh-lb-athena" id="solh-lb-athena" data-pos="20,70"><small>Athena</small>${DASH}</div>
              <div class="solh-tag" id="solh-tag">${DASH}</div>
            </div>
            ${gaugeHtml("pw", "Powerwall", "Battery", "solh-pw-fill", "solh-pw-pct", "solh-pw-sub", '<div class="solh-reserve" id="solh-pw-res"></div>')}
            ${gaugeHtml("ups", "UPS", "Server UPS", "solh-ups-fill", "solh-ups-pct", "solh-ups-sub")}
          </div>
        </section>
        <aside class="solh-side" id="solh-side">
          <div class="solh-mode" id="solh-mode" role="status"><div class="solh-mi" id="solh-mode-icon">\u26a1</div><span>Mode</span><strong id="solh-mode-text">${DASH}</strong><small id="solh-mode-sub">${DASH}</small></div>
          <div class="solh-stats" id="solh-stats">
            <article class="solh-today" id="solh-today"><span>Today</span><strong id="solh-today-solar">${DASH}</strong><small id="solh-today-note">Solar Generated</small></article>
          </div>
        </aside>
      </div>
      <div class="solh-pop" id="solh-pop" hidden role="dialog" aria-modal="true" aria-labelledby="solh-pop-title">
        <div class="solh-pop-card">
          <header><h3 id="solh-pop-title">Details</h3><button type="button" class="solh-pop-x" id="solh-pop-x" aria-label="Close">\u00d7</button></header>
          <div class="solh-pop-body" id="solh-pop-body"></div>
        </div>
      </div>`;
    exterior.before(hero);
    hero.querySelectorAll("[data-pos]").forEach((el) => { const [l, t] = el.dataset.pos.split(","); el.style.left = l + "%"; el.style.top = t + "%"; });
    const cards = exterior.querySelector(".energy-full-grid");
    if (cards) $("solh-stats").prepend(cards);
    const bottom = $("energy-bottom-row"); if (bottom) bottom.hidden = true;
    const athena = exterior.querySelector(".energy-exterior-athena"); if (athena) athena.hidden = true;
    const caveat = $("energy-exterior-caveat"); if (caveat) caveat.hidden = true;
    panel.classList.add("sol-hero-on", "sol-rails-4");
    wirePop();
    return true;
  }

  function atlasHousePulse(id, kwv) { const p = document.getElementById(id); if (!p) return; const v = Number(kwv); const on = Number.isFinite(v) && v > 0.05; p.classList.remove("is-rev"); p.classList.toggle("is-on", on); let q = document.getElementById(id + "-pulse"); if (!q) { q = p.cloneNode(false); q.id = id + "-pulse"; q.removeAttribute("class"); q.setAttribute("pathLength", "100"); q.classList.add("house-pulse"); p.after(q); } q.classList.toggle("is-on", on); q.style.setProperty("--pulse-dur", (on ? Math.max(2, Math.min(4, 4 - v * 0.4)) : 3).toFixed(2) + "s"); }
  function setFlow(path, label, value, fwd, back, name, extraIdle) {
    const p = $(path), l = $(label); if (!p || !l) return;
    if (extraIdle || !num(value) || Math.abs(value) < 0.05) {
      p.setAttribute("class", p.getAttribute("class").replace(/\s*\b(is-on|is-rev)\b/g, ""));
      l.innerHTML = `<small>${name}</small>${extraIdle || (num(value) ? "Idle" : DASH)}`; l.classList.add("is-idle"); return;
    }
    const base = p.getAttribute("class").replace(/\s*\b(is-on|is-rev)\b/g, "");
    p.setAttribute("class", `${base} is-on${value < 0 ? " is-rev" : ""}`);
    l.innerHTML = `<small>${value < 0 ? back : fwd}</small>${kw(value)}`; l.classList.remove("is-idle");
  }

  function athenaShort(charge, athenaOn) {
    if (!charge) return "No Reading";
    const key = String(charge.charging_state || "").toLowerCase().replace(/[\s_]/g, "");
    if (athenaOn || key === "charging" || key === "starting") return "Charging";
    if (key === "complete") return "Plugged \u00b7 Complete";
    if (key === "stopped" || key === "nopower") return "Plugged \u00b7 Stopped";
    if (key === "disconnected" || key === "unplugged") return "Unplugged";
    if (typeof window.athenaWords === "function") {
      const w = String(window.athenaWords(charge) || "");
      if (/unplug/i.test(w)) return "Unplugged";
      if (/charg/i.test(w)) return "Charging";
      if (/complete/i.test(w)) return "Complete";
      if (/plugged/i.test(w)) return "Plugged \u00b7 Idle";
      return w.split(/[·.]/)[0].trim() || "Idle";
    }
    return charge.charging_state || "Idle";
  }

  function closePop() {
    const pop = $("solh-pop"); if (!pop) return;
    pop.hidden = true; popKind = null;
    document.querySelectorAll(".solh-gauge.is-open").forEach((g) => g.classList.remove("is-open"));
  }
  function openPop(kind) {
    const pop = $("solh-pop"), body = $("solh-pop-body"), title = $("solh-pop-title");
    if (!pop || !body || !title) return;
    const L = live, now = Date.now();
    const rows = (pairs) => `<div class="solh-pop-grid">${pairs.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join("")}</div>`;
    let html = "", ttl = "Details";
    if (kind === "ath") {
      ttl = "Athena";
      const charge = L?.vehicle_charge_snapshot, hp = L?.house_pins;
      const at = hp?.athena_as_of || (typeof charge?.timestamp === "number" ? new Date(charge.timestamp).toISOString() : null);
      const asof = at && Number.isFinite(Date.parse(at)) ? `As of ${ct(Date.parse(at))} CT` : "Periodic Snapshot";
      const pct = charge && num(Number(charge.battery_level)) ? `${Math.round(charge.battery_level)}%` : DASH;
      const range = charge && num(Number(charge.battery_range)) ? `${Math.round(charge.battery_range)} mi` : DASH;
      const state = charge ? (typeof window.athenaWords === "function" ? window.athenaWords(charge) : (charge.charging_state || DASH)) : "Reading Unavailable";
      const alert = $("athena-alert-card");
      html = rows([
        ["Battery", esc(pct)], ["Range", esc(range)], ["State", esc(state)],
        ["Snapshot", esc(asof)],
        ["Note", "House Load excludes Athena while charging"],
        ["Controls", "Read-Only \u00b7 No Fleet Wake"],
      ]) + (alert && !alert.hidden && alert.textContent ? `<p class="solh-pop-alert">${esc(alert.textContent)}</p>` : "");
    } else if (kind === "bl") {
      ttl = "Bluetti Elite 300";
      const b = L?.bluetti;
      const liveB = Boolean(b) && b.available !== false;
      const watts = window.AtlasBluetti?.watts || ((w) => (w == null ? DASH : `${Math.round(Number(w))} W`));
      const status = window.AtlasBluetti?.status ? window.AtlasBluetti.status(b) : (liveB ? "Reading Available" : "Offline");
      const dur = window.AtlasBluetti?.duration;
      const charging = liveB && ((Number(b.grid_input_w) || 0) + (Number(b.pv_input_w) || 0)) > 20;
      const time = liveB && dur ? (dur(charging ? b.full_charge_time_min : b.battery_time_min) || DASH) : DASH;
      const onoff = (v) => v === true ? "On" : v === false ? "Off" : DASH;
      const at = b && Date.parse(b.observed_at);
      html = rows([
        ["Battery", liveB && b.battery_pct != null ? `${Math.round(b.battery_pct)}%` : DASH],
        ["Status", esc(status)],
        ["Grid In", esc(liveB ? watts(b.grid_input_w) : DASH)],
        ["Solar In", esc(liveB ? watts(b.pv_input_w) : DASH)],
        ["AC Out", esc(liveB ? watts(b.ac_out_w) : DASH)],
        ["DC Out", esc(liveB ? watts(b.dc_out_w) : DASH)],
        ["Mode", esc(b?.working_mode ? `${b.working_mode}${b.sleep_mode_on ? " \u00b7 Sleep" : ""}` : DASH)],
        ["Outlets", esc(b ? `AC ${onoff(b.ac_on)}${b.ac_eco_on ? " (Eco)" : ""} \u00b7 DC ${onoff(b.dc_on)}${b.dc_eco_on ? " (Eco)" : ""}` : DASH)],
        [charging ? "Time To Full" : "Time Left", esc(time)],
        ["Observed", `Cloud Data \u00b7 Offline During Internet Outage${Number.isFinite(at) ? ` \u00b7 As Of ${ct(at)} CT` : ""}`],
      ]);
    } else if (kind === "pw") {
      ttl = "Powerwall";
      const { ok } = liveState(L, now); const md = modeInfo(L, now); const pw = ok ? pwKw(L) : null;
      const pct = ok && num(L.battery_pct) ? `${L.battery_pct.toFixed(1)}%` : DASH;
      const res = ok && num(L.reserve_pct) ? `${Math.round(L.reserve_pct)}%` : DASH;
      let flow = DASH;
      if (ok && pw != null) flow = Math.abs(pw) < 0.05 ? "Standby" : `${pw > 0 ? "Discharging" : "Charging"} \u00b7 ${kw(pw)}`;
      html = rows([
        ["Battery", esc(pct)], ["Reserve", esc(res)], ["Flow", esc(flow)],
        ["Mode", esc(md.text)], ["Grid", esc(L?.grid_up === false ? "Offline" : L?.grid_up === true ? "Online" : DASH)],
        ["Storm Watch", esc(stormOf(L) === true ? "On" : stormOf(L) === false ? "Off" : "Not In Feed")],
      ]);
    } else if (kind === "ups") {
      ttl = "Atlas UPS";
      const get = (id) => { const n = $(id); return n ? n.textContent : DASH; };
      html = rows([
        ["Battery", esc(get("energy-ups-pct"))],
        ["Model", esc(get("energy-ups-model"))],
        ["Power", esc(get("energy-ups-power"))],
        ["Runtime", esc(get("energy-ups-runtime"))],
        ["Windows Policy", esc(get("energy-ups-policy"))],
        ["Phone Alerts", esc(get("energy-ups-alerts"))],
        ["UPS Watcher", esc(get("energy-ups-watcher"))],
        ["Observed", esc(get("energy-ups-observed"))],
      ]);
    } else return;
    title.textContent = ttl;
    body.innerHTML = html;
    pop.hidden = false; popKind = kind;
    document.querySelectorAll(".solh-gauge.is-open").forEach((g) => g.classList.remove("is-open"));
    const g = $(`solh-g-${kind}`); if (g) g.classList.add("is-open");
  }
  function wirePop() {
    ["ath", "bl", "pw", "ups"].forEach((k) => {
      const g = $(`solh-g-${k}`); if (!g || g.dataset.popWired) return;
      g.dataset.popWired = "1";
      g.addEventListener("click", () => { if (popKind === k) closePop(); else openPop(k); });
    });
    $("solh-pop-x")?.addEventListener("click", closePop);
    $("solh-pop")?.addEventListener("click", (e) => { if (e.target.id === "solh-pop") closePop(); });
    if (!document.documentElement.dataset.solhEsc) {
      document.documentElement.dataset.solhEsc = "1";
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && popKind) closePop(); });
    }
  }

  function render(L = live, now = Date.now()) {
    if (!$("sol-hero") && !build()) return;
    { const ex = $("energy-exterior-view"), hh = $("sol-hero"); if (ex && hh && hh.nextElementSibling !== ex) ex.before(hh); }
    const bottom = $("energy-bottom-row"); if (bottom) bottom.hidden = true;
    const { ok } = liveState(L, now);
    const hp = ok ? L.house_pins : null;
    const sky = skyPosition(now), band = $("solh-sky"), scene = $("solh-scene");
    if (!scene) return;
    scene.classList.toggle("is-night", sky.night);
    $("solh-house")?.classList.toggle("is-night", sky.night);
    $("solh-rise").textContent = ct(sky.night ? sky.sunset : sky.sunrise); $("solh-rise-lbl").textContent = sky.night ? "Sunset" : "Sunrise";
    $("solh-set").textContent = ct(sky.night ? sky.sunrise : sky.sunset); $("solh-set-lbl").textContent = sky.night ? "Sunrise" : "Sunset";
    const bez = (t) => { const u = 1 - t; return [u * u * 30 + 2 * u * t * 500 + t * t * 970, u * u * 70 + 2 * u * t * -40 + t * t * 70]; };
    const [x, y] = bez(sky.t), w = band?.clientWidth || 1000, h = band?.clientHeight || 74;
    for (const id of ["solh-sun", "solh-sun-pill"]) { const n = $(id); if (n) { n.style.left = `${x / 1000 * w}px`; n.style.top = `${y / 74 * h}px`; } }
    $("solh-sun-pill")?.classList.toggle("is-right", sky.t > 0.62);
    const pts = []; for (let i = 0; i <= 40; i++) pts.push(bez(i / 40 * sky.t).map((v) => v.toFixed(1)).join(" "));
    $("solh-arc-done")?.setAttribute("d", sky.night ? "" : "M" + pts.join(" L"));
    const solar = ok && num(L.solar_kw) ? L.solar_kw : null;
    if ($("solh-sun-pill")) $("solh-sun-pill").textContent = sky.night ? `\u{1F319} Sun Down \u00b7 Solar ${solar == null ? DASH : kw(solar)}` : `\u2600 Solar ${solar == null ? DASH : kw(solar)}`;
    $("solh-house")?.classList.toggle("is-producing", solar != null && solar > 0.05);
    const grid = ok && num(L.grid_kw) ? L.grid_kw : null;
    const pw = ok ? pwKw(L) : null;
    const rawHome = ok && num(L.home_kw) ? L.home_kw : null;
    let house = hp && hp.athena_fresh && num(hp.home_kw) ? hp.home_kw : rawHome;
    setFlow("solh-f-solar", "solh-lb-solar", solar, "Solar", "Solar", "Solar");
    setFlow("solh-f-grid", "solh-lb-grid", grid, "Grid · Importing", "Grid · Exporting", "Grid", ok && L.grid_up === false ? "Offline" : (!ok ? "Offline" : ""));
    setFlow("solh-f-pw", "solh-lb-pw", pw == null ? null : pw, "Powerwall · Discharging", "Powerwall · Charging", "Powerwall", ok ? "" : "Offline");
    /* HOUSE line uses the Command pulse: house load, source to destination, never reversed by battery sign. */
    atlasHousePulse("solh-f-pw", house);
    if ($("solh-lb-pw") && ok && num(pw) && Math.abs(pw) >= 0.05) {
      const word = pw < 0 ? "Powerwall · Charging" : "Powerwall · Discharging";
      const pctTxt = num(L.battery_pct) ? `${Math.round(L.battery_pct)}% · ` : "";
      $("solh-lb-pw").innerHTML = `<small>${word}</small>${pctTxt}${kw(pw)}`;
    }
    if ($("solh-lb-house")) $("solh-lb-house").textContent = house == null ? (ok ? DASH : "Offline") : kw(house);
    const charge = ok ? L.vehicle_charge_snapshot : null;
    const athenaOn = Boolean(hp?.athena_fresh) || charge?.charging_state === "Charging";
    let athenaKw = hp?.athena_fresh && num(hp.athena_kw) ? hp.athena_kw : (athenaOn && num(charge?.charger_power) ? charge.charger_power : null);
    if (athenaOn && athenaKw != null && Number(athenaKw) > 0.1 && rawHome != null && rawHome >= Number(athenaKw) * 0.85) {
      house = Math.max(0.05, rawHome - Number(athenaKw));
    }
    const ap = $("solh-f-athena"), al = $("solh-lb-athena");
    if (ap) ap.setAttribute("class", `solh-flow solh-c-athena${athenaOn ? " is-on" : ""}`);
    if (al) {
      const athPctTxt = charge && num(charge.battery_level) ? Math.round(charge.battery_level) + "%" : DASH;
      const aKey = String(charge?.charging_state || "").toLowerCase().replace(/[\s_]/g, "");
      let athPowTxt;
      if (athenaOn && athenaKw != null && Number(athenaKw) > 0.1) athPowTxt = Number(athenaKw).toFixed(2) + " kW";
      else if (aKey === "disconnected" || aKey === "unplugged") athPowTxt = "Idle";
      else if (aKey === "complete" || aKey === "stopped" || aKey === "nopower") athPowTxt = "0.00 kW";
      else athPowTxt = athenaKw != null ? Number(athenaKw).toFixed(2) + " kW" : "0.00 kW";
      al.innerHTML = `<small>${athenaOn ? "House \u2192 Athena" : "Athena"}</small>${athPctTxt} \u00b7 ${athPowTxt}`;
      al.classList.toggle("is-idle", !athenaOn);
    }
    const pct = ok && num(L.battery_pct) ? Math.max(0, Math.min(100, L.battery_pct)) : null;
    const md = modeInfo(L, now);
    const reserve = md.cls === "storm" ? 80 : (ok && num(L.reserve_pct) ? L.reserve_pct : null);
    if ($("solh-pw-fill")) $("solh-pw-fill").style.height = `${pct ?? 0}%`;
    if ($("solh-pw-res")) { $("solh-pw-res").style.bottom = `${reserve ?? 0}%`; $("solh-pw-res").hidden = reserve == null; $("solh-pw-res").setAttribute("data-label", reserve == null ? "" : `Reserve ${Math.round(reserve)}%`); }
    if ($("solh-pw-pct")) $("solh-pw-pct").textContent = pct == null ? (ok ? DASH : "Offline") : `${pct.toFixed(1)}%`;
    if ($("solh-pw-sub")) $("solh-pw-sub").innerHTML = !ok ? DASH : pw == null ? "Flow " + DASH : Math.abs(pw) < 0.05 ? `Standby<br>Reserve ${reserve == null ? DASH : Math.round(reserve) + "%"}` : `${pw > 0 ? "Discharging" : "Charging"}<br>${kw(pw)}`;
    $("solh-g-pw")?.classList.toggle("is-offline", !ok);
    const b = L && L.bluetti, bAt = b && Date.parse(b.observed_at), bStale = !Number.isFinite(bAt) || now - bAt > 20 * 60000;
    const bLive = Boolean(b) && b.available !== false;
    const bPct = bLive && num(Number(b.battery_pct)) && b.battery_pct !== null && b.battery_pct !== "" ? Math.max(0, Math.min(100, Number(b.battery_pct))) : null;
    if ($("solh-bl-fill")) $("solh-bl-fill").style.height = `${bPct ?? 0}%`;
    if ($("solh-bl-pct")) $("solh-bl-pct").textContent = bPct == null ? (bLive ? DASH : "Offline") : `${Math.round(bPct)}%`;
    let bText = !b ? "No Reading Yet" : !bLive ? "Offline (Cloud)" : (window.AtlasBluetti ? window.AtlasBluetti.status(b) : DASH);
    const bParts = String(bText).split(" \u00b7 ");
    if ($("solh-bl-sub")) $("solh-bl-sub").innerHTML = bParts.slice(0, 2).map((s) => s.replace(/[&<>]/g, "")).join("<br>") + (bLive && bStale ? "<br>Stale" : "");
    $("solh-g-bl")?.classList.toggle("is-offline", !bLive || bStale);
    const athPct = charge && num(Number(charge.battery_level)) ? Math.max(0, Math.min(100, Number(charge.battery_level))) : null;
    if ($("solh-ath-fill")) $("solh-ath-fill").style.height = `${athPct ?? 0}%`;
    if ($("solh-ath-pct")) $("solh-ath-pct").textContent = athPct == null ? DASH : `${Math.round(athPct)}%`;
    const short = athenaShort(charge, athenaOn);
    const range = charge && num(Number(charge.battery_range)) ? `${Math.round(charge.battery_range)} mi` : null;
    const athLine2 = athenaOn && athenaKw != null ? `${Number(athenaKw).toFixed(1)} kW${range ? " \u00b7 " + range : ""}` : (range || "Read-Only");
    if ($("solh-ath-sub")) $("solh-ath-sub").innerHTML = `${esc(short)}<br>${esc(athLine2)}`;
    $("solh-g-ath")?.classList.toggle("is-offline", !charge);
    $("solh-g-ath")?.classList.toggle("is-unplugged", Boolean(charge) && /unplug/i.test(short));
    const upsPctEl = $("energy-ups-pct"), upsPower = $("energy-ups-power"), upsRt = $("energy-ups-runtime");
    let upsPct = null;
    if (upsPctEl) { const m = String(upsPctEl.textContent || "").match(/([\d.]+)/); if (m) upsPct = Math.max(0, Math.min(100, Number(m[1]))); }
    if ($("solh-ups-fill")) $("solh-ups-fill").style.height = `${upsPct ?? 0}%`;
    if ($("solh-ups-pct")) $("solh-ups-pct").textContent = upsPct == null ? DASH : `${Math.round(upsPct)}%`;
    const powerTxt = upsPower ? upsPower.textContent : DASH;
    const onBatt = /battery/i.test(String(powerTxt || ""));
    const rtTxt = upsRt && upsRt.textContent && upsRt.textContent !== DASH ? upsRt.textContent : null;
    if ($("solh-ups-sub")) $("solh-ups-sub").innerHTML = `${esc(onBatt ? "On Battery" : (powerTxt && powerTxt !== DASH ? "On AC" : DASH))}<br>${esc(rtTxt || "Runtime " + DASH)}`;
    $("solh-g-ups")?.classList.toggle("is-offline", upsPct == null);
    const m = $("solh-mode"); if (m) m.className = `solh-mode is-${md.cls}`;
    if ($("solh-mode-icon")) $("solh-mode-icon").textContent = md.icon;
    if ($("solh-mode-text")) $("solh-mode-text").textContent = md.text;
    if ($("solh-mode-sub")) $("solh-mode-sub").textContent = md.sub;
    const totals = window.AtlasEnergy?.today?.totals || null;
    if ($("solh-today-solar")) $("solh-today-solar").innerHTML = totals && num(totals.solar_kwh) ? `${totals.solar_kwh.toFixed(1)}<i>kWh</i>` : DASH;
    if ($("solh-today-note")) $("solh-today-note").textContent = `Solar Generated${totals && num(totals.self_powered_pct) ? ` \u00b7 ${Math.round(totals.self_powered_pct)}% Self-Powered` : ""}`;
    if ($("solh-tag")) $("solh-tag").textContent = !ok ? "Live Data Offline" : sky.night ? `Night \u00b7 Sunrise ${ct(sky.sunrise)}` : `Day \u00b7 ${solar != null && solar > 0.05 ? "Solar Producing" : "Solar Idle"} \u00b7 Sunset ${ct(sky.sunset)}`;
    scene.classList.toggle("is-offline", !ok);
    if (popKind) openPop(popKind);
  }

  window.AtlasSolHero = { render, modeInfo, skyPosition, liveState, openPop, closePop };
  window.addEventListener("atlas-sol-live", (e) => { live = e.detail || null; try { render(); } catch (err) { console.warn("Sol Hero:", err); } });
  window.addEventListener("atlas-energy-today", () => { try { render(); } catch (_) {} });
  window.addEventListener("resize", () => { try { render(); } catch (_) {} });
  const start = () => { try { build(); render(); } catch (err) { console.warn("Sol Hero:", err); } setInterval(() => { try { render(); } catch (_) {} }, 60000); };
  if (document.readyState === "complete") setTimeout(start, 0); else window.addEventListener("load", () => setTimeout(start, 0));
})();

/* ===== SOL HERO END ===== */
