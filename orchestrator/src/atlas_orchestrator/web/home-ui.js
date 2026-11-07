/* ===== HOME UPGRADE START (2026-11-05 home-page-upgrade) ===== */
/* Live wiring for the approved Home layout in index.html. Same endpoints atlas.js already uses.
   Lights are display-only. HVAC keeps existing controls. No new data sources. */
(() => {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const $ = (id) => document.getElementById(id);
  const DASH = "\u2014";
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const kw = (v) => (num(v) ? `${Math.abs(v).toFixed(2)} kW` : DASH);
  const PW_KWH = 13.5;
  const STALE_S = 300;
  const ct = (ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  let live = null;
  let cc = null;

  function sunTimes(when) {
    if (typeof window.atlasSunTimes === "function") {
      try { return window.atlasSunTimes(when); } catch (_) {}
    }
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
    if (window.AtlasSolHero && typeof window.AtlasSolHero.skyPosition === "function") {
      try { return window.AtlasSolHero.skyPosition(now); } catch (_) {}
    }
    const today = sunTimes(new Date(now));
    if (now >= today.sunrise && now <= today.sunset) return { night: false, t: (now - today.sunrise) / (today.sunset - today.sunrise), sunrise: today.sunrise, sunset: today.sunset };
    const day = 86400000;
    const start = now > today.sunset ? today.sunset : sunTimes(new Date(now - day)).sunset;
    const end = now > today.sunset ? sunTimes(new Date(now + day)).sunrise : today.sunrise;
    return { night: true, t: Math.max(0, Math.min(1, (now - start) / (end - start))), sunrise: end, sunset: start };
  }
  function liveState(L, now = Date.now()) {
    if (window.AtlasSolHero && typeof window.AtlasSolHero.liveState === "function") {
      try { return window.AtlasSolHero.liveState(L, now); } catch (_) {}
    }
    const age = L && L.polled_at ? (now - Date.parse(L.polled_at)) / 1000 : null;
    const ok = Boolean(L) && L.status === "healthy" && age != null && Number.isFinite(age) && age <= STALE_S;
    return { ok, age };
  }
  function modeInfo(L, now = Date.now()) {
    if (window.AtlasSolHero && typeof window.AtlasSolHero.modeInfo === "function") {
      try {
        const m = window.AtlasSolHero.modeInfo(L, now);
        if (m.cls === "backup") return { cls: "backup", icon: "\u26a0", text: "On Backup", sub: m.sub };
        if (m.cls === "storm") return { cls: "storm", icon: "\u26c8", text: "Storm Mode", sub: m.sub };
        if (m.cls === "offline") return { cls: "offline", icon: "\u26a0", text: "Offline", sub: m.sub };
        return { cls: "normal", icon: "\u2713", text: "All Good", sub: m.sub.replace(/^Normal \u00b7 /, "All Systems Online \u00b7 ") };
      } catch (_) {}
    }
    const { ok } = liveState(L, now);
    if (!ok) return { cls: "offline", icon: "\u26a0", text: "Offline", sub: "Powerwall Data Unavailable Or Stale" };
    const pct = num(L.battery_pct) ? Math.round(L.battery_pct) : null;
    if (L.grid_up === false) {
      const load = Number(L.home_kw), hrs = pct != null && load > 0.05 ? (PW_KWH * pct / 100) / load : null;
      return { cls: "backup", icon: "\u26a0", text: "On Backup", sub: `Grid Down \u00b7 Powerwall ${pct ?? DASH}%${hrs ? ` \u00b7 About ${hrs.toFixed(1)} h At This Load` : ""}` };
    }
    const storm = L.storm ?? L.storm_mode_active ?? L.raw?.storm_mode_active ?? null;
    if (storm === true) return { cls: "storm", icon: "\u26c8", text: "Storm Mode", sub: "Storm Watch On \u00b7 Powerwall Holding 80% Reserve" };
    const res = num(L.reserve_pct) ? `${Math.round(L.reserve_pct)}% Reserve` : "Reserve " + DASH;
    return { cls: "normal", icon: "\u2713", text: "All Good", sub: `All Systems Online \u00b7 Grid ${L.grid_up === true ? "Online" : DASH} \u00b7 Powerwall ${res}` };
  }
  function pwKw(L) {
    if (num(L?.battery_kw)) return L.battery_kw;
    return [L?.home_kw, L?.solar_kw, L?.grid_kw].every(num) ? L.home_kw - L.solar_kw - L.grid_kw : null;
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function applyCspPositions(root) {
    (root || document).querySelectorAll("#panel-home [data-pos]").forEach((node) => {
      const [l, t] = String(node.dataset.pos || "").split(",");
      if (l) node.style.left = l + "%";
      if (t) node.style.top = t + "%";
    });
    (root || document).querySelectorAll("#panel-home [data-c]").forEach((node) => {
      node.style.setProperty("--c", node.dataset.c);
    });
  }

  function setFlow(pathId, value) {
    const p = $(pathId);
    if (!p) return;
    const base = p.getAttribute("class").replace(/\s*\b(is-on|is-rev)\b/g, "");
    if (!num(value) || Math.abs(value) < 0.05) { p.setAttribute("class", base); return; }
    p.setAttribute("class", `${base} is-on${value < 0 ? " is-rev" : ""}`);
  }
  function setBar(id, pct) {
    const n = $(id);
    if (!n) return;
    const val = Number(pct);
    n.style.width = `${Math.max(0, Math.min(100, Number.isFinite(val) ? val : 0))}%`;
  }

  function renderAlerts() {
    const host = $("home-alerts");
    if (!host) return;
    const notices = typeof window.systemNotices === "function" ? window.systemNotices() : [];
    host.replaceChildren(el("b", "", "Alerts"));
    if (!notices.length) {
      const chip = el("span", "home-chip");
      chip.style.setProperty("--c", "var(--home-ok)");
      chip.append(el("i", "", "OK"), document.createTextNode("No Active Alerts"));
      host.appendChild(chip);
      return;
    }
    for (const notice of notices.slice(0, 6)) {
      const chip = el("span", "home-chip");
      const blob = `${notice.title} ${notice.detail || ""}`;
      const tone = /backup|grid|down|offline|fail/i.test(blob) ? "var(--home-bad)"
        : /due|service|warn|stale|attention|cyber/i.test(blob) ? "var(--home-warn)"
        : "var(--home-info)";
      chip.style.setProperty("--c", tone);
      const kind = /due/i.test(notice.title) ? "DUE" : /grid|backup/i.test(notice.title) ? "GRID" : /cyber|security/i.test(notice.title) ? "CYBER" : "INFO";
      chip.append(el("i", "", kind), document.createTextNode(notice.title + (notice.detail ? ` \u00b7 ${notice.detail}` : "")));
      host.appendChild(chip);
    }
  }

  function syncGreeting() {
    const src = $("home-greeting");
    const kicker = $("home-greeting-kicker");
    const observed = $("home-observed");
    const label = $("overall-label");
    const updated = $("last-updated");
    if (kicker && src) kicker.textContent = (src.textContent || "Welcome Home").replace(/\.$/, "");
    if (observed) {
      const parts = [];
      if (label?.textContent) parts.push(label.textContent);
      if (updated?.textContent) parts.push(updated.textContent);
      observed.textContent = parts.filter(Boolean).join(" \u00b7 ") || "Household Command Is Ready";
    }
  }

  function lightLampState() {
    const items = typeof window.quickLightItems === "function" ? window.quickLightItems() : [];
    const on = (id) => {
      const hit = items.find((x) => x.entity_id === id);
      return hit && hit.state === "on" && hit.availability === "available";
    };
    return {
      driveway: on("light.driveway_light"),
      porchL: on("light.front_porch_left"),
      porchR: on("light.front_porch_right"),
    };
  }

  function render(L = live, now = Date.now()) {
    if (!$("home-hero")) return;
    syncGreeting();
    renderAlerts();
    const { ok } = liveState(L, now);
    const sky = skyPosition(now);
    const hero = $("home-hero");
    const house = $("home-house");
    const band = $("home-sun");
    hero?.classList.toggle("is-night", sky.night);
    house?.classList.toggle("is-night", sky.night);
    if ($("home-rise")) $("home-rise").textContent = ct(sky.night ? sky.sunset : sky.sunrise);
    if ($("home-rise-lbl")) $("home-rise-lbl").textContent = sky.night ? "Sunset" : "Sunrise";
    if ($("home-set")) $("home-set").textContent = ct(sky.night ? sky.sunrise : sky.sunset);
    if ($("home-set-lbl")) $("home-set-lbl").textContent = sky.night ? "Sunrise" : "Sunset";

    const bez = (t) => { const u = 1 - t; return [u * u * 30 + 2 * u * t * 500 + t * t * 970, u * u * 66 + 2 * u * t * -40 + t * t * 66]; };
    const [x, y] = bez(sky.t);
    const w = band?.clientWidth || 1000, h = band?.clientHeight || 70;
    for (const id of ["home-sun-dot", "home-solar-pill"]) {
      const n = $(id); if (!n) continue;
      n.style.left = `${x / 1000 * w}px`;
      n.style.top = `${y / 70 * h}px`;
    }
    $("home-solar-pill")?.classList.toggle("is-right", sky.t > 0.62);
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push(bez(i / 40 * sky.t).map((v) => v.toFixed(1)).join(" "));
    const arc = $("home-arc-done");
    if (arc) arc.setAttribute("d", sky.night ? "" : "M" + pts.join(" L"));

    const solar = ok && num(L?.solar_kw) ? L.solar_kw : null;
    const pill = $("home-solar-pill");
    if (pill) pill.textContent = sky.night ? `\u{1F319} Sun Down \u00b7 Solar ${solar == null ? DASH : kw(solar)}` : `\u2600 Solar ${solar == null ? DASH : kw(solar)}`;
    house?.classList.toggle("is-producing", solar != null && solar > 0.05);

    const grid = ok && num(L?.grid_kw) ? L.grid_kw : null;
    const pw = ok ? pwKw(L) : null;
    const hp = ok ? L?.house_pins : null;
    const houseKw = hp && hp.athena_fresh && num(hp.home_kw) ? hp.home_kw : (ok && num(L?.home_kw) ? L.home_kw : null);
    setFlow("home-f-solar", solar);
    setFlow("home-f-grid", ok && L?.grid_up === false ? 0 : grid);
    setFlow("home-f-pw", pw == null ? null : pw);
    /* t1126u: Command flow-battery mechanism */ (window.atlasHousePulseHome || (window.atlasHousePulseHome = function(id, kwv) { const p = document.getElementById(id); if (!p) return; const v = Number(kwv); const on = Number.isFinite(v) && v > 0.05; p.classList.remove("is-rev"); p.classList.toggle("is-on", on); let q = document.getElementById(id + "-pulse"); if (!q) { q = p.cloneNode(false); q.id = id + "-pulse"; q.removeAttribute("class"); q.setAttribute("pathLength", "100"); q.classList.add("house-pulse"); p.after(q); } q.classList.toggle("is-on", on); q.style.setProperty("--pulse-dur", (on ? Math.max(2, Math.min(4, 4 - v * 0.4)) : 3).toFixed(2) + "s"); }))("home-f-pw", houseKw);
    const chargeEarly = ok ? L?.vehicle_charge_snapshot : null;
    const athenaOnEarly = Boolean(hp?.athena_fresh) || chargeEarly?.charging_state === "Charging";
    const athenaKwEarly = hp?.athena_fresh && num(hp.athena_kw) ? hp.athena_kw : (athenaOnEarly && num(chargeEarly?.charger_power) ? chargeEarly.charger_power : null);
    setFlow("home-f-athena", athenaOnEarly && athenaKwEarly != null && Number(athenaKwEarly) > 0.1 ? Number(athenaKwEarly) : 0);

    const pwState = !num(pw) || Math.abs(pw) < 0.05 ? "Idle" : pw > 0 ? "Discharging" : "Charging";
    const pinSolar = $("home-pin-solar");
    if (pinSolar) pinSolar.innerHTML = `<small>Solar</small>${sky.night && !(solar > 0.05) ? "Sun Down" : (solar == null ? DASH : kw(solar))}`;
    const pinHouse = $("home-pin-house");
    if (pinHouse) pinHouse.innerHTML = `<small>House</small>${houseKw == null ? DASH : kw(houseKw)}`;
    const pinGrid = $("home-pin-grid");
    if (pinGrid) {
      if (ok && L?.grid_up === false) pinGrid.innerHTML = "<small>Grid</small>Offline";
      else {
        const gLabel = !num(grid) || Math.abs(grid) < 0.05 ? "Idle" : grid > 0 ? "Importing" : "Exporting";
        pinGrid.innerHTML = `<small>Grid \u00b7 ${gLabel}</small>${!num(grid) || Math.abs(grid) < 0.05 ? "0 kW" : kw(grid)}`;
      }
    }
    const pinPw = $("home-pin-pw");
    if (pinPw) {
      const pctPart = ok && num(L?.battery_pct) ? `${Math.round(L.battery_pct)}%` : DASH;
      const flowPart = !num(pw) || Math.abs(pw) < 0.05 ? "" : ` \u00b7 ${kw(pw)}`;
      pinPw.innerHTML = `<small>Powerwall \u00b7 ${pwState}</small>${pctPart}${flowPart}`;
    }
    const pinAth = $("home-pin-athena");
    if (pinAth) {
      const ch = ok ? L?.vehicle_charge_snapshot : null;
      const aOn = Boolean(hp?.athena_fresh) || ch?.charging_state === "Charging";
      const aKw = hp?.athena_fresh && num(hp.athena_kw) ? hp.athena_kw : (aOn && num(ch?.charger_power) ? ch.charger_power : null);
      const aPct = ch && num(ch.battery_level) ? Math.round(ch.battery_level) + "%" : DASH;
      let aPow = "0.00 kW";
      if (aOn && aKw != null && Number(aKw) > 0.1) aPow = Number(aKw).toFixed(2) + " kW";
      else if (String(ch?.charging_state || "").toLowerCase() === "disconnected") aPow = "Idle";
      pinAth.innerHTML = `<small>${aOn ? "House \u2192 Athena" : "Athena"}</small>${aPct} \u00b7 ${aPow}`;
      pinAth.classList.toggle("is-idle", !aOn);
    }

    const lamps = lightLampState();
    document.querySelectorAll("#home-house .home-glow.lamp").forEach((g) => g.classList.toggle("is-on", Boolean(lamps[g.dataset.lamp])));

    const md = modeInfo(L, now);
    const notices = typeof window.systemNotices === "function" ? window.systemNotices() : [];
    let mode = md;
    if (md.cls === "normal" && notices.length) mode = { cls: "attn", icon: "!", text: "Alerts", sub: `${notices.length} Need Attention \u00b7 ${notices[0].title}` };
    const modeEl = $("home-mode");
    if (modeEl) modeEl.className = `home-mode is-${mode.cls}`;
    if ($("home-mode-icon")) $("home-mode-icon").textContent = mode.icon;
    if ($("home-mode-text")) $("home-mode-text").textContent = mode.text;
    if ($("home-mode-sub")) $("home-mode-sub").textContent = mode.sub;

    const totals = window.AtlasEnergy?.today?.totals || null;
    const todayNote = totals && num(totals.solar_kwh)
      ? `${totals.solar_kwh.toFixed(1)} kWh Today${num(totals.self_powered_pct) ? ` \u00b7 ${Math.round(totals.self_powered_pct)}% Self-Powered` : ""}`
      : DASH;
    if ($("home-e-solar")) $("home-e-solar").textContent = solar == null ? DASH : kw(solar);
    if ($("home-e-solar-n")) $("home-e-solar-n").textContent = `${sky.night ? "Sun Down" : (solar != null && solar > 0.05 ? "Producing" : "Idle")} \u00b7 ${todayNote}`;

    const pct = ok && num(L?.battery_pct) ? Math.max(0, Math.min(100, L.battery_pct)) : null;
    const reserve = mode.cls === "storm" ? 80 : (ok && num(L?.reserve_pct) ? L.reserve_pct : null);
    if ($("home-e-pw")) $("home-e-pw").textContent = pct == null ? DASH : `${Math.round(pct)}%`;
    setBar("home-e-pw-bar", pct);
    if ($("home-e-pw-n")) $("home-e-pw-n").textContent = `${pwState}${num(pw) && Math.abs(pw) > 0.05 ? " " + kw(pw) : ""}${reserve != null ? ` \u00b7 Reserve ${Math.round(reserve)}%` : ""}`;

    const charge = ok ? L?.vehicle_charge_snapshot : null;
    const athenaOn = Boolean(hp?.athena_fresh) || charge?.charging_state === "Charging";
    const athPct = charge && num(charge.battery_level) ? Math.round(charge.battery_level) : null;
    if ($("home-e-ath")) $("home-e-ath").textContent = athPct == null ? DASH : `${athPct}%`;
    setBar("home-e-ath-bar", athPct);
    let athNote = "No Reading";
    let athUnplugged = false;
    if (charge) {
      if (athenaOn) athNote = `Charging${num(charge.charger_power) ? " · " + Number(charge.charger_power).toFixed(1) + " kW" : ""} · Read-Only`;
      else if (typeof window.athenaWords === "function") athNote = `${window.athenaWords(charge)} · Read-Only`;
      else athNote = `${charge.charging_state || "Idle"} · Read-Only`;
      const key = String(charge.charging_state || "").toLowerCase().replace(/[\s_]/g, "");
      athUnplugged = key === "disconnected" || key === "unplugged" || /unplug/i.test(athNote);
    }
    if ($("home-e-ath-n")) $("home-e-ath-n").textContent = athNote;
    const athRow = $("home-e-ath") && $("home-e-ath").closest ? $("home-e-ath").closest(".home-er") : null;
    if (athRow) athRow.classList.toggle("is-unplugged", Boolean(athUnplugged));

    const b = L && L.bluetti;
    const bLive = Boolean(b) && b.available !== false;
    const bPct = bLive && num(Number(b.battery_pct)) ? Math.max(0, Math.min(100, Number(b.battery_pct))) : null;
    if ($("home-e-bl")) $("home-e-bl").textContent = bPct == null ? (bLive ? DASH : "Offline") : `${Math.round(bPct)}%`;
    setBar("home-e-bl-bar", bPct);
    let bText = !b ? "No Reading Yet" : !bLive ? "Offline (Cloud)" : (window.AtlasBluetti ? window.AtlasBluetti.status(b) : "Portable Battery");
    if ($("home-e-bl-n")) $("home-e-bl-n").textContent = bText;

    const ups = cc?.ups || {};
    const upsPct = num(Number(ups.chargePercent)) ? Number(ups.chargePercent) : null;
    if ($("home-e-ups")) $("home-e-ups").textContent = upsPct == null ? DASH : `${Math.round(upsPct)}%`;
    setBar("home-e-ups-bar", upsPct);
    const upsParts = [];
    if (ups.power) upsParts.push(ups.power);
    if (ups.runtimeMinutes != null) upsParts.push(`${ups.runtimeMinutes} Min Runtime`);
    if ($("home-e-ups-n")) $("home-e-ups-n").textContent = upsParts.join(" \u00b7 ") || (ups.status ? String(ups.status) : DASH);

    paintCommand(L, { ok, solar, houseKw, grid, pw, pwState });
    if ($("home-scene-tag")) {
      $("home-scene-tag").textContent = !ok ? "Live Data Offline" : sky.night
        ? `Night \u00b7 Sunrise ${ct(sky.sunrise)}`
        : `Day \u00b7 ${solar != null && solar > 0.05 ? "Solar Producing" : "Solar Idle"} \u00b7 Sunset ${ct(sky.sunset)}`;
    }
  }

  async function refreshCc() {
    try {
      const r = await fetch("/v1/command-center", { headers: { Accept: "application/json" }, cache: "no-store" });
      if (r.ok) cc = await r.json();
    } catch (_) {}
  }

  function patchLightsDisplayOnly() {
    const original = window.renderQuickLights;
    if (typeof original !== "function" || original.__homeDisplayOnly) return;
    function wrapped() {
      original();
      const host = $("quick-light-controls");
      if (!host || !host.closest("#panel-home")) return;
      host.querySelectorAll("button.quick-light").forEach((btn) => {
        const clone = btn.cloneNode(true);
        clone.disabled = true;
        clone.setAttribute("aria-disabled", "true");
        clone.title = (clone.title ? clone.title + " \u00b7 " : "") + "Display Only";
        btn.replaceWith(clone);
      });
      host.querySelectorAll(".quick-light-all, .quick-light-dark").forEach((b) => b.remove());
    }
    wrapped.__homeDisplayOnly = true;
    window.renderQuickLights = wrapped;
  }

  function wireHouseClick() {
    const house = $("home-house");
    if (!house || house.dataset.wired) return;
    house.dataset.wired = "1";
    const go = () => {
      const tab = document.querySelector('.module-tab[data-tab="energy"]');
      if (tab) tab.click();
      else location.hash = "#energy";
    };
    house.addEventListener("click", go);
    house.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  }

  function paintCommand(L, parts) {
    const slot = $("cw-house-slot");
    const tiles = $("cw-power-tiles");
    if (!slot || !tiles) return;
    if (!slot.querySelector(".energy-house-panel")) {
      const panel = document.createElement("div");
      panel.className = "energy-house-panel has-photo";
      panel.innerHTML = `
        <img src="/assets/atlas-house-hilltop.png" alt="Illustration of the hilltop house and solar array">
        <svg class="energy-house-flows" viewBox="0 0 100 56.25" preserveAspectRatio="none" aria-hidden="true">
          <path id="cw-f-solar" class="home-flow home-c-solar" d="M71 13.2 C76 16 81 20 85.3 24.2"></path>
          <path id="cw-f-grid" class="home-flow home-c-grid" d="M96.5 52 C95 42 89 31 85.3 24.2"></path>
          <path id="cw-f-house" class="home-flow home-c-pw" d="M85.3 24.2 C71 20.5 54 23 43.7 32"></path>
          <path id="cw-f-athena" class="home-flow home-c-athena" d="M85.3 24.2 C80 27.5 72 31 62 34.5 C50 38.5 36 39.5 27 37 C24 36 22 34.8 20.2 33.2"></path>
        </svg>
        <div class="energy-pin-dot" data-pos="43.7,56.9"></div>
        <div class="energy-pin-dot" data-pos="85.3,43"></div>
        <div class="energy-pin pin-solar" data-pos="74,26"><span>Solar</span><strong id="cw-pin-solar">—</strong></div>
        <div class="energy-pin pin-home" data-pos="58,38"><span>House</span><strong id="cw-pin-house">—</strong></div>
        <div class="energy-pin pin-grid" data-pos="90,86"><span>Grid</span><strong id="cw-pin-grid">—</strong></div>
        <div class="energy-pin pin-battery" data-pos="88,33"><span>Powerwall</span><strong id="cw-pin-pw">—</strong></div>
        <div class="energy-pin pin-athena" data-pos="20,70"><span>Athena</span><strong id="cw-pin-athena">—</strong></div>`;
      slot.replaceChildren(panel);
      panel.querySelectorAll("[data-pos]").forEach((node) => {
        const [l, t] = String(node.dataset.pos || "").split(",");
        if (l) node.style.left = l + "%";
        if (t) node.style.top = t + "%";
      });
    }
    const text = (id, value) => { const n = $(id); if (n) n.textContent = value; };
    const solarTxt = parts.solar == null ? DASH : kw(parts.solar);
    const houseTxt = parts.houseKw == null ? DASH : kw(parts.houseKw);
    const gridWord = !parts.ok || !num(parts.grid) || Math.abs(parts.grid) < 0.05 ? "Idle" : parts.grid > 0 ? "Importing" : "Exporting";
    const gridTxt = gridWord === "Idle" ? "0.00 kW" : kw(parts.grid);
    const pct = parts.ok && num(L?.battery_pct) ? `${Math.round(L.battery_pct)}%` : DASH;
    const pwTxt = !num(parts.pw) || Math.abs(parts.pw) < 0.05 ? pct : `${pct} · ${kw(parts.pw)}`;
    text("cw-pin-solar", solarTxt);
    text("cw-pin-house", houseTxt);
    text("cw-pin-grid", `${gridWord} ${gridTxt}`.trim());
    text("cw-pin-pw", `${parts.pwState} ${pwTxt}`.trim());
    const charge = parts.ok ? L?.vehicle_charge_snapshot : null;
    const hp = parts.ok ? L?.house_pins : null;
    const aOn = Boolean(hp?.athena_fresh) || charge?.charging_state === "Charging";
    const aKw = hp?.athena_fresh && num(hp.athena_kw) ? hp.athena_kw : (aOn && num(charge?.charger_power) ? charge.charger_power : null);
    const aPct = charge && num(charge.battery_level) ? `${Math.round(charge.battery_level)}%` : DASH;
    const aPow = aOn && aKw != null && Number(aKw) > 0.1 ? `${Number(aKw).toFixed(2)} kW` : "0.00 kW";
    text("cw-pin-athena", `${aOn ? "House → Athena" : "Athena"} ${aPct} · ${aPow}`);
    const pulse = window.atlasHousePulseHome;
    if (typeof pulse === "function") pulse("cw-f-house", parts.houseKw);
    fillCommandChrome(L, parts, { solarTxt, houseTxt, gridWord, gridTxt, pct, pwTxt, aOn, aPct, aPow });
    const tile = (cls, label, value, note) => `<article class="cw-tile ${cls}"><small>${label}</small><b>${value}</b><span>${note}</span></article>`;
    tiles.className = "cw-bigrow";
    tiles.innerHTML = [
      tile("solar", "Solar", solarTxt, parts.solar != null && parts.solar > 0.05 ? "Producing" : "Idle"),
      tile("home", "House", houseTxt, "House Load"),
      tile("grid", "Grid", gridTxt, gridWord),
      tile("pw", "Powerwall", pct, parts.pwState),
    ].join("");
  }

  function fillCommandChrome(L, parts, view) {
    const na = "Not available";
    const statusEl = $("cw-status");
    const overall = $("overall-label")?.textContent || "";
    if (statusEl) {
      const ready = overall && !/connect|loading|waiting/i.test(overall);
      statusEl.textContent = ready ? overall : (parts.ok ? "Online" : "Readings unavailable");
      statusEl.className = `cw-overall ${parts.ok ? "ok" : "warn"}`;
    }
    const clock = $("cw-clock");
    if (clock) clock.textContent = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
    const updated = $("cw-updated");
    if (updated) updated.textContent = L?.polled_at ? `Energy ${new Date(L.polled_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}` : "";
    const put = (id, value) => { const n = $(id); if (n) n.textContent = value; };
    const hvac = $("metric-hvac")?.textContent;
    put("cw-s-indoor", na);
    put("cw-s-outdoor", na);
    put("cw-s-hvacmode", hvac && hvac !== "—" && hvac !== DASH ? hvac : na);
    put("cw-s-pw", parts.ok && num(L?.battery_pct) ? `${Math.round(L.battery_pct)}% ${parts.pwState}` : na);
    put("cw-s-grid", parts.ok ? view.gridWord : na);
    put("cw-s-ups", na);
    put("cw-s-athena", view.aOn ? `${view.aPct} · ${view.aPow}` : na);
    put("cw-s-lights", na);
    put("cw-s-garage", na);
    put("cw-s-leak", na);
    const root = $("cw-root");
    if (!root) return;
    if (!root.dataset.publicBoard) {
      root.dataset.publicBoard = "1";
      root.innerHTML = `
        <section class="cw-card cw-batt" aria-label="Powerwall"><h3>Powerwall</h3><p class="cw-state" id="cw-card-pw"></p><p class="cw-note">From the energy reading. No Powerwall command is sent.</p></section>
        <section class="cw-card cw-athena" aria-label="Athena"><h3>Athena</h3><p class="cw-state" id="cw-card-athena"></p><p class="cw-note">Read only. No wake or vehicle command.</p></section>
        <section class="cw-card cw-alertcard" aria-label="Alerts"><h3>Alerts</h3><p class="cw-okline" id="cw-card-alerts">No active alerts in this view.</p></section>
        <section class="cw-card cw-trends" aria-label="Current power"><h3>Current Power</h3><div id="cw-card-power"></div><p class="cw-note">Same reading as Home and Energy. Not a history chart.</p></section>
        <section class="cw-card cw-systems" aria-label="Systems"><h3>Systems</h3><p class="cw-state" id="cw-card-systems"></p></section>
        <section class="cw-card cw-home" aria-label="Home readings"><h3>Home</h3><p class="cw-note">Indoor temperature, lights, garage, and leaks stay blank until the command-center adapter is connected. They are not estimated.</p></section>
        <section class="cw-card cw-events-card" aria-label="Adapter"><h3>Adapter</h3><p class="cw-note">Full strip automation is command-center.js, which is not in this public package. This view uses Atlas status and the energy reading only.</p></section>`;
    }
    put("cw-card-pw", parts.ok ? `${view.pct} · ${parts.pwState} ${view.pwTxt}` : na);
    put("cw-card-athena", view.aOn ? `${view.aPct} · ${view.aPow}` : na);
    const power = $("cw-card-power");
    if (power) power.textContent = `Solar ${view.solarTxt} · House ${view.houseTxt} · EV ${view.aPow} · Grid ${view.gridWord} ${view.gridTxt} · Powerwall ${view.pct}`;
    put("cw-card-systems", overall || na);
  }

  function ensureHomeTabVisible() {
    const tabHome = $("tab-home");
    if (!tabHome) return;
    tabHome.hidden = false;
    tabHome.removeAttribute("aria-hidden");
    if (tabHome.tabIndex < -1) tabHome.tabIndex = -1;
  }

  function start() {
    try {
      const panel = $("panel-home");
      if (panel) panel.classList.add("home-upgrade-on");
      applyCspPositions(panel || document);
      ensureHomeTabVisible();
      patchLightsDisplayOnly();
      wireHouseClick();
      paintCommand(null, { ok: false, solar: null, houseKw: null, grid: null, pw: null, pwState: "Idle" });
      render();
      refreshCc().then(() => render());
      if (typeof window.renderQuickLights === "function") window.renderQuickLights();
    } catch (err) {
      console.warn("Home Upgrade:", err);
    }
    setInterval(() => { try { render(); } catch (_) {} }, 30000);
    setInterval(() => { refreshCc().then(() => { try { render(); } catch (_) {} }); }, 60000);
  }

  window.addEventListener("atlas-sol-live", (e) => {
    live = e.detail || null;
    try { render(); } catch (err) { console.warn("Home Upgrade:", err); }
  });
  window.addEventListener("atlas-energy-today", () => { try { render(); } catch (_) {} });
  window.addEventListener("resize", () => { try { render(); } catch (_) {} });
  window.AtlasHomeUpgrade = { render, modeInfo, skyPosition, liveState };

  if (document.readyState === "complete") setTimeout(start, 0);
  else window.addEventListener("load", () => setTimeout(start, 50));
})();
/* ===== HOME UPGRADE END ===== */
