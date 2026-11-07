/* Daedalus Command Center: read-only Atlas + CyberPower health (data from /v1/command-center). */
(function () {
  "use strict";
  const GOOD = ["healthy", "running", "resolved", "current", "online"];
  const WARN = ["degraded", "monitoring", "unknown"];
  function cls(s) { return GOOD.includes(s) ? "healthy" : WARN.includes(s) ? "degraded" : "unhealthy"; }
  function item(name, status, detail) {
    const a = document.createElement("article"); a.className = "status-item";
    const copy = document.createElement("span"); const b = document.createElement("b"); const s = document.createElement("small");
    const badge = document.createElement("span");
    b.textContent = name; s.textContent = detail || ""; badge.textContent = status || "unknown";
    badge.className = "state " + cls(status); copy.append(b, s); a.append(copy, badge); return a;
  }
  function head(text) { const h = document.createElement("p"); h.className = "empty-state"; h.style.fontWeight = "600"; h.style.margin = "0.75rem 0 0.25rem"; h.textContent = text; return h; }
  function when(iso) { if (!iso) return "never"; const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function render(d) {
    const host = document.getElementById("cc-list"); const obs = document.getElementById("cc-observed");
    if (!host) return;
    if (d.error) { host.replaceChildren(item("Command Center snapshot", "unhealthy", d.error)); return; }
    const n = [];
    const u = d.ups || {}, w = u.watcher || {}, win = u.windows || {}, al = u.alerts || {};
    n.push(head("CyberPower UPS"));
    n.push(item((u.model || "UPS") + " - " + (u.power || "unknown"), u.status, `Charge ${u.chargePercent ?? "?"}% | Runtime ~${u.runtimeMinutes ?? "?"} Min (Windows Estimate; UPS Panel Reads Lower)`));
    n.push(item("UPS watcher", w.status, `${w.processes || 0} process | last log ${when(w.lastLogWrite)}`));
    n.push(item("Alert thresholds", "current", `Phone alerts at ${al.lowPercent}% / ${al.criticalPercent}% via ${al.target || "HA"}`));
    n.push(item("Windows battery policy", win.criticalActionDC === "Shut down" ? "healthy" : "degraded", `Low ${win.lowLevelDC}% (${win.lowActionDC}) | Critical ${win.criticalLevelDC}% -> ${win.criticalActionDC}`));
    const sy = d.system || {};
    n.push(head("Atlas"));
    n.push(item("Uptime", "healthy", `${sy.uptimeHours} h since ${when(sy.lastBoot)} | CPU ${sy.cpuPercent}% | RAM ${sy.ramUsedPercent}% of ${sy.ramTotalGB} GB`));
    (d.disks || []).forEach((x) => n.push(item("Disk " + x.name.trim(), x.freePercent < 10 ? "degraded" : x.status, `${x.freeGB} GB free of ${x.sizeGB} GB (${x.freePercent}%)`)));
    (d.physicalDisks || []).forEach((x) => n.push(item("Drive " + x.name, x.status, x.media)));
    const b = d.backup || {}, e = d.dToE || {};
    n.push(item("Nightly data backup", b.status, (b.summary || []).filter((s) => /^(result|finished|total_size_gb)=/.test(s)).join(" | ")));
    n.push(item("Nightly D: to E: copy", e.status, `${e.ended || ""} ${e.files ? "| " + e.files : ""}`));
    const p = d.pendingReboot || {}, df = d.defender || {}, ev = d.events || {};
    n.push(item("Pending reboot", p.status === "healthy" || p.status === "info" ? "healthy" : "degraded", p.status === "info" ? "File cleanup at next restart (not a warning)" : (p.reasons || []).length ? p.reasons.join(", ") : "None"));
    n.push(item("Microsoft Defender", df.status, `Real-time ${df.realtime ? "on" : "off"} | signatures ${df.signatureAgeDays} d old | threats ${df.threats}`));
    n.push(item("System events", ev.status, `${ev.systemErrors24h} errors in 24 h | ${ev.unexpectedShutdowns7d} unexpected shutdowns in 7 d${(ev.topSources || []).length ? " | " + ev.topSources.join(", ") : ""}`));
    n.push(head("Services"));
    (d.services || []).forEach((x) => n.push(item(x.name, x.status, x.detail)));
    n.push(head("Containers"));
    (Array.isArray(d.containers) ? d.containers : []).forEach((x) => n.push(item(x.name, x.status, x.detail)));
    n.push(head("Home Assistant reachability"));
    (d.reachability || []).forEach((x) => n.push(item(x.name, x.status, x.detail || "")));
    host.replaceChildren(...n);
    if (obs) obs.textContent = (d.stale ? "STALE - " : "") + "Updated " + when(d.generated);
  }
  async function load() {
    try {
      const r = await fetch("/v1/command-center", { headers: { Accept: "application/json" }, cache: "no-store" });
      render(await r.json());
    } catch (err) { render({ error: "Command Center unavailable" }); }
  }
  function start() { load(); setInterval(load, 60000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
// --- 2026-10-16 ccw: wide Command Center landing view (read-only, no controls, never wakes Athena) ---
// 2026-10-16 ui: fills the viewport, larger type, Power card hosts the live house flow view (moved in by atlas.js),
// Trends (24 h charts from existing read-only endpoints), Power events, summarized recovery incidents.
// Non-ASCII characters are written as \u escapes so file encoding can never garble them again.
(function () {
  const $ = (id) => document.getElementById(id);
  const DOT = " \u00b7 ", DASH = "\u2013", DEG = "\u00b0", EN = "\u2013";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (v, d = 1) => (v === null || v === undefined || v === "" || isNaN(v) ? DASH : Number(v).toFixed(d));
  const OK = new Set(["healthy", "online", "running", "ok", "resolved", "ready", "available", "monitoring"]);
  const cls = (s) => { const x = String(s || "").toLowerCase(); return OK.has(x) ? "ok" : x === "info" ? "info" : (/degraded|warn|stale|pending|unknown/.test(x) ? "warn" : "bad"); };
  const isProblem = (s) => !["ok", "info"].includes(cls(s));
  const dot = (s) => `<i class="cw-dot ${cls(s)}"></i>`;
  const ago = (t) => { if (!t) return DASH; const s = (Date.now() - new Date(t).getTime()) / 1000; if (isNaN(s)) return DASH; if (s < 90) return `${Math.round(s)}s ago`; if (s < 5400) return `${Math.round(s / 60)}m ago`; if (s < 172800) return `${(s / 3600).toFixed(1)}h ago`; return `${Math.round(s / 86400)}d ago`; };
  const tm = (t) => { const d = new Date(t); return !t || isNaN(d) ? DASH : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
  const clock = (t) => { const d = new Date(t); return !t || isNaN(d) ? DASH : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const when = (t) => (sameDay(t, Date.now()) ? clock(t) : tm(t));
  const span = (a, b) => (!b ? `${when(a)} ${EN} now` : sameDay(a, b) ? `${when(a)}${EN}${clock(b)}` : `${tm(a)} ${EN} ${tm(b)}`);
  const dur = (sec) => { if (sec == null || isNaN(sec)) return ""; sec = Math.max(0, Math.round(sec)); if (sec < 90) return `${sec}s`; if (sec < 5400) return `${Math.round(sec / 60)} min`; if (sec < 172800) return `${(sec / 3600).toFixed(1)} h`; return `${Math.round(sec / 86400)} d`; };
  const get = async (u) => { try { const r = await fetch(u, { headers: { Accept: "application/json" }, cache: "no-store" }); return r.ok ? await r.json() : null; } catch (_) { return null; } };
  // Title Case for labels and status phrases Units (kW, kWh, mi, min, h, GB) and HTML tags are left alone.
  const UNITS = new Set(["mi", "min", "h", "s", "d", "m", "ms", "x", "vs", "e.g", "i.e"]);
  const TC = (str) => String(str ?? "").split(/(<[^>]*>|&[a-z#0-9]+;)/i).map((part, i) => (i % 2 ? part : part.replace(/\b([a-z])([a-z']*)\b/g, (w, a, b) => (UNITS.has(w) ? w : a.toUpperCase() + b)))).join("");
  window.AtlasTitleCase = TC;
  const card = (title, body, extra = "") => `<section class="cw-card ${extra}"><h3>${title}</h3><div class="cw-body">${body}</div></section>`;
  const kv = (k, v, s) => `<div class="cw-kv">${s !== undefined ? dot(s) : ""}<span>${k}</span><b>${TC(v)}</b></div>`;
  const big = (label, v, unit, sub = "", tone = "") => `<div class="cw-big ${tone}"><small>${label}</small><strong>${v}<em>${unit}</em></strong><span>${TC(sub)}</span></div>`;


  const kvLow = (k, v, st) => kv(k, v, st).replace('<div class="cw-kv">', '<div class="cw-kv" data-low="2">');

  // ---- Systems panel (dense) ----
  const norm = (x) => String(x || "").toLowerCase().replace(/^atlas-/, "").replace(/[^a-z0-9]/g, "");
  const SHORT = { "Home OS / Orchestrator (port 80)": "Home OS :80", "Home OS / Orchestrator (Port 80)": "Home OS :80", "Powerwall energy": "Powerwall Svc", "Powerwall Energy": "Powerwall Svc" };
  function systemsHtml(c, sys) {
    const ctr = new Map((c.containers || []).map((x) => [norm(x.name), x])), used = new Set();
    const chip = (name, dots, title) => `<div class="cw-chip" title="${esc(title)}">${dots}<span>${TC(esc(name))}</span></div>`;
    const chips = (c.services || []).map((s) => { const k = norm(s.name), m = ctr.get(k); if (m) used.add(k);
      return chip(SHORT[s.name] || s.name, dot(s.status) + (m ? dot(m.status) : ""), `${s.name}: ${s.status} (${s.detail || ""})${m ? ` | container ${m.name}: ${m.status} (${m.detail || ""})` : ""}`); });
    for (const [k, m] of ctr) if (!used.has(k)) chips.push(chip(m.name.replace(/^atlas-/, ""), dot(m.status), `container ${m.name}: ${m.status} (${m.detail || ""})`));
    for (const r of c.reachability || []) { const n = /tailscale/i.test(r.name) ? "HA Tailscale" : /lan/i.test(r.name) ? "HA LAN" : /portproxy/i.test(r.name) ? `Portproxy${r.detail ? " " + r.detail.replace(/\D+/g, "") : ""}` : r.name; chips.push(chip(n, dot(r.status), `${r.name}: ${r.status}${r.detail ? " (" + r.detail + ")" : ""}`)); }
    if (!(c.services || []).length && c.services_status_counts?.healthy != null) chips.push(chip(`${c.services_status_counts.healthy} Services Healthy`, dot("healthy"), "Service names were not in this snapshot."));
    const tile = (label, value, st, pct, low) => `<div class="cw-tile"${low ? ` data-low="${low}"` : ""}><small>${st !== undefined ? dot(st) : ""}${label}</small><b>${TC(value)}</b>${pct !== undefined && pct !== null && !isNaN(pct) ? `<div class="cw-meter ${pct >= 90 ? "bad" : pct >= 75 ? "warn" : "ok"}"><i data-w="${Math.round(pct)}"></i></div>` : ""}</div>`;
    const bk = (c.backup?.summary || []).reduce((a, x) => { const [k, ...r] = x.split("="); a[k] = r.join("="); return a; }, {});
    const pr = c.pendingReboot, ev = c.events || {}, df = c.defender, gpu = sys.gpu && !sys.gpu.error && sys.gpu.name ? sys.gpu : null, ol = c.ollama;
    const containers = c.containers || [], up = containers.filter((x) => !isProblem(x.status)).length;
    const ts = (c.reachability || []).map((r) => (r.name.match(/100\.\d+\.\d+\.\d+/) || [])[0]).find(Boolean);
    const ramUsed = sys.ramTotalGB && sys.ramUsedPercent != null ? (sys.ramTotalGB * sys.ramUsedPercent / 100).toFixed(1) : null;
    const tiles = [
      ...(c.disks || []).map((d) => tile(esc(d.name.trim()), d.freeGB != null ? `${d.freeGB} GB free` : (d.freePercent != null ? `${d.freePercent}% free` : DASH), d.status, d.freePercent != null ? 100 - d.freePercent : undefined)),
      tile("CPU", `${sys.cpuPercent ?? DASH}%`, sys.cpuPercent >= 90 ? "warn" : "ok", sys.cpuPercent),
      tile("RAM", `${sys.ramUsedPercent ?? DASH}%${ramUsed ? ` <em>${ramUsed}/${num(sys.ramTotalGB, 0)} GB</em>` : ""}`, sys.ramUsedPercent >= 90 ? "warn" : "ok", sys.ramUsedPercent),
      gpu ? tile("GPU", `${gpu.utilPercent ?? DASH}%${gpu.memUsedGB != null ? ` <em>${num(gpu.memUsedGB, 1)}/${num(gpu.memTotalGB, 0)} GB</em>` : ""}`, "ok", gpu.utilPercent) : "",
      tile("Uptime", `${num(sys.uptimeHours, 1)} h <em>boot ${when(sys.lastBoot)}</em>`, "ok"),
      tile("Containers", containers.length ? `${up}/${containers.length} Up` : (c.containers_status_counts ? `${c.containers_status_counts.healthy ?? DASH} healthy${c.containers_status_counts.running != null ? ` <em>${c.containers_status_counts.running} running</em>` : ""}` : DASH), containers.length ? (up === containers.length ? "ok" : "warn") : (c.containers_status_counts ? "ok" : undefined)),
      ol ? tile("Ollama", ol.error ? "Unreachable" : ol.models && ol.models.length ? esc(ol.models.map((m) => m.name).join(", ")) : "Idle (No Model Loaded)", ol.error ? "warn" : ol.status || "ok") : "",
      tile("Nightly Backup", `${esc(bk.result || c.backup?.status || DASH)} <em>${ago(bk.finished || c.backup?.updated)}${bk.total_size_gb ? DOT + bk.total_size_gb + " GB" : ""}</em>`, c.backup?.status),
      tile("D\u2192E Copy", `${ago(c.dToE?.updated)}`, c.dToE?.status),
      tile("Pending Reboot", pr ? (pr.status === "healthy" ? "No" : pr.status === "info" ? "Cleanup Only" : `Yes <em>${esc((pr.reasons || []).join(", "))}</em>`) : DASH, pr?.status),
      tile("Defender", df ? `${df.threats ?? DASH} threats${df.signatureAgeDays != null ? ` <em>sigs ${df.signatureAgeDays}d</em>` : ""}` : DASH, df?.status),
      tile("Errors 24H", `${ev.systemErrors24h ?? DASH} <em>${ev.unexpectedShutdowns7d ?? DASH} bad shutdowns 7d</em>`, ev.status),
      ts ? tile("Tailscale", ts, "ok", undefined, 2) : "",
      tile("UPS", `${esc(c.ups?.power || DASH)} <em>${c.ups?.chargePercent ?? DASH}%${DOT}~${c.ups?.runtimeMinutes ?? DASH} Min (Windows Est.)${c.ups?.loadPercent != null ? DOT + "load " + c.ups.loadPercent + "%" : ""}</em>`, c.ups?.status, undefined, 2),
    ].filter(Boolean).join("");
    return `<div class="cw-chips">${chips.join("")}</div><div class="cw-tiles">${tiles}</div>`;
  }

  // ---- Header status strip + quick controls (existing wired endpoints only; every device change asks first) ----
  let stripState = null;
  const OUTSIDE = ["light.driveway_light", "light.front_porch_left", "light.front_porch_right"];
  function lightItems() {
    const api = window.AtlasHomeControls;
    const fromApp = api ? api.lights() : [];
    return fromApp.length ? fromApp : (stripState?.he?.groups?.home_controls || []);
  }
  function renderStrip() {
    const host = $("cw-strip"); if (!host || !stripState) return;
    const { hs, he, en, c } = stripState, e = en || {}, g = he?.groups || {};
    const val = (grp, id) => ((hs?.environment?.[grp] || []).find((x) => x.id === id) || {}).value;
    const cl = hs?.climate || {}, st = (x) => String(x.state ?? "").toLowerCase();
    const items = lightItems().filter((x) => x.availability === "available" && x.controllable !== false);
    const on = items.filter((x) => st(x) === "on");
    const garage = (g.openings || []).find((x) => /garage/i.test(`${x.entity_id} ${x.name} ${x.device_class}`));
    const leaks = (g.safety || []).filter((x) => x.device_class === "moisture"), wet = leaks.filter((x) => st(x) === "on");
    const v = e.vehicle_charge_snapshot || {};
    const set = (id, html, tone) => { const n = $(id); if (!n) return; n.innerHTML = TC(html); if (tone !== undefined) n.dataset.tone = tone; };
    set("cw-s-indoor", !hs ? DASH : `${num(cl.current_temperature, 1)}${DEG}<em>${num(val("humidity", "living-room-humidity"), 0)}% RH</em>`);
    set("cw-s-hvacmode", !hs ? DASH : `${esc(String(cl.state || DASH).replace(/_/g, " "))}${cl.hvac_action ? `<em>${esc(String(cl.hvac_action).replace(/_/g, " "))}</em>` : ""}`);
    set("cw-s-outdoor", !hs ? DASH : `${num(val("outdoor", "outdoor-temperature"), 0)}${DEG}<em>AQI ${num(val("outdoor", "outdoor-aqi"), 0)}</em>`);
    set("cw-s-pw", !en ? DASH : `${num(e.battery_pct, 0)}%<em>${e.battery_kw > 0.05 ? "discharging" : e.battery_kw < -0.05 ? "charging" : "idle"}</em>`, !en ? "" : e.battery_pct < 25 ? "bad" : "");
    set("cw-s-grid", !en ? DASH : e.grid_up === false ? "DOWN" : "Up", !en ? "" : e.grid_up === false ? "bad" : "ok");
    set("cw-s-ups", `${esc(c.ups?.power || DASH)}${c.ups?.chargePercent != null && c.ups.chargePercent !== "" && Number.isFinite(Number(c.ups.chargePercent)) ? `<em>${num(c.ups.chargePercent, 0)}%</em>` : ""}`, c.ups?.status && isProblem(c.ups.status) ? "bad" : "ok");
    set("cw-s-athena", !en ? DASH : `${v.battery_level ?? DASH}%<em>${esc(athenaState(v))}</em>`);
    set("cw-s-lights", !he ? DASH : `${on.length}/${items.length}<em>${on.length ? esc(on.map((x) => (window.AtlasHomeControls ? window.AtlasHomeControls.name(x) : x.name)).join(", ")) : "All Off"}</em>`);
    set("cw-s-garage", !he ? DASH : garage ? esc(String(garage.state || DASH)) : DASH, !he ? "" : garage && st(garage) !== "closed" ? "warn" : "ok");
    set("cw-s-leak", !he ? DASH : wet.length ? `WET<em>${esc(wet.map((x) => x.name).join(", "))}</em>` : `Dry<em>${leaks.length} sensors</em>`, !he ? "" : wet.length ? "bad" : "ok");
    const outside = items.filter((x) => OUTSIDE.includes(x.entity_id));
    const b1 = $("cw-l-outon"), b2 = $("cw-l-outoff"), b3 = $("cw-l-dark");
    if (b1) b1.disabled = !outside.length || outside.every((x) => st(x) === "on");
    if (b2) b2.disabled = !outside.length || outside.every((x) => st(x) === "off");
    if (b3) b3.disabled = !items.length || items.every((x) => st(x) === "off");
  }
  async function lightAction(kind, button) {
    const api = window.AtlasHomeControls; if (!api) return;
    const all = lightItems().filter((x) => x.availability === "available" && x.controllable !== false);
    const items = kind === "dark" ? all : all.filter((x) => OUTSIDE.includes(x.entity_id));
    const enabled = kind === "on";
    if (!items.length) return;
    // Non-critical: act immediately, then confirm with a brief toast.
    const label = kind === "dark" ? "All Lights Off" : `Outside Lights ${enabled ? "On" : "Off"}`;
    const toast = window.AtlasToast || (() => {});
    try { const ok = await api.setAll(items, enabled, button); toast(ok === false ? `${label}: Not Confirmed` : label, ok === false ? "bad" : "ok"); } catch (_e) { toast(`${label}: Not Confirmed`, "bad"); }
    setTimeout(() => { load(); }, 1500);
  }
  function bindStrip() {
    const map = { "cw-l-outon": "on", "cw-l-outoff": "off", "cw-l-dark": "dark" };
    for (const [id, kind] of Object.entries(map)) { const b = $(id); if (b && !b.dataset.bound) { b.dataset.bound = "1"; b.addEventListener("click", () => lightAction(kind, b)); } }
  }

  // ---- No internal scrolling: shrink a card's type, then drop low-priority rows, until it fits ----
  const overflowing = (n) => n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 2;
  function fitCard(card) {
    card.style.fontSize = "";
    card.querySelectorAll("[data-low]").forEach((n) => n.classList.remove("cw-drop"));
    if (getComputedStyle(card).overflow !== "hidden") return;
    const body = card.querySelector(".cw-body") || card;
    const over = () => overflowing(card) || overflowing(body) || [...card.querySelectorAll(".cw-chart")].some(overflowing);
    let scale = 1;
    while (over() && scale > 0.78) { scale = Math.round((scale - 0.04) * 100) / 100; card.style.fontSize = scale + "em"; }
    for (const level of ["1", "2"]) { if (!over()) break; card.querySelectorAll(`[data-low="${level}"]`).forEach((n) => n.classList.add("cw-drop")); }
    while (over() && scale > 0.66) { scale = Math.round((scale - 0.04) * 100) / 100; card.style.fontSize = scale + "em"; }
    // Last resort for lists: hide trailing rows rather than scroll.
    const lists = [...card.querySelectorAll(".cw-log, .cw-events, .cw-tasks, .cw-warn")];
    for (const ul of lists) { const rows = [...ul.children]; while (over() && rows.length > 1) rows.pop().classList.add("cw-drop"); }
  }
  function fitCards() {
    const wrap = document.querySelector("#panel-command .cw-wrap"); if (!wrap || !wrap.offsetParent) return;
    wrap.querySelectorAll(".cw-card").forEach(fitCard);
    unclutterPins(wrap);
  }
  // House photo labels: if two labels overlap, first drop their sub-lines, then nudge the later one down.
  function unclutterPins(wrap) {
    const panel = wrap.querySelector(".cw-house-slot .energy-house-panel"); if (!panel) return;
    const pins = [...panel.querySelectorAll(".energy-pin")].filter((p) => p.getClientRects().length);
    pins.forEach((p) => { p.classList.remove("pin-tight"); p.style.removeProperty("--y"); });
    const hit = (a, b) => { const r = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return !(r.right + 3 <= q.left || q.right + 3 <= r.left || r.bottom + 3 <= q.top || q.bottom + 3 <= r.top); };
    const pr = panel.getBoundingClientRect();
    pins.forEach((p) => { p.style.marginLeft = ""; p.style.marginTop = ""; const r = p.getBoundingClientRect(); const dx = r.right > pr.right - 2 ? pr.right - 2 - r.right : r.left < pr.left + 2 ? pr.left + 2 - r.left : 0; const dy = r.top < pr.top + 2 ? pr.top + 2 - r.top : 0; if (dx) p.style.marginLeft = dx + "px"; if (dy) p.style.marginTop = dy + "px"; });
    const H = panel.getBoundingClientRect().height || 1;
    for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
      if (!hit(pins[i], pins[j])) continue;
      pins[i].classList.add("pin-tight"); pins[j].classList.add("pin-tight");
      for (let n = 0; n < 12 && hit(pins[i], pins[j]); n++) {
        const y = parseFloat(getComputedStyle(pins[j]).getPropertyValue("--y")) || 50;
        if (y >= 94) break; pins[j].style.setProperty("--y", Math.min(94, y + (400 / H)) + "%");
      }
    }
  }
  let fitTimer = 0;
  window.addEventListener("resize", () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitCards, 150); });
  window.AtlasCommandFit = fitCards;

  // ---- Athena wording (cached readings only; Atlas never wakes the car) ----
  const CHARGE_WORDS = { disconnected: "Unplugged", stopped: "Plugged in, idle", nopower: "Plugged in, idle", complete: "Plugged in, charge complete", charging: "Charging", starting: "Starting" };
  const skippedStatus = (s) => /asleep|offline|skipped/i.test(String(s || ""));
  const readAt = (v) => v.last_read_at || v.checked_at || v.timestamp || null;
  // Fresh = the last successful read (last_read_at, else checked_at) is under 35 minutes old; collection_status is not used.
  function athenaFresh(v) { const at = readAt(v); return Boolean(at) && Date.now() - new Date(at).getTime() < 35 * 60000; }
  // Plugged-in idle wording uses the Charge on Solar "charge on any source" floor when Atlas reports one, else 40%.
  const solarFloor = (v) => { const f = Number(v.charge_on_solar_floor_pct ?? v.solar_charge_floor_pct ?? window.AtlasChargeOnSolarFloor); return Number.isFinite(f) && f > 0 ? f : 40; };
  function athenaLabel(v) {
    const key = String(v.charging_state || "").toLowerCase().replace(/[\s_]/g, "");
    const level = Number(v.battery_level), limit = Number(v.charge_limit_soc), floor = solarFloor(v);
    if (key === "complete") return { text: "Plugged in. Charge complete.", tone: "" };
    if (key === "stopped" || key === "nopower") {
      if (Number.isFinite(level) && Number.isFinite(limit) && level >= limit) return { text: "Plugged in. Charge complete.", tone: "" };
      if (Number.isFinite(level) && level < floor) return { text: `Plugged in. Idle. Below ${floor}% floor`, tone: "warn" };
      if (Number.isFinite(level)) return { text: "Plugged in. Idle. Waiting for solar.", tone: "" };
      return { text: "Plugged in, idle", tone: "" };
    }
    return { text: CHARGE_WORDS[key] || v.charging_state || "Unknown", tone: "" };
  }
  function athenaState(v) {
    const label = athenaLabel(v).text, at = readAt(v);
    return athenaFresh(v) || !at ? label : `${label.replace(/\.$/, "")} at last check (${when(at)})`;
  }
  const athenaTone = (v) => athenaLabel(v).tone;
  const carState = (s) => { const x = String(s || "").toLowerCase(); return !x ? DASH : x === "offline" ? "asleep / unreachable" : x === "asleep" ? "asleep" : x === "online" ? "awake" : esc(s); };
  const checkStatus = (s) => { const x = String(s || "").trim().toLowerCase(); if (!x) return DASH;
    if (/^asleep/.test(x) || x === "offline") return "car asleep \u2014 skipped"; if (/^offline/.test(x)) return "car offline \u2014 skipped";
    if (/^read ok$|^updated$/.test(x)) return "read OK"; if (/^online - waiting/.test(x)) return "awake, waiting for next read";
    if (/read cap/.test(x)) return "monthly read cap reached \u2014 skipped"; if (/408/.test(x)) return "car unreachable (408) \u2014 skipped";
    return esc(String(s).replace(/\s+-\s+skipped$/i, " \u2014 skipped")); };
  function athenaCheck(v) {
    const last = v.last_state_check_at || v.last_check_at || v.checked_at, next = v.next_state_check_at || v.next_check_at;
    let mins = v.update_interval_minutes;
    if (v.last_state_check_at && v.next_state_check_at) mins = Math.round((new Date(v.next_state_check_at) - new Date(v.last_state_check_at)) / 60000);
    return `${mins ? `every ${mins} min, no wake` : "no wake"}${DOT}last ${clock(last)}${DOT}next ${clock(next)}`;
  }
  window.AtlasAthenaWords = { athenaState, athenaTone, athenaFresh, checkStatus, carState };

  // ---- Grafana-style 24 h line charts (SVG lines + HTML labels) ----
  function chart(title, unit, series, opts = {}) {
    const all = series.flatMap((s) => s.points.map((p) => p.v)).filter((v) => Number.isFinite(v));
    if (!all.length) return `<div class="cw-chart"><header><b>${title}</b><span>No Data</span></header></div>`;
    const now = Date.now(), t0 = now - 24 * 3600000;
    let lo = Math.min(...all), hi = Math.max(...all);
    if (opts.min !== undefined) lo = Math.min(lo, opts.min); if (opts.max !== undefined) hi = Math.max(hi, opts.max);
    if (hi - lo < (opts.span || 1)) { const m = (hi + lo) / 2; lo = m - (opts.span || 1) / 2; hi = m + (opts.span || 1) / 2; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const X = (t) => ((t - t0) / (now - t0)) * 100, Y = (v) => 40 - ((v - lo) / (hi - lo)) * 40;
    const grid = [0, 1, 2, 3, 4].map((i) => `<line x1="0" x2="100" y1="${i * 10}" y2="${i * 10}"/>`).join("") + [6, 12, 18].map((h) => `<line class="v" y1="0" y2="40" x1="${X(now - h * 3600000)}" x2="${X(now - h * 3600000)}"/>`).join("");
    const zero = lo < 0 && hi > 0 ? `<line class="zero" x1="0" x2="100" y1="${Y(0)}" y2="${Y(0)}"/>` : "";
    const lines = series.map((s) => {
      const ok = s.points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((p, q) => p.t - q.t);
      const seed = ok.filter((p) => p.t < t0).pop(), win = ok.filter((p) => p.t >= t0 && p.t <= now);
      const pts = [...(seed ? [{ t: t0, v: seed.v }] : []), ...win]; if (!pts.length) return "";
      pts.push({ t: now, v: pts[pts.length - 1].v });
      const xy = []; pts.forEach((p, i) => { if (i) xy.push(`${X(p.t).toFixed(2)},${Y(pts[i - 1].v).toFixed(2)}`); xy.push(`${X(p.t).toFixed(2)},${Y(p.v).toFixed(2)}`); });
      return `<polyline data-c="${s.color}" points="${xy.join(" ")}"/>`;
    }).join("");
    const legend = series.map((s) => { const v = s.points.filter((p) => Number.isFinite(p.v)); if (!v.length) return ""; const vals = v.map((p) => p.v); return `<span data-c="${s.color}"><i></i>${TC(esc(s.label))} <b>${num(vals[vals.length - 1], opts.d ?? 1)}${unit}</b> <small>Min ${num(Math.min(...vals), opts.d ?? 1)} Max ${num(Math.max(...vals), opts.d ?? 1)}</small></span>`; }).join("");
    const ticks = `<div class="cw-ticks"><span>${num(hi - pad, 0)}${unit}</span><span>${num(lo + pad, 0)}${unit}</span></div><div class="cw-xt"><span>-24h</span><span>-18h</span><span>-12h</span><span>-6h</span><span>now</span></div>`;
    return `<div class="cw-chart"><header><b>${title}</b></header><div class="cw-plot"><svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><g class="g">${grid}${zero}</g>${lines}</svg>${ticks}</div><div class="cw-legend">${legend}</div></div>`;
  }
  const SENTINEL = [3276.7, 32767, -3276.8, -32768, 65535, 6553.5];
  const saneEnv = (id, v) => Number.isFinite(v) && !SENTINEL.includes(v) && (/temp/.test(id) ? v >= -40 && v <= 140 : /humid/.test(id) ? v >= 0 && v <= 100 : true);
  const envSeries = (env, id, label, color) => { const s = (env?.series || []).find((x) => x.id === id); return { label, color, points: (s?.points || []).map((p) => ({ t: new Date(p.at).getTime(), v: Number(p.value) })).filter((p) => saneEnv(id, p.v)) }; };
  const pwSeries = (hist, field, label, color, f = (v) => v) => ({ label, color, points: (hist?.points || []).map((p) => ({ t: new Date(p.at).getTime(), v: p[field] == null ? NaN : f(Number(p[field])) })) });
  let trendsAt = 0, trendsHtml = "";
  // 2026-11-03 bluetti-ui3: UPS (collector history, change points) and Athena (saved periodic Basic snapshots; no new Tesla polling).
  // Keep the last 24 h plus the latest reading before the window so the step line starts at the real prior value.
  const win24 = (pts) => { const t0 = Date.now() - 24 * 3600000, ok = pts.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t); const seed = ok.filter((p) => p.t < t0).pop(); return [...(seed ? [seed] : []), ...ok.filter((p) => p.t >= t0)]; };
  const upsSeries = (cc) => ({ label: "UPS", color: "#ff4fd8", points: win24((cc?.ups?.history || []).map((p) => ({ t: new Date(p.at).getTime(), v: p.pct == null ? NaN : Number(p.pct) }))) });
  const athenaSeries = (en) => ({ label: "Athena", color: "#4da3ff", points: win24((en?.vehicle_charge_snapshot?.observations || []).map((o) => ({ t: new Date(o.observed_at).getTime(), v: o.battery_level == null ? NaN : Number(o.battery_level) }))) });
  async function trends(ccP, enP) {
    if (trendsHtml && Date.now() - trendsAt < 10 * 60000) return trendsHtml;
    const [env, hist, bl, ccT, enT] = await Promise.all([get("/v1/home/environment/history"), get("/v1/energy/history?range=day"), get("/v1/energy/bluetti?range=day"), ccP || get("/v1/command-center"), enP || get("/v1/energy/status")]); // 2026-11-03 bluetti-ui: + Bluetti trend
    trendsHtml = `<div class="cw-charts">
      ${chart("Temperature", DEG, [envSeries(env, "living-room-temperature", "Living room", "#73bf69"), envSeries(env, "primary-bedroom-temperature", "Bedroom", "#8ab8ff"), envSeries(env, "outdoor-temperature", "Outdoor", "#ff9830")], { span: 6 })}
      ${chart("Humidity", "%", [envSeries(env, "living-room-humidity", "Living room", "#73bf69"), envSeries(env, "air-monitor-humidity", "Air monitor", "#b877d9"), envSeries(env, "east-hallway-humidity", "Hallway", "#5794f2")], { span: 10, d: 0 })}
      ${chart("Power", " kW", [pwSeries(hist, "solar_kw", "Solar", "#fade2a"), pwSeries(hist, "home_kw", "Home", "#5794f2"), pwSeries(hist, "grid_kw", "Grid", "#f2495c")], { span: 2, d: 2 })}
      ${chart("Batteries", "%", [pwSeries(hist, "battery_pct", "Powerwall", "#73bf69"), pwSeries(bl, "battery_pct", "Bluetti", "#ff8c1a"), upsSeries(ccT), athenaSeries(enT)], { min: 0, max: 100, d: 0 })}</div>`;
    trendsAt = Date.now();
    return trendsHtml;
  }

  // ---- recent log events: collapse repeats, translate recovery incidents to plain words ----
  function logLines(items) {
    const out = [];
    for (const a of items) {
      if (a.source === "recovery" && a.label) {
        const len = a.end ? dur((new Date(a.end) - new Date(a.time)) / 1000) : "";
        const text = a.kind === "maintenance" ? `${a.label} planned maintenance restart (${span(a.time, a.end)}), back in ${len}` : a.kind === "restart" ? `${a.label} restarted (${span(a.time, a.end)}), back in ${len}`
          : a.kind === "ongoing" ? `${a.label} is down since ${when(a.time)}${a.attempts ? `, ${a.attempts} restart attempt${a.attempts > 1 ? "s" : ""} so far` : ""}`
          : `${a.label} down ${span(a.time, a.end)}${len ? ` (${len})` : ""}, auto-recovered${a.attempts ? ` after ${a.attempts} restart attempt${a.attempts > 1 ? "s" : ""}` : ""}`;
        out.push({ time: a.time, source: "recovery", text, cls: a.kind === "ongoing" ? "bad" : a.kind === "maintenance" ? "maint" : "" });
        continue;
      }
      const text = String(a.text || "").replace(/^ALERT sent:\s*/, "");
      const prev = out[out.length - 1];
      if (prev && prev.source === a.source && prev.raw === text) { prev.count++; prev.first = a.time; continue; }
      out.push({ time: a.time, first: a.time, source: a.source, raw: text, text, count: 1 });
    }
    return out.map((x) => `<li class="${x.cls || ""}"><time>${x.count > 1 ? span(x.first, x.time) : when(x.time)}</time><em>${esc(x.source)}</em>${esc(x.text)}${x.count > 1 ? ` <b class="cw-count">\u00d7${x.count}</b>` : ""}</li>`).join("");
  }
  function powerEvents(list) {
    if (!Array.isArray(list)) return `<p class="cw-empty">Waiting For The Collector</p>`;
    const since = Date.now() - 14 * 86400000;
    const rows = list.filter((e) => e.kind !== "unavailable" && !(new Date(e.start).getTime() < since));
    const note = list.some((e) => e.kind === "unavailable") ? `<p class="cw-note">Powerwall grid history unavailable right now</p>` : "";
    if (!rows.length) return `<p class="cw-okline">No Power Events In The Last 14 Days</p>${note}`;
    const icon = { powerwall: "\u26a1", ups: "\ud83d\udd0b", windows: "\ud83d\udda5" };
    return `<ul class="cw-events">${rows.map((e) => `<li class="${e.source}"><span class="ico">${icon[e.source] || ""}</span><div><b>${esc(e.text.replace(/ \(\d+ samples off-grid\)/, ""))}</b><small>${e.end ? span(e.start, e.end) : tm(e.start)}${e.durationSec != null ? `${DOT}${dur(e.durationSec)}` : ""}</small></div></li>`).join("")}</ul>${note}<p class="cw-note" data-low="1">Last 14 days${DOT}Powerwall grid status, UPS log, Windows unexpected shutdowns</p>`;
  }

  let busy = false;
  async function load() {
    const root = $("cw-root"); if (!root || busy) return; busy = true;
    const ccP = get("/v1/command-center"), enP = get("/v1/energy/status"); // 2026-11-03 bluetti-ui3: shared with trends() (UPS + Athena lines)
    const [cc, en, hs, he, as, tr] = await Promise.all([ccP, enP, get("/v1/home/status"), get("/v1/home/entities"), get("/v1/atlas/status"), trends(ccP, enP)]);
    busy = false;
    const warn = [];
    const c = cc || {}, e = en || {}, sys = c.system || {}, ups = c.ups || {}, win = ups.windows || {};
    (c.services || []).forEach((s) => isProblem(s.status) && warn.push(`Service: ${s.name}`));
    (c.containers || []).forEach((s) => isProblem(s.status) && warn.push(`Container: ${s.name} (${s.detail})`));
    (c.disks || []).forEach((d) => isProblem(d.status) && warn.push(`Disk ${d.name}`));
    ["backup", "dToE", "defender", "pendingReboot", "events"].forEach((k) => c[k] && isProblem(c[k].status) && warn.push(`${k === "dToE" ? "D\u2192E copy" : k === "pendingReboot" ? "Pending reboot (" + (c[k].reasons || []).join(", ") + ")" : k}: ${c[k].status}`));
    if (ups.status && isProblem(ups.status)) warn.push(`UPS: ${ups.power}`);
    (c.reachability || []).forEach((r) => isProblem(r.status) && warn.push(`Reachability: ${r.name}`));
    (as?.failures || []).forEach((f) => warn.push(`Atlas: ${typeof f === "string" ? f : (f.id || f.name || JSON.stringify(f))}`));
    if (!cc) warn.push("Command Center snapshot unavailable"); else if (c.stale) warn.push(`Snapshot stale (${c.snapshot_age_seconds}s)`);
    if (!hs) warn.push("Home status was not in this snapshot");
    if (!he) warn.push("Home entities were not in this snapshot");
    if (!en) warn.push("Energy status was not in this snapshot");
    const info = [];
    if (c.pendingReboot?.status === "info") info.push("Windows File Cleanup At Next Restart (Not A Warning)");

    // header
    const out = (hs?.environment?.outdoor || []).reduce((a, x) => (a[x.id] = x.value, a), {});
    $("cw-status").className = `cw-overall ${warn.length ? "warn" : "ok"}`;
    $("cw-status").textContent = warn.length ? `\u26a0 ${warn.length} warning${warn.length > 1 ? "s" : ""}` : "\u2714 All Systems OK";
    $("cw-clock").textContent = new Date().toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    $("cw-weather").textContent = out["outdoor-temperature"] !== undefined ? `${num(out["outdoor-temperature"], 0)}${DEG}F${DOT}${num(out["outdoor-humidity"], 0)}% RH${DOT}AQI ${num(out["outdoor-aqi"], 0)}` : `Weather ${DASH}`;
    $("cw-uptime").textContent = sys.uptimeHours !== undefined ? `Atlas up ${num(sys.uptimeHours, 1)} h${DOT}boot ${tm(sys.lastBoot)}` : `Uptime ${DASH}`;
    $("cw-updated").textContent = c._fixture?.captured_at_ct
      ? `Captured historical snapshot ${c._fixture.captured_at_ct} · not live`
      : `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
    stripState = { hs, he, en, c };
    renderStrip();

    // power tiles (the live house flow view above them is the Energy tab's own node)
    const pins = e.house_pins || {}, t = e.today || {};
    const battKw = !en ? null : typeof e.battery_kw === "number" ? e.battery_kw : null;
    const battFlow = !en ? DASH : battKw !== null ? (battKw > 0.05 ? `Discharging ${num(battKw, 1)} kW` : battKw < -0.05 ? `Charging ${num(-battKw, 1)} kW` : "Idle") : (pins.battery_discharge_kw > 0.01 ? `Discharging ${num(pins.battery_discharge_kw, 1)} kW` : pins.battery_charge_kw > 0.01 ? `Charging ${num(pins.battery_charge_kw, 1)} kW` : "Idle");
    const gridTxt = e.grid_up === false ? "GRID DOWN" : e.grid_kw > 0.05 ? "importing" : e.grid_kw < -0.05 ? "exporting" : "idle";
    const tiles = $("cw-power-tiles");
    const modeName = (m) => ({ self_consumption: "Self-Powered", autonomous: "Time-Based", backup: "Backup Only" })[String(m || "")] || String(m || DASH).replace(/_/g, " ");
    if (tiles) tiles.innerHTML = en ? `<div class="cw-bigrow">${big("Solar", num(e.solar_kw, 2), "kW", `Today ${num(t.solar_kwh, 1)} kWh`, "solar")}${big("Home", num(e.home_kw, 2), "kW", `Today ${num(t.home_kwh, 1)} kWh`, "home")}${big("Grid", num(Math.abs(e.grid_kw), 2), "kW", gridTxt, e.grid_up === false ? "bad" : "grid")}${big("Powerwall", num(e.battery_pct, 0), "%", battFlow, "pw")}</div>
      <div class="cw-grid3">${kv("Grid In / Out", `${num(t.import_kwh, 1)} / ${num(t.export_kwh, 1)} kWh`)}${kv("Solar Value", `$${num(t.solar_savings, 2)}`)}${kv("Bill Estimate", e.monthly ? `$${num(e.monthly.estimated_bill, 0)}${DOT}${e.monthly.days_remaining}d Left` : DASH)}${kv("Reserve / Mode", `${num(e.reserve_pct, 0)}%${DOT}${esc(modeName(e.mode))}`)}${kv("Grid", e.grid_up === false ? "DOWN" : "Up", e.grid_up === false ? "bad" : "ok")}${kv("Polled", ago(e.polled_at))}</div>` : `<p class="cw-empty">Energy API Unavailable</p>`;

    // batteries
    const v = e.vehicle_charge_snapshot || {}, veh = (e.tesla_vehicles?.vehicles || [])[0] || {};
    const batt = `<div class="cw-bars">
      ${bar("Powerwall", e.battery_pct, `${battFlow}${DOT}reserve ${num(e.reserve_pct, 0)}%`)}
      ${bar("UPS", ups.chargePercent, `${esc(ups.power || "unknown")}${DOT}~${ups.runtimeMinutes ?? DASH} Min Runtime (Windows Estimate; UPS Panel Reads Lower)`)} <!-- t615u: Win32_Battery EstimatedRunTime is a Windows estimate, not the UPS reading -->
      ${bar("Athena", en ? v.battery_level : null, en ? `${num(v.battery_range, 0)} mi${DOT}${esc(athenaState(v))}` : DASH)}
      ${bluettiBar(e.bluetti)}</div> <!-- 2026-11-03 bluetti-ui -->
      ${kv("Windows UPS Policy", `warn ${win.lowLevelDC ?? DASH}%${DOT}${esc(win.criticalActionDC || DASH)} at ${win.criticalLevelDC ?? DASH}%`, win.criticalActionDC === "Shut down" ? "ok" : "warn")}
      ${kvLow("UPS Watcher", `${ups.watcher?.processes ?? 0} running${DOT}${ago(ups.watcher?.lastLogWrite)}`, ups.watcher?.status)}`;

    // athena (cached, read-only)
    const charging = v.charging_state === "Charging" && athenaFresh(v);
    const reads = v.reads_this_month != null ? `${DOT}${v.reads_this_month}${v.read_cap ? "/" + v.read_cap : ""} reads this month${v.read_cap && v.reads_this_month >= v.read_cap ? " (cap reached, reads paused)" : ""}` : ""; // 2026-10-30 tesla-usage-fix
    const ath = en ? `<div class="cw-bigrow two">${big("Battery", v.battery_level ?? DASH, "%", `limit ${v.charge_limit_soc ?? DASH}%`, "pw")}${big("Range", num(v.battery_range, 0), "mi", charging ? `charging ${num(v.charger_power, 1)} kW` : "")}</div>
      <p class="cw-state ${athenaTone(v)}">${TC(esc(athenaState(v)))}</p>
      ${kv("Athena Check", athenaCheck(v))}
      ${kv("Last Result", `${checkStatus(v.collection_status)}${DOT}reading ${ago(readAt(v))}${reads}`)}
      ${kv("Car State", carState(v.state || v.vehicle_state || veh.state))}
      ${kvLow("Last Session Added", `${num(v.charge_energy_added, 1)} kWh${DOT}${v.charge_miles_added_rated ?? DASH} mi`)}
      ${kvLow("Plug-In Alert", e.athena_alert ? (e.athena_alert.active ? esc(e.athena_alert.message) : `off (\u2265${e.athena_alert.threshold_pct}%)`) : DASH, e.athena_alert?.active ? "warn" : "ok")}
      <p class="cw-note" data-low="1">Cached readings only${DOT}commands ${e.tesla_vehicles?.commands_enabled ? "ENABLED" : "disabled"}${DOT}never wakes the car</p>` : `<p class="cw-empty">Energy API Unavailable</p>`;

    // systems: merged service+container chips and a dense multi-column stat grid
    const systems = systemsHtml(c, sys);

    // home
    const g = he?.groups || {}, st = (x) => String(x.state ?? "").toLowerCase();
    const lights = (g.home_controls || []).filter((x) => x.domain === "light"), lon = lights.filter((x) => st(x) === "on");
    const leaks = (g.safety || []).filter((x) => x.device_class === "moisture"), wet = leaks.filter((x) => st(x) === "on");
    const opens = g.openings || [];
    const cl = hs?.climate || {};
    const openNow = opens.filter((x) => /open|^on$/i.test(String(x.state)));
    const home = !hs && !he ? `<p class="cw-empty">Home status and entities were not in this snapshot</p>` : `<div class="cw-bigrow two">${big("Indoor", num(cl.current_temperature, 1), `${DEG}F`, `${esc(cl.state || DASH)} / ${esc(cl.hvac_action || DASH)}${cl.target_temperature ? " \u2192 " + cl.target_temperature + DEG : ""}`)}${big("Lights On", lon.length, ` / ${lights.length}`, lon.length ? lon.map((x) => esc(x.name)).join(", ") : "All Off")}</div>
      ${kv("Leak Sensors", wet.length ? `WET: ${wet.map((x) => esc(x.name)).join(", ")}` : `${leaks.length} Dry`, wet.length ? "bad" : "ok")}
      ${kv("Doors & Openings", openNow.length ? `${openNow.length} open: ${openNow.map((x) => esc(x.name)).join(", ")}` : `${opens.length} Closed`, openNow.length ? "warn" : "ok")}
      ${kv("Home Assistant", he ? `${he.summary?.available}/${he.summary?.entities} entities available` : "unreachable", he ? (he.summary?.unavailable ? "warn" : "ok") : "bad")}
      ${kv("Indoor AQI", (hs?.environment?.air_quality || []).filter((x) => x.id === "indoor-aqi").map((x) => num(x.value, 0)).join("") || DASH)}
      <p class="cw-note" data-low="1">Ring status only${DOT}no camera feeds</p>`;

    // alerts
    const nowD = new Date(), nxt = (h) => { const d = new Date(nowD); d.setHours(h, 0, 0, 0); if (d <= nowD) d.setDate(d.getDate() + 1); return d.toISOString(); };
    const tasks = [...(c.nextTasks || []), { name: "Atlas-Nightly-Data-Backup (SYSTEM)", next: nxt(1) }, { name: "Atlas-Nightly-D-to-E (SYSTEM)", next: nxt(2) }].sort((a, b) => new Date(a.next) - new Date(b.next)).slice(0, 4);
    const alerts = `<h4>Current Warnings</h4>${warn.length ? `<ul class="cw-warn">${warn.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : `<p class="cw-okline">No Active Warnings</p>`}${info.length ? `<ul class="cw-info">${info.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      <h4>Recent Log Events</h4><ul class="cw-log">${logLines(c.recentAlerts || []) || "<li>None</li>"}</ul>
      <h4 data-low="1">Next Scheduled</h4><ul class="cw-tasks" data-low="1">${tasks.map((x) => `<li><time>${when(x.next)}</time>${esc(x.name.replace(/ - Current User$/, ""))}</li>`).join("")}</ul>`;

    root.innerHTML = `${card("\ud83d\udd0b Batteries", batt, "cw-batt")}${card("\ud83d\ude97 Athena", ath, "cw-athena")}${card("\ud83d\udea8 Alerts", alerts, "cw-alertcard")}${card("\ud83d\udcc8 Trends \u00b7 24 h", tr, "cw-trends")}${card("\u26a1 Power Events", powerEvents(c.powerEvents), "cw-events-card")}${card("\ud83d\udda5 Systems", systems, "cw-systems")}${card("\ud83c\udfe0 Home", home, "cw-home")}`;
    applyStyles(root);
    applyStyles($("cw-power-tiles") || root);
    fitCards();
  }
  // CSP forbids inline style attributes, so sizes/colours are applied through the CSSOM.
  function applyStyles(scope) { scope.querySelectorAll("[data-w]").forEach((n) => { n.style.width = Math.max(0, Math.min(100, Number(n.dataset.w) || 0)) + "%"; }); scope.querySelectorAll("[data-c]").forEach((n) => n.style.setProperty("--c", n.dataset.c)); }
  function bar(label, pct, sub) { const p = Number(pct); const ok = pct !== null && pct !== undefined && !isNaN(p); const c = !ok ? "" : p < 25 ? "bad" : p < 50 ? "warn" : "ok"; return `<div class="cw-bar"><div class="cw-barhead"><span>${label}</span><b>${ok ? Math.round(p) + "%" : DASH}</b></div><div class="cw-meter ${c}"><i data-w="${ok ? p : 0}"></i></div><small>${TC(sub)}</small></div>`; }
  // 2026-11-03 bluetti-ui: Bluetti portable battery row. Read-only, cloud data via Home Assistant. Words come from energy-ui.js (AtlasBluetti).
  function bluettiBar(b) { const words = window.AtlasBluetti ? window.AtlasBluetti.status(b) : (b ? (b.available === false ? "Offline (Cloud)" : "Reading Available") : "No Reading Yet"); return bar("Bluetti", b ? b.battery_pct : null, esc(words)).replace('class="cw-bar"', 'class="cw-bar cw-bar-bluetti"'); }
  const visible = () => { const p = $("panel-command"); return p && !p.hidden && !document.hidden; };
  window.AtlasCommandWide = { load };
  document.addEventListener("DOMContentLoaded", () => { bindStrip(); if (visible()) load(); });
  bindStrip();
  window.addEventListener("hashchange", () => setTimeout(() => visible() && load(), 50));
  document.addEventListener("visibilitychange", () => visible() && load());
  setInterval(() => visible() && load(), 45000);
  setTimeout(() => visible() && load(), 400);
  const panel = $("panel-command"); if (panel) new MutationObserver(() => visible() && load()).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
})();
