"use strict";

const savedProfile = localStorage.getItem("atlas-profile");
const state = { status: null, energy: null, energyHistory: null, energyRange: "day", forecast: null, home: null, inventory: null, ids: null, pantry: null, travel: null, argo: null, currentAssetId: "vehicle-athena", currentTripId: null, travelView: "overview", atlas: null, household: null, profile: ["alex", "sam"].includes(savedProfile) ? savedProfile : "alex", environmentHistory: null, environmentHistoryLoading: false, hvacDraft: null, agentHistory: [] };
const externalDestinations = { chatgpt: "https://chatgpt.com/", utility: "https://example.invalid/utility" };
const centralTimeZone = "America/Chicago";
const tabs = [...document.querySelectorAll("[role='tab'][data-tab]")];
const panels = [...document.querySelectorAll("[role='tabpanel']")];

function setupResponsiveLayout() {
  const moduleRail = document.querySelector(".module-rail");
  const mobileRail = window.matchMedia("(max-width: 700px)");
  const syncRail = () => moduleRail.setAttribute("aria-orientation", mobileRail.matches ? "horizontal" : "vertical");
  mobileRail.addEventListener("change", syncRail);
  syncRail();

}
setupResponsiveLayout();

function activateTab(name, focus = false, updateHash = true) {
  if (name === "health") name = "maintenance";
  if (name === "argo") { location.replace("/argo/"); return; }
  const selected = tabs.find((tab) => tab.dataset.tab === name);
  if (!selected) return;
  if (name === "travel" && updateHash) {
    state.currentTripId = null;
    state.travelView = "overview";
  }
  for (const tab of tabs) {
    const active = tab === selected;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of panels) panel.hidden = panel.id !== `panel-${name}`;
  document.body.classList.toggle("home-active", name === "home");
  document.body.classList.toggle("agents-active", name === "agents");
  if (name === "agents" && atlasChatDialog.open) closeAtlasChat();
  if (name === "pantry") renderPantryPage();
  if (name === "travel") renderTravelPage();
  if (name === "systems") renderEntityInventory();
  if (name === "energy") window.AtlasEnergy.open(updateHash);
  if (name === "notifications") loadHousehold(false);
  if (name === "agents") renderAgents();
  if (name === "maintenance") window.AtlasMaintenance?.load();
  if (name === "calendar") window.AtlasCalendar?.load();
  if (name === "security") renderSecurityPage();
  if (name === "environment") {
    renderEnvironmentPage();
    loadEnvironmentHistory();
  }
  if (focus) selected.focus();
  if (updateHash) history.replaceState(null, "", name === "home" ? "#home" : `#${name}`);
  window.scrollTo({ top: 0, behavior: "auto" });
}

for (const tab of tabs) {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    const horizontal = tab.closest("[role='tablist']").getAttribute("aria-orientation") === "horizontal";
    const nextKey = horizontal ? "ArrowRight" : "ArrowDown";
    const previousKey = horizontal ? "ArrowLeft" : "ArrowUp";
    if (![nextKey, previousKey, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(tab);
    const forward = event.key === nextKey;
    const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (forward ? 1 : -1) + tabs.length) % tabs.length;
    activateTab(tabs[targetIndex].dataset.tab, true);
  });
}

for (const trigger of document.querySelectorAll("[data-tab-target]")) {
  trigger.addEventListener("click", () => activateTab(trigger.dataset.tabTarget, true));
}

function updateClock() {
  const now = new Date();
  document.getElementById("clock").textContent = now.toLocaleTimeString("en-US", { timeZone: centralTimeZone, hour: "numeric", minute: "2-digit" });
  const hourPart = new Intl.DateTimeFormat("en-US", { timeZone: centralTimeZone, hour: "numeric", hourCycle: "h23" }).formatToParts(now).find((part) => part.type === "hour");
  const hour = Number(hourPart?.value || 0);
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const homeGreeting = document.getElementById("home-greeting");
  if (homeGreeting) homeGreeting.textContent = `${greeting}, ${currentProfile().name}.`;
}

function humanTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function safeText(value, fallback = "—") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function formatNumber(value, suffix = "", digits = 1) {
  if (value === undefined || value === null || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits)}${suffix}` : "—";
}

function serviceById(id) {
  return state.status?.services?.find((item) => item.id === id);
}

function argoDate(value) {
  if (!value) return "Not Recorded";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}


function householdUrl(port, path = "/") {
  return `${location.protocol}//${location.hostname}:${port}${path}`;
}

function configureGalleyQuestLinks() {
  for (const link of document.querySelectorAll("[data-galleyquest-tab]")) {
    link.href = `/galleyquest/?tab=${encodeURIComponent(link.dataset.galleyquestTab || "recipes")}`;
    link.removeAttribute("target");
    link.removeAttribute("rel");
  }
}


function pantryStatusCopy() {
  const pantry = state.pantry;
  if (!pantry || pantry.status !== "healthy") return ["Status Unavailable", "GalleyQuest Data Could Not Be Read"];
  const missing = Number(pantry.missing_ingredients) || 0;
  const cart = Number(pantry.cart_items) || 0;
  const meals = Number(pantry.meals_planned) || 0;
  if (missing > 0) return [`${missing} Missing`, `For Planned Meals · ${cart} Cart Item${cart === 1 ? "" : "s"}`];
  if (cart > 0) return [`${cart} Cart Item${cart === 1 ? "" : "s"}`, `${meals} Meal${meals === 1 ? "" : "s"} Planned This Week`];
  if (meals > 0) return [`${meals} Meal${meals === 1 ? "" : "s"} Planned`, "No Missing Ingredients or Cart Items"];
  return ["Plan Meals", "No Meals or Grocery Items This Week"];
}

function pantryMissingIngredientsCopy() {
  if (!state.pantry || state.pantry.status !== "healthy") return "—";
  const missing = Math.max(0, Number(state.pantry.missing_ingredients) || 0);
  return `${missing} Missing Ingredient${missing === 1 ? "" : "s"}`;
}

function pantryStaplesSummary() {
  const staples = Array.isArray(state.pantry?.staples) ? state.pantry.staples : [];
  if (state.pantry?.status !== "healthy" || !staples.length) return ["Staples On Hand", "—", "Household Basics"];
  const onHand = staples.filter((item) => ["OK", "LOW"].includes(String(item.status).toUpperCase())).length;
  return ["Staples On Hand", `${onHand} / ${staples.length}`, "Household Basics"];
}


function titleCase(value) {
  return safeText(value, "").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayName(value, fallback = "—") {
  const raw = safeText(value, fallback).trim();
  const aliases = {
    homeassistant: "Home Assistant",
    influxdb: "InfluxDB",
    "open webui": "Open WebUI",
    searxng: "SearXNG",
    ntfy: "Ntfy",
    ollama: "Ollama",
    grafana: "Grafana",
    powerwall: "Powerwall",
  };
  const normalized = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const alias = aliases[normalized.toLowerCase()];
  if (alias) return alias;
  return normalized.split(" ").map((word) => {
    if (!word) return word;
    if (/^[A-Z0-9]{2,}$/.test(word) || /[A-Z]/.test(word.slice(1))) return word;
    return `${word[0].toUpperCase()}${word.slice(1)}`;
  }).join(" ");
}

function currentProfile() {
  return state.household?.profiles?.find((profile) => profile.id === state.profile) || { id: state.profile, name: titleCase(state.profile), role: state.profile === "alex" ? "Administrator" : "Household Operator" };
}

async function acceptProfile(profileId) {
  state.profile = profileId;
  localStorage.setItem("atlas-profile", profileId);
  await loadHousehold(false);
  renderProfile();
  renderQuickLights();
  updateClock();
  document.getElementById("profile-overlay").hidden = true;
  document.body.classList.remove("control-open");
}

function renderProfile() {
  const profile = currentProfile();
  const isAlex = profile.id === "alex";
  document.body.dataset.profile = profile.id;
  for (const copy of document.querySelectorAll(".profile-copy")) {
    copy.querySelector("strong").textContent = profile.name;
    copy.querySelector("small").textContent = profile.role;
  }
  for (const button of document.querySelectorAll("[data-profile-open]")) {
    button.dataset.profileId = profile.id;
    button.setAttribute("aria-label", `Current local profile: ${profile.name}`);
  }
  for (const image of document.querySelectorAll("[data-profile-open] img")) {
    image.hidden = !isAlex;
    image.alt = isAlex ? "Alex" : "";
  }
  for (const initial of document.querySelectorAll("[data-profile-open] .profile-initial")) {
    initial.hidden = isAlex;
    initial.textContent = profile.name.slice(0, 1).toUpperCase();
  }
  document.getElementById("profile-title").textContent = profile.name;
  const profiles = state.household?.profiles || [{ id: "alex", name: "Alex", role: "Administrator" }, { id: "sam", name: "Sam", role: "Household Operator" }];
  document.getElementById("profile-grid").replaceChildren(...profiles.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = item.id === state.profile ? "active" : "";
    const label = document.createElement("span"); label.textContent = "Local Profile";
    const name = document.createElement("strong"); name.textContent = item.name;
    const role = document.createElement("small"); role.textContent = item.role;
    button.append(label, name, role);
    button.addEventListener("click", async () => {
      const pinPanel = document.getElementById("profile-pin-panel");
      const pinStatus = document.getElementById("profile-pin-status");
      if (item.id === state.profile) {
        document.getElementById("close-profile").click();
        return;
      }
      if (item.id === "sam") {
        await acceptProfile("sam");
        return;
      }
      pinPanel.hidden = false;
      pinStatus.textContent = state.household?.alex_pin_configured === false ? "Alex’s PIN must be configured once on the Atlas host." : "Enter Alex’s PIN to switch profiles.";
      document.getElementById("profile-pin").focus();
    });
    return button;
  }));
}

function quickLightItems() {
  const items = state.inventory?.groups?.home_controls || [];
  const priority = ["light.driveway_light", "light.main_hall_light", "light.entry_light_left", "light.entry_light_right"];
  return [...items].sort((left, right) => {
    const leftIndex = priority.indexOf(left.entity_id);
    const rightIndex = priority.indexOf(right.entity_id);
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.name.localeCompare(right.name);
  });
}

function quickLightName(item) {
  const names = {
    "light.driveway_light": "Driveway",
    "light.main_hall_light": "Main Hall",
    "light.entry_light_left": "Porch Left",
    "light.entry_light_right": "Porch Right",
  };
  return names[item.entity_id] || safeText(item.name, "Household Light");
}

function renderQuickLights() {
  const host = document.getElementById("quick-light-controls");
  if (!host) return;
  const items = quickLightItems();
  if (!items.length) {
    host.replaceChildren(Object.assign(document.createElement("p"), { className: "empty-state", textContent: "No common light controls are currently available." }));
    return;
  }
  const controls = items.map((item) => {
    const button = document.createElement("button");
    const enabled = item.state === "on";
    const available = item.availability === "available" && item.controllable;
    button.type = "button";
    button.className = `quick-light${enabled ? " is-on" : ""}`;
    button.dataset.lightControl = item.entity_id;
    button.setAttribute("aria-pressed", String(enabled));
    button.disabled = !available;
    const name = document.createElement("span"); name.textContent = quickLightName(item);
    const stateCopy = document.createElement("strong"); stateCopy.textContent = available ? (enabled ? "On" : "Off") : "Offline";
    button.append(name, stateCopy);
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.classList.add("is-pending");
      await setHomeControl(item, !enabled);
    });
    return button;
  });
  const availableLights = items.filter((item) => item.availability === "available" && item.controllable);
  const allOn = availableLights.length > 0 && availableLights.every((item) => item.state === "on");
  const allOff = availableLights.length > 0 && availableLights.every((item) => item.state === "off");
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = `quick-light quick-light-all${allOn ? " is-on" : ""}`;
  allButton.disabled = !availableLights.length || allOn;
  allButton.setAttribute("aria-label", "Turn all available household lights on");
  const allName = document.createElement("span"); allName.textContent = "All Lights";
  const allState = document.createElement("strong"); allState.textContent = allOn ? "On" : "Turn On";
  allButton.append(allName, allState);
  allButton.addEventListener("click", () => setAllLights(availableLights, true, allButton));

  const darkButton = document.createElement("button");
  darkButton.type = "button";
  darkButton.className = `quick-light quick-light-dark${allOff ? " is-dark" : ""}`;
  darkButton.disabled = !availableLights.length || allOff;
  darkButton.setAttribute("aria-pressed", String(allOff));
  darkButton.setAttribute("aria-label", "Go Dark: turn all available household lights off");
  const darkName = document.createElement("span"); darkName.textContent = "All Lights";
  const darkState = document.createElement("strong"); darkState.textContent = "Go Dark";
  darkButton.append(darkName, darkState);
  darkButton.addEventListener("click", () => setAllLights(availableLights, false, darkButton));
  host.replaceChildren(...controls, allButton, darkButton);
}

function recordHomeControlState(entityId, enabled) {
  for (const values of Object.values(state.inventory?.groups || {})) {
    const canonical = values.find((entity) => entity.entity_id === entityId);
    if (canonical) canonical.state = enabled ? "on" : "off";
  }
}

async function sendHomeControl(entityId, enabled) {
  const response = await fetch("/v1/home/controls", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ entity_id: entityId, enabled }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  recordHomeControlState(entityId, enabled);
}

async function setAllLights(items, enabled, button) {
  button.disabled = true;
  button.classList.add("is-pending");
  try {
    const expectedState = enabled ? "on" : "off";
    let pending = items.filter((item) => item.state !== expectedState);
    for (let attempt = 0; attempt < 2 && pending.length; attempt += 1) {
      for (const item of pending) {
        await sendHomeControl(item.entity_id, enabled);
        await new Promise((resolve) => window.setTimeout(resolve, 140));
      }
      renderEntityInventory();
      renderQuickLights();
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      await refreshHomeInventory();
      const current = new Map(quickLightItems().map((item) => [item.entity_id, item]));
      pending = items.filter((item) => current.get(item.entity_id)?.state !== expectedState);
    }
    if (pending.length) throw new Error(`${pending.map(quickLightName).join(", ")} did not reach ${expectedState}`);
  } catch (error) {
    window.alert(`All lights did not ${enabled ? "turn on" : "go dark"}: ${error.message}`);
    renderQuickLights();
  }
}

function currentHealthScores() {
  // A successful historical check is not evidence of current health.
  return state.status?.health_controls?.status === "current" ? state.status.scores || {} : {};
}

function cyberLabel(cyber) {
  if (!cyber?.fresh) return cyber?.status === "stale" ? "Collector Is Stale" : "Awaiting Collector";
  return {current:"Host Checks Current", partial:"Telemetry Incomplete", attention:"Review Needed"}[cyber.status] || "Unknown";
}

function systemNotices() {
  const notices = (state.status?.failures || []).filter(failure => failure.status !== "monitoring").map((failure) => {
    const source = failure.source === "health_control" ? "Sysmon health control" : titleCase(failure.source || "Atlas system");
    return {
      title: titleCase(String(failure.id || failure.item || "System Condition").replace(/[_/]+/g, " ")),
      detail: `${source} reports ${safeText(failure.status, "a condition requiring review")}. Open Systems for current evidence and recovery context.`,
      actionTab: failure.source === "health_control" ? "security" : "systems",
      actionLabel: failure.source === "health_control" ? "Review Security" : "Review Systems",
    };
  });
  if (state.inventory?.backup?.status === "needs_attention") notices.push({ title: "Backup Health", detail: `${state.inventory.backup.detail}. Open Systems to review the backup timestamps.`, actionTab: "systems", actionLabel: "Review Backups" });
  if (state.cyber?.fresh && (state.cyber.summary?.high || state.cyber.summary?.attention)) notices.push({title:"Cyber Review Needed", detail:`${state.cyber.summary.high} high-priority event groups · ${state.cyber.summary.attention} protection checks need attention.`, actionTab:"security", actionLabel:"Review Cyber Health"});
  if (state.cyber?.status === "stale") notices.push({title:"Cyber Collector Is Stale", detail:"New security evidence is not arriving. Review collection before trusting previous results.", actionTab:"security", actionLabel:"Review Collector"});
  return notices;
}

function updateNotificationBadges() {
  const total = systemNotices().length + Number(state.household?.unread || 0);
  for (const id of ["notification-count", "home-notification-count"]) {
    const badge = document.getElementById(id);
    badge.textContent = total ? String(total) : "";
    badge.hidden = total === 0;
  }
}

function renderHousehold() {
  renderProfile();
  const notices = systemNotices();
  const noticeHost = document.getElementById("system-notice-list");
  noticeHost.replaceChildren(...notices.map((notice) => {
    const article = document.createElement("article"); article.className = "message-card unread";
    const header = document.createElement("header"); const title = document.createElement("strong"); title.textContent = notice.title; const source = document.createElement("small"); source.textContent = "Atlas System"; header.append(title, source);
    const detail = document.createElement("p"); detail.textContent = notice.detail;
    const actions = document.createElement("div"); actions.className = "message-actions";
    const review = document.createElement("button"); review.type = "button"; review.textContent = notice.actionLabel || "Review"; review.addEventListener("click", () => activateTab(notice.actionTab || "systems", true));
    actions.append(review); article.append(header, detail, actions); return article;
  }));
  const messages = state.household?.messages || [];
  const host = document.getElementById("household-message-list");
  if (!messages.length) {
    host.replaceChildren(Object.assign(document.createElement("p"), { className: "empty-state", textContent: "No household messages yet." }));
  } else {
    host.replaceChildren(...messages.map((message) => {
      const article = document.createElement("article"); article.className = `message-card${!message.is_read && message.sender_id !== state.profile ? " unread" : ""}`;
      const header = document.createElement("header"); const title = document.createElement("strong"); title.textContent = `${titleCase(message.sender_id)} → ${message.recipient_id === "household" ? "Household" : titleCase(message.recipient_id)}`; const time = document.createElement("small"); time.textContent = humanTime(message.created_at); header.append(title, time);
      const body = document.createElement("p"); body.textContent = message.body;
      const actions = document.createElement("div"); actions.className = "message-actions";
      if (!message.is_read && message.sender_id !== state.profile) {
        const read = document.createElement("button"); read.type = "button"; read.textContent = "Mark Read"; read.addEventListener("click", () => updateHouseholdMessage(message.id, "read")); actions.append(read);
      }
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Delete"; remove.addEventListener("click", () => updateHouseholdMessage(message.id, "delete")); actions.append(remove);
      article.append(header, body, actions); return article;
    }));
  }
  updateNotificationBadges();
}

async function loadHousehold(markVisible = false) {
  try {
    const response = await fetch(`/v1/household?profile=${encodeURIComponent(state.profile)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
    state.household = response.ok ? await response.json() : { status: "unavailable", profiles: [], messages: [], unread: 0 };
    renderHousehold();
  } catch (_error) {
    state.household = { status: "unavailable", profiles: [], messages: [], unread: 0 };
    renderHousehold();
  }
}

async function updateHouseholdMessage(messageId, operation) {
  const url = operation === "delete"
    ? `/v1/household/messages/${messageId}?profile=${encodeURIComponent(state.profile)}`
    : `/v1/household/messages/${messageId}/read`;
  const options = operation === "delete"
    ? { method: "DELETE", headers: { Accept: "application/json" } }
    : { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ profile: state.profile }) };
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    window.alert(payload.error || `Notification update failed: HTTP ${response.status}`);
    return;
  }
  await loadHousehold(false);
}

function renderAgents() {
  const cloudProviders = ["openai", "anthropic", "xai"].map((name) => state.atlas?.providers?.[name]).filter(Boolean);
  const configured = cloudProviders.filter((provider) => provider.available).length;
  document.getElementById("provider-count").textContent = cloudProviders.length ? `${configured} of 3 Cloud APIs Configured` : "Provider Status Unavailable";
  const local = state.atlas?.providers?.ollama;
  document.getElementById("local-provider-name").textContent = local?.available ? "Hermes · Local" : "Hermes · Local Unavailable";
}

function agentAnswerPresentation(content) {
  const original = String(content ?? "");
  const candidate = original.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1");
  try {
    const structured = JSON.parse(candidate);
    if (structured && typeof structured.recommendation === "string" && structured.recommendation.trim()) {
      return { text: structured.recommendation.trim(), details: original };
    }
  } catch (_) { /* Plain text and malformed JSON remain unchanged. */ }
  return { text: original, details: null };
}

function renderAgentAnswer(article, content) {
  const answer = agentAnswerPresentation(content);
  article.querySelector("p").textContent = answer.text;
  if (answer.details) {
    const details = document.createElement("details");
    details.className = "agent-answer-details";
    const summary = document.createElement("summary");
    summary.textContent = "Response details (proposals, not confirmed actions)";
    const original = document.createElement("pre");
    original.textContent = answer.details;
    details.append(summary, original);
    article.append(details);
  }
}

function appendAgentMessage(role, content) {
  const transcript = document.getElementById("agent-transcript");
  const article = document.createElement("article");
  article.className = `agent-message ${role}`;
  const label = document.createElement("span");
  label.textContent = role === "user" ? currentProfile().name : "Hermes";
  const body = document.createElement("p");
  body.textContent = content;
  article.append(label, body);
  transcript.append(article);
  transcript.scrollTop = transcript.scrollHeight;
  return article;
}

async function sendAgentMessage(message) {
  const send = document.getElementById("agent-chat-send");
  if (send.disabled) return;
  const routeStatus = document.getElementById("agent-route-status");
  appendAgentMessage("user", message);
  const pending = appendAgentMessage("assistant pending", "Thinking locally…");
  send.disabled = true;
  routeStatus.textContent = "Routing to the local model…";
  try {
    const response = await fetch("/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ message, mode: "auto", history: state.agentHistory.slice(-12) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    renderAgentAnswer(pending, payload.answer);
    pending.classList.remove("pending");
    state.agentHistory.push({ role: "user", content: message }, { role: "assistant", content: payload.answer });
    state.agentHistory = state.agentHistory.slice(-12);
    const route = payload.route || {};
    const provider = route.local_only ? "Hermes · Local" : "Hermes · Reviewed";
    document.getElementById("agent-route-title").textContent = route.escalation_recommended ? "Independent Review Suggested" : "Local Route Complete";
    document.getElementById("agent-route-detail").textContent = route.escalation_reason || "The local model completed this request.";
    routeStatus.textContent = `${provider} · No cloud spend`;
  } catch (error) {
    pending.querySelector("p").textContent = `I could not complete that request: ${error.message}`;
    pending.classList.remove("pending");
    pending.classList.add("error");
    routeStatus.textContent = "Local route failed · No cloud fallback was attempted";
  } finally {
    send.disabled = false;
  }
}

function fillPantryChips(id, values, emptyText) {
  const host = document.getElementById(id);
  if (!host) return;
  const items = Array.isArray(values) ? values : [];
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "pantry-empty";
    empty.textContent = emptyText;
    host.replaceChildren(empty);
    return;
  }
  host.replaceChildren(...items.map((value) => {
    const chip = document.createElement("span");
    chip.textContent = titleCase(value);
    return chip;
  }));
}

function renderPantryStaples(values) {
  const host = document.getElementById("pantry-staple-list");
  if (!host) return;
  const staples = Array.isArray(values) ? values : [];
  if (!staples.length) {
    const empty = document.createElement("p");
    empty.className = "pantry-empty";
    empty.textContent = "Staple Status Is Unavailable";
    host.replaceChildren(empty);
    return;
  }
  const labels = { OK: "On Hand", LOW: "Low", OUT: "Out", UNTRACKED: "Not Tracked" };
  host.replaceChildren(...staples.map((staple) => {
    const status = String(staple.status || "UNTRACKED").toUpperCase();
    const item = document.createElement("article");
    const name = document.createElement("span");
    const stateLabel = document.createElement("strong");
    item.className = `pantry-staple is-${status.toLowerCase()}`;
    name.textContent = displayName(staple.name, "Staple");
    stateLabel.textContent = labels[status] || "Unknown";
    item.append(name, stateLabel);
    return item;
  }));
}

function renderPantryPage() {
  const pantry = state.pantry;
  if (!pantry || pantry.status !== "healthy") {
    for (const id of ["pantry-missing-count", "pantry-cart-count", "pantry-meal-count", "pantry-staple-count"]) {
      const element = document.getElementById(id);
      if (element) element.textContent = "—";
    }
    fillPantryChips("pantry-missing-list", [], "Pantry Status Is Unavailable");
    fillPantryChips("pantry-cart-list", [], "Cart Status Is Unavailable");
    renderPantryStaples([]);
    return;
  }

  const missing = Number(pantry.missing_ingredients) || 0;
  const cart = Number(pantry.cart_items) || 0;
  const meals = Number(pantry.meals_planned) || 0;
  const staples = Array.isArray(pantry.staples) ? pantry.staples : [];
  const staplesOnHand = staples.filter((item) => ["OK", "LOW"].includes(String(item.status).toUpperCase())).length;
  const staplesLow = staples.filter((item) => String(item.status).toUpperCase() === "LOW").length;
  document.getElementById("pantry-missing-count").textContent = String(missing);
  document.getElementById("pantry-cart-count").textContent = String(cart);
  const cartNote = document.getElementById("pantry-cart-note");
  if (cartNote) cartNote.textContent = pantry.cart_status_label || "Current Grocery List";
  document.getElementById("pantry-meal-count").textContent = String(meals);
  const weekNote = document.getElementById("pantry-meal-count").nextElementSibling;
  if (weekNote) weekNote.textContent = pantry.week_label || "This Week";
  document.getElementById("pantry-staple-count").textContent = staples.length ? `${staplesOnHand} / ${staples.length}` : "—";
  document.getElementById("pantry-staple-note").textContent = staplesLow ? `${staplesLow} Running Low` : "Household Basics";
  fillPantryChips("pantry-missing-list", pantry.missing_items, "No Ingredients Missing for Planned Meals");
  fillPantryChips("pantry-cart-list", pantry.cart_items_preview, "No Items in the Grocery Cart");
  renderPantryStaples(staples);

  const mealHost = document.getElementById("pantry-meal-list");
  const planned = Array.isArray(pantry.planned_meals) ? pantry.planned_meals : [];
  if (!planned.length) {
    const empty = document.createElement("p");
    empty.className = "pantry-empty";
    empty.textContent = "No Meals Planned This Week";
    mealHost.replaceChildren(empty);
  } else {
    mealHost.replaceChildren(...planned.map((meal) => {
      const item = document.createElement("article");
      const when = document.createElement("span");
      const name = document.createElement("strong");
      when.textContent = `${safeText(meal.day, "This Week")} · ${safeText(meal.slot, "Meal")}`;
      name.textContent = displayName(meal.name, "Planned Meal");
      item.append(when, name);
      return item;
    }));
  }
}

function formatMoney(value, currency = "USD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch (_error) {
    return `$${amount.toFixed(2)}`;
  }
}

function travelDate(value) {
  if (!value) return "Date pending";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function travelDateRange(trip) {
  const start = travelDate(trip.start_date);
  const end = travelDate(trip.end_date);
  return start === end || end === "Date pending" ? start : `${start} – ${end}`;
}

function travelEmpty(copy) {
  return Object.assign(document.createElement("p"), { className: "empty-state", textContent: copy });
}

function travelEstimatedAmount(value, missingEstimates = 0) {
  if (Number(missingEstimates || 0) > 0) return "—";
  return formatMoney(value || 0);
}

function travelTimestamp(value) {
  if (!value) return "Not Recorded";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${travelDate(value)} · Time Not Recorded`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : `${parsed.toLocaleString("en-US", {timeZoneName: "short"})} (${value})`;
}

function travelEvidence(record) {
  const button = document.createElement("button"); button.type = "button"; button.className = "travel-help";
  button.textContent = "?";
  const title = record.title || record.name || record.merchant || record.provider || record.label || "Details";
  button.setAttribute("aria-label", `About ${title}`);
  button.addEventListener("click", () => openTravelInfo(title, record));
  return button;
}

function openTravelInfo(title, record) {
  const details = document.getElementById("travel-info-body"); details.replaceChildren();
  document.getElementById("travel-info-title").textContent = title;
  for (const key of ["detail", "notes", "basis", "hours", "guests", "scope", "uncertainty"]) {
    if (record[key]) details.append(Object.assign(document.createElement("p"), {textContent: record[key]}));
  }
  if (record.verified_at || record.observed_at) details.append(Object.assign(document.createElement("p"), {
    textContent: `Observed / Verified: ${travelTimestamp(record.verified_at || record.observed_at)}`,
  }));
  const refs = [...(Array.isArray(record.evidence) ? record.evidence : []), ...(record.source_url ? [record.source_url] : [])];
  for (const ref of refs) {
    const text = String(ref);
    const row = document.createElement("p");
    // Local evidence paths are references only, never arbitrary file-serving routes.
    if (/^https:\/\//i.test(text)) {
      const link = document.createElement("a"); link.href = text; link.textContent = text;
      link.target = "_blank"; link.rel = "noopener noreferrer"; row.append(link);
    } else row.textContent = text;
    details.append(row);
  }
  if (record.session_status) details.append(Object.assign(document.createElement("p"), {
    textContent: `Session: ${titleCase(record.session_status)} · Checked: ${travelTimestamp(record.session_checked_at)}`,
  }));
  for (const claim of record.claims || []) {
    details.append(Object.assign(document.createElement("h3"), {textContent: `${claim.provider} · ${claim.reference}`}));
    for (const text of [
      `Status: ${titleCase(claim.status)} · Owner: ${claim.owner}`,
      `Next Action: ${claim.next_action}`,
      claim.deadline ? `${titleCase(claim.deadline_kind)} Date: ${travelDate(claim.deadline)}` : "Deadline: Not Confirmed",
      claim.notes, `Evidence Checked: ${travelTimestamp(claim.verified_at)}`,
      ...(claim.evidence || []),
    ].filter(Boolean)) details.append(Object.assign(document.createElement("p"), {textContent: text}));
  }
  document.getElementById("travel-info-dialog").showModal();
}

function travelCosts(trips, kind) {
  const totals = {}; const rewards = {}; let unknown = 0; let unknownMiles = 0;
  for (const trip of trips) {
    const costs = trip.costs;
    if (!costs) return "—";
    for (const [currency, amount] of Object.entries(costs[kind] || {})) totals[currency] = (totals[currency] || 0) + amount;
    unknown += costs[kind === "paid" ? "unknown_paid" : "unknown_later"] || 0;
    if (kind === "paid") {
      unknownMiles += costs.unknown_miles || 0;
      for (const [program, amount] of Object.entries(costs.miles || {})) rewards[program] = (rewards[program] || 0) + amount;
    }
  }
  if (kind === "later" && unknown) return "—";
  const parts = Object.entries(totals).map(([currency, amount]) => formatMoney(amount, currency));
  parts.push(...Object.entries(rewards).map(([program, amount]) => `${amount.toLocaleString()} ${program}`));
  if (unknownMiles) parts.push("Reward Miles (Quantity Unrecorded)");
  if (unknown && !parts.length) return "—";
  return parts.join(" + ") || formatMoney(0);
}

function travelOperation(title, lines, record = {}) {
  const card = document.createElement("article"); card.className = "travel-operation";
  card.append(Object.assign(document.createElement("strong"), {textContent: title}));
  for (const line of lines.filter(Boolean).slice(0, 2)) card.append(Object.assign(document.createElement("p"), {textContent: line}));
  card.append(travelEvidence({...record, title, detail: lines.filter(Boolean).join("\n")}));
  return card;
}

function travelCaseGroups(cases) {
  // No household-specific claim identifiers are bundled. Preserve distinct cases.
  return cases;
}

function renderTravelOperations() {
  const travel = state.travel || {};
  const cases = travelCaseGroups(travel.cases || []);
  const knownIds = new Set((travel.cases || []).map(item => item.id));
  const items = [...(travel.attention || []).filter(item => !knownIds.has(item.case_id)),
    ...cases.filter(item => item.status !== "closed").map(item => ({...item, detail: item.next_action}))]
    .sort((a, b) => (a.deadline || "9999-12-31").localeCompare(b.deadline || "9999-12-31"));
  document.getElementById("travel-attention-list").replaceChildren(...(items.length ? items.map(item => {
    const card = travelOperation(item.title, [item.detail, `Owner: ${item.owner}`,
      item.deadline ? `${titleCase(item.deadline_kind || "Review")} Date: ${travelDate(item.deadline)}` : ""], item);
    if (item.trip_id && [...(travel.trips || []), ...(travel.past_trips || [])].some(trip => trip.id === item.trip_id)) {
      const link = document.createElement("a"); link.href = `#travel/trip/${encodeURIComponent(item.trip_id)}`; link.textContent = "Open Trip →"; card.append(link);
    }
    return card;
  }) : [travelEmpty("No Recorded Follow-Ups") ]));
  const past = travel.past_trips || [];
  document.getElementById("travel-past-list").replaceChildren(...past.map(trip => {
    const link = document.createElement("a"); link.href = `#travel/trip/${encodeURIComponent(trip.id)}`;
    link.textContent = `${trip.title} · ${travelDateRange(trip)} →`; return link;
  }));
  const closedCases = cases.filter(item => item.status === "closed");
  document.getElementById("travel-case-list").replaceChildren(...(closedCases.length ? closedCases.map(item => travelOperation(item.title, [
    `${item.provider} · ${item.reference || "Reference Not Recorded"} · ${titleCase(item.status)}`,
    `Owner: ${item.owner}`, `Next Action: ${item.next_action}`,
    item.deadline ? `${titleCase(item.deadline_kind)} Date: ${travelDate(item.deadline)}` : "Deadline: Not Confirmed",
  ], item)) : [travelEmpty(cases.length ? "Active Incidents Appear In Needs Attention Above" : "No Cases Recorded")]));
  const monitors = travel.monitor || [];
  document.getElementById("travel-monitor-list").replaceChildren(...(monitors.length ? monitors.map(item => travelOperation("Weekly Travel Review", [
    `${item.schedule} · ${item.timezone}`, `Configuration: ${titleCase(item.configuration_status || "Unknown")}`,
    `Last Completed Check: ${travelTimestamp(item.last_check_at)}`, `Last Result: ${titleCase(item.last_result || "Not Recorded")}`,
    `Next Check: ${travelTimestamp(item.next_check_at)}`, item.detail,
  ], {...item, verified_at: item.configured_at})) : [travelEmpty("Schedule Status Not Recorded")]));
  document.getElementById("travel-audit-list").replaceChildren(...(travel.audit || []).map(entry => {
    return travelOperation(entry.reason, [`Applied ${travelTimestamp(entry.applied_at)}`], entry);
  }));
}

function travelCountdown(trip, now = Date.now()) {
  const flights = (trip.reservations || []).filter(r => String(r.type).toLowerCase() === "flight" && r.status !== "cancelled");
  const segments = flights.flatMap(r => r.segments || []);
  const timed = segments.filter(s => /(?:Z|[+-]\d{2}:\d{2})$/.test(s.departure || "") && Number.isFinite(Date.parse(s.departure)))
    .sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure));
  const first = timed.find(s => Date.parse(s.departure) > now);
  const route = first || segments[0];
  const label = route?.from && route?.to ? `${route.from}–${route.to}` : trip.title;
  if (!first) return {label, text: timed.length ? "Trip In Progress Or Completed" : `Departs ${travelDate(trip.start_date)} · Time Unverified`};
  const hours = Math.floor((Date.parse(first.departure) - now) / 3_600_000);
  const days = Math.floor(hours / 24);
  const remaining = hours % 24;
  const duration = days ? `${days} ${days === 1 ? "day" : "days"}, ${remaining} ${remaining === 1 ? "hour" : "hours"}` : hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "less than an hour";
  return {label, text: `Departs in ${duration}`};
}


function renderTravelPage() {
  const travel = state.travel;
  const summary = travel?.summary || {};
  document.getElementById("travel-upcoming-count").textContent = travel?.status === "healthy" ? String(summary.upcoming || 0) : "—";
  document.getElementById("travel-ready-count").textContent = travel?.status === "healthy" ? `${summary.ready || 0} / ${summary.upcoming || 0}` : "—";
  document.getElementById("travel-charged-total").textContent = travel?.status === "healthy" ? travelCosts(travel.trips || [], "paid") : "—";
  document.getElementById("travel-later-total").textContent = travel?.status === "healthy" ? travelCosts(travel.trips || [], "later") : "—";
  document.getElementById("travel-observed").textContent = travel?.status === "healthy" ? `Ledger Updated: ${travelTimestamp(travel.ledger_updated_at)}` : "Trip Ledger Unavailable";
  renderTravelOperations();

  const host = document.getElementById("travel-trip-list");
  const trips = Array.isArray(travel?.trips) ? travel.trips : [];
  if (!trips.length) {
    host.replaceChildren(travelEmpty(travel?.status === "healthy" ? "No trips are currently planned. Atlas will add the first itinerary after the travel details are collected." : "The local trip ledger is unavailable."));
  } else {
    host.replaceChildren(...trips.map((trip) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "travel-trip-card";
      button.dataset.tripId = trip.id;
      button.setAttribute("aria-label", `Open ${trip.title}`);
      const identity = document.createElement("div");
      const title = document.createElement("strong");
      const tripType = document.createElement("b");
      const destination = document.createElement("small");
      title.textContent = displayName(trip.title, "Planned Trip");
      tripType.className = `travel-trip-type is-${trip.trip_type || "unclassified"}`;
      tripType.textContent = titleCase(trip.trip_type || "unclassified");
      destination.textContent = displayName(trip.destination, "Destination Pending");
      identity.append(title, tripType, destination);
      const dates = document.createElement("span");
      dates.className = "travel-trip-date";
      dates.textContent = travelDateRange(trip);
      const cost = document.createElement("span");
      cost.className = "travel-trip-cost";
      cost.textContent = travelCosts([trip], "paid");
      cost.append(Object.assign(document.createElement("small"), {
        textContent: `Estimated Due Later · ${travelCosts([trip], "later")}`,
      }));
      const readiness = document.createElement("span");
      readiness.className = `travel-status-pill${trip.readiness?.all_verified ? " is-ready" : ""}`;
      readiness.textContent = trip.readiness?.all_verified ? "Bookings Complete" : `${trip.readiness?.verified || 0}/${trip.readiness?.required || 0} Bookings Verified`;
      button.append(identity, dates, cost, readiness);
      button.addEventListener("click", () => openTravelTrip(trip.id));
      return button;
    }));
  }

  const sourceHost = document.getElementById("travel-source-list");
  const sources = Array.isArray(travel?.sources) ? travel.sources : [];
  sourceHost.replaceChildren(...(sources.length ? sources.map((source) => {
    const item = document.createElement("article");
    const provider = document.createElement("strong"); provider.textContent = source.provider;
    const count = document.createElement("b"); count.textContent = `${source.bookings_found} Booking${source.bookings_found === 1 ? "" : "s"}`;
    const detail = document.createElement("span"); detail.textContent = source.detail || "Account Checked";
    const verified = document.createElement("small"); verified.textContent = `Last Check: ${travelTimestamp(source.verified_at)}`;
    item.append(provider, count, detail, verified, travelEvidence(source));
    return item;
  }) : [travelEmpty("No travel accounts have been checked yet.")]));

  if (state.travelView === "loyalty") renderTravelLoyaltyPage();
  else if (state.currentTripId) renderTravelDetail(state.currentTripId);
  else showTravelOverview();
}

function showTravelOverview(updateHash = false) {
  state.currentTripId = null;
  state.travelView = "overview";
  document.getElementById("travel-overview").hidden = false;
  document.getElementById("travel-detail").hidden = true;
  document.getElementById("travel-loyalty-view").hidden = true;
  if (updateHash) history.replaceState(null, "", "#travel");
}

function openTravelTrip(tripId, updateHash = true) {
  state.currentTripId = tripId;
  state.travelView = "trip";
  if (!renderTravelDetail(tripId)) {
    if (state.travel === null) return;
    showTravelOverview(updateHash);
    return;
  }
  if (updateHash) history.replaceState(null, "", `#travel/trip/${encodeURIComponent(tripId)}`);
  window.scrollTo({ top: 0, behavior: "auto" });
}

function openTravelReview() {
  const trip = (state.travel?.trips || []).find(item => item.id === state.currentTripId);
  if (!trip) return;
  state.reviewTrip = {id: trip.id, revision: state.travel.revision};
  document.getElementById("travel-review-title").textContent = `Review ${trip.title}`;
  document.getElementById("travel-review-route").textContent = travelDateRange(trip);
  const labels = [["bookings", "Reservations & Flight Times"], ["documents", "Documents & Check-In Plan"], ["costs", "Costs & Payment"], ["transport", "Transport & Lounge Plan"]];
  const host = document.getElementById("travel-review-checklist");
  host.replaceChildren(...labels.map(([key, text]) => {
    const label = document.createElement("label"); const input = document.createElement("input");
    input.type = "checkbox"; input.value = key;
    input.addEventListener("change", () => { document.getElementById("travel-review-save").disabled = ![...host.querySelectorAll("input")].every(item => item.checked); });
    label.append(input, Object.assign(document.createElement("span"), {textContent: text})); return label;
  }));
  document.getElementById("travel-review-save").disabled = true;
  document.getElementById("travel-review-result").textContent = trip.readiness?.all_verified ? "" : "Complete Required Bookings First";
  document.getElementById("travel-review-dialog").showModal();
}

async function saveTravelReview() {
  const button = document.getElementById("travel-review-save"); button.disabled = true;
  const result = document.getElementById("travel-review-result"); result.textContent = "Saving…";
  try {
    const response = await fetch("/v1/travel/review", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({
      trip_id: state.reviewTrip.id, revision: state.reviewTrip.revision, confirmed: true, profile: state.profile,
      checks: [...document.querySelectorAll("#travel-review-checklist input:checked")].map(input => input.value),
    })});
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could Not Save Review");
    state.travel = data.travel; renderTravelPage();
    document.getElementById("travel-review-dialog").close();
  } catch (error) { result.textContent = error.message; button.disabled = false; }
}

function renderTravelDetail(tripId) {
  const trip = [...(state.travel?.trips || []), ...(state.travel?.past_trips || [])].find((item) => item.id === tripId);
  if (!trip) return false;
  document.getElementById("travel-overview").hidden = true;
  document.getElementById("travel-detail").hidden = false;
  document.getElementById("travel-loyalty-view").hidden = true;
  document.getElementById("travel-detail-title").textContent = trip.title;
  const travelers = trip.travelers?.length ? ` · ${trip.travelers.join(", ")}` : "";
  document.getElementById("travel-detail-meta").textContent = `${trip.destination} · ${travelDateRange(trip)}${travelers}`;
  const readiness = document.getElementById("travel-detail-readiness");
  readiness.className = `travel-readiness${trip.readiness?.all_verified ? " is-ready" : ""}`;
  readiness.textContent = trip.readiness?.all_verified ? "Bookings Complete" : "Bookings Need Verification";
  const tripType = document.getElementById("travel-detail-type");
  tripType.className = `travel-type-pill is-${trip.trip_type || "unclassified"}`;
  tripType.textContent = titleCase(trip.trip_type || "unclassified");
  document.getElementById("travel-detail-verified").textContent = `${trip.readiness?.verified || 0} / ${trip.readiness?.required || 0}`;
  document.getElementById("travel-detail-charged").textContent = travelCosts([trip], "paid");
  document.getElementById("travel-detail-charged-note").textContent = trip.costs?.unknown_paid ? "Fees —" : "Paid";
  document.getElementById("travel-cost-help").replaceChildren(travelEvidence({title: "Paid Amounts", notes: (trip.charges || []).filter(charge => ["paid", "charged"].includes(charge.status)).map(charge =>
    charge.redemption ? `${charge.merchant}: ${charge.miles == null ? "Mileage quantity not recorded" : `${charge.miles} miles`}; ${charge.cash_fees == null ? "cash fees not recorded" : `${formatMoney(charge.cash_fees, charge.currency)} cash fees`}.` : `${charge.merchant}: ${charge.amount_known ? formatMoney(charge.amount, charge.currency) : "amount not recorded"}.`).join("\n")}));
  document.getElementById("travel-detail-later").textContent = travelCosts([trip], "later");
  document.getElementById("travel-detail-card").textContent = trip.financials?.card_label || (trip.financials?.preferred_card_used ? "Configured Card" : "Review Card");
  const checks = trip.departure?.checks || [];
  const good = trip.departure?.good_to_go || trip.departure?.ready;
  document.getElementById("travel-departure-list").replaceChildren(
    Object.assign(document.createElement("strong"), {className: good ? "glance-ready" : "glance-review", textContent: good ? "✓ Good To Go" : "Not Reviewed"}),
    travelEvidence({title: "Trip Readiness", notes: trip.operator_review?.current ? `Reviewed by ${titleCase(trip.operator_review.reviewed_by)} on ${travelTimestamp(trip.operator_review.reviewed_at)}. Re-review if plans change. This is your confirmation, not airline or insurer verification.` : "Review reservations, timing, documents, costs and transport. Your confirmation is saved to Atlas; it does not verify insurance or check you into a flight.", verified_at: trip.operator_review?.reviewed_at}),
  );
  document.getElementById("travel-review-open").textContent = good ? "Review Again" : "Review & Confirm";
  const coverages = trip.coverage || [];
  document.getElementById("travel-coverage-list").replaceChildren(...(coverages.length ? coverages.map(coverage => travelOperation(
    coverage.name || "Coverage", [coverage.status === "reported" ? "Owner Reported" : titleCase(coverage.status || "Unverified"), coverage.effective_from ? `${travelDate(coverage.effective_from)} – ${travelDate(coverage.effective_to)}` : "Policy Details Pending"], coverage)) : [
      Object.assign(document.createElement("strong"), {textContent: "Not Verified"}),
      travelEvidence({title: "Coverage", notes: "Card payment does not establish insurance eligibility. Coverage scope and effective dates still need verification."})]));

  const reservationHost = document.getElementById("travel-reservation-list");
  const reservations = Array.isArray(trip.reservations) ? trip.reservations : [];
  reservationHost.replaceChildren(...(reservations.length ? reservations.map((reservation) => {
    const confirmed = ["confirmed", "reserved", "ticketed", "verified", "not-needed"].includes(reservation.status);
    const item = document.createElement("article");
    item.className = `travel-reservation${confirmed ? " is-confirmed" : ""}`;
    const title = document.createElement("strong"); title.textContent = reservation.type;
    const status = document.createElement("b"); status.textContent = reservation.status === "not-needed" ? "Not Needed" : confirmed ? "✓ Confirmed" : "Review";
    const provider = document.createElement("span"); provider.textContent = reservation.provider;
    const note = document.createElement("small");
    note.textContent = reservation.status === "not-needed" ? "" : reservation.confirmation ? `# ${reservation.confirmation}` : "Confirmation —";
    item.append(title, status, provider, note, travelEvidence({...reservation, title: `${reservation.type} · ${reservation.provider}`}));
    return item;
  }) : [travelEmpty("No reservation requirements have been entered for this trip.")]));

  const chargeHost = document.getElementById("travel-charge-list");
  const charges = Array.isArray(trip.charges) ? trip.charges : [];
  chargeHost.replaceChildren(...(charges.length ? charges.map((charge) => {
    const item = document.createElement("article");
    item.className = "travel-charge";
    const merchant = document.createElement("strong"); merchant.textContent = charge.merchant;
    const amount = document.createElement("b");
    amount.textContent = charge.redemption ? (charge.miles == null ? "Reward Miles (Quantity Unrecorded)" : `${Number(charge.miles).toLocaleString()} mi`) : (charge.amount_known
      ? formatMoney(charge.amount, charge.currency)
      : (["paid", "charged", "posted", "refunded"].includes(charge.status) ? "Amount Unavailable" : "Estimate Needed"));
    const category = document.createElement("span"); category.textContent = `${charge.category} · ${titleCase(charge.status)}`;
    const note = document.createElement("small"); note.textContent = charge.redemption ? `Fees ${charge.cash_fees == null ? "—" : formatMoney(charge.cash_fees, charge.currency)}` : charge.card;
    item.append(merchant, amount, category, note, travelEvidence({...charge, notes: `${charge.timing} · ${charge.card}${charge.redemption ? ` · ${charge.miles == null ? "Mileage quantity not recorded" : `${charge.miles} miles`}. ${charge.cash_fees == null ? "Cash fees not recorded." : ""}` : ""}`}));
    return item;
  }) : [travelEmpty("No trip charges have been recorded yet.")]));

  const expenses = trip.business_expenses || {};
  const business = trip.trip_type === "business";
  document.getElementById("travel-expense-board").hidden = !business;
  const expenseStatus = document.getElementById("travel-expense-status");
  expenseStatus.className = `travel-expense-status is-${expenses.submission_status || "not_applicable"}`;
  expenseStatus.textContent = business ? titleCase((expenses.submission_status || "no").replace("_", " ")) : "Not Applicable";
  document.getElementById("travel-expense-personal").hidden = business;
  document.getElementById("travel-expense-grid").hidden = !business;
  document.getElementById("travel-expense-submitted").textContent = titleCase(expenses.submission_status || "No");
  document.getElementById("travel-expense-reimbursed").textContent = formatMoney(expenses.reimbursed_amount || 0, expenses.currency || "USD");
  document.getElementById("travel-expense-remaining").textContent = formatMoney(expenses.remaining_amount || 0, expenses.currency || "USD");
  const expenseNotes = document.getElementById("travel-expense-notes");
  expenseNotes.textContent = expenses.notes || "";
  expenseNotes.hidden = !expenses.notes;
  const allowance = expenses.per_diem;
  document.getElementById("travel-per-diem-card").hidden = !allowance;
  document.getElementById("travel-per-diem-total").textContent = allowance ? formatMoney(allowance.total, expenses.currency || "USD") : "";
  document.getElementById("travel-per-diem-detail").textContent = allowance ? `${formatMoney(allowance.daily_rate, expenses.currency || "USD")} × ${allowance.days} Days · ${allowance.date_label} · ${allowance.status}` : "";

  const loungeHost = document.getElementById("travel-lounge-list");
  const flightSegments = reservations.flatMap((reservation) => Array.isArray(reservation.segments) ? reservation.segments : []);
  loungeHost.replaceChildren(...(flightSegments.length ? flightSegments.map((segment) => {
    const item = document.createElement("article");
    item.className = "travel-flight-lounges";
    const header = document.createElement("header");
    const route = document.createElement("div");
    const airports = document.createElement("strong");
    const flight = document.createElement("small");
    airports.textContent = `${safeText(segment.from, "Origin")} → ${safeText(segment.to, "Destination")}`;
    flight.textContent = `${segment.flight_number} · ${segment.departure_label}`;
    route.append(airports, flight);
    header.append(route);
    const loungeList = document.createElement("div");
    loungeList.className = "travel-segment-lounges";
    const lounges = Array.isArray(segment.lounges) ? segment.lounges : [];
    if (!lounges.length) loungeList.append(travelEmpty("No lounge availability has been verified for this airport yet."));
    else loungeList.append(...lounges.map((lounge) => {
      const loungeCard = document.createElement("section");
      loungeCard.className = `travel-lounge is-${lounge.access === "unavailable" ? "unavailable" : "verify"}`;
      const name = document.createElement("strong"); name.textContent = displayName(lounge.name, "Lounge");
      const badge = document.createElement("b"); badge.textContent = lounge.access === "unavailable" ? "✕ Unavailable" : lounge.access === "conditional" ? "Eligible With Reserve" : "Check Access";
      const location = document.createElement("span"); location.textContent = lounge.terminal;
      const hours = !lounge.hours || /verify|pending|unknown/i.test(lounge.hours) ? "Hours —" : lounge.hours;
      const basis = document.createElement("small"); basis.textContent = lounge.network === "USO" ? hours : `${lounge.basis || 'Access Needs Verification'} · ${hours}`;
      const plan = document.createElement("p"); plan.textContent = lounge.basis;
      loungeCard.append(name, badge, location, basis, plan, travelEvidence({...lounge, detail: `${lounge.guests}. Access is conditional on card, fare, remaining visits, operating hours, and capacity. Flight: ${segment.flight_number} · ${segment.cabin} · ${segment.fare}`}));
      return loungeCard;
    }));
    item.append(header, loungeList);
    return item;
  }) : [travelEmpty("Flight segments will show Delta Sky Club, Centurion, Sidecar, Escape Lounge, and USO options after the itinerary and card tier are verified.")]));

  const notes = document.getElementById("travel-notes");
  notes.hidden = !trip.notes;
  document.getElementById("travel-notes-copy").textContent = trip.notes || "";
  return true;
}

function openTravelLoyalty(updateHash = true) {
  state.currentTripId = null;
  state.travelView = "loyalty";
  renderTravelLoyaltyPage();
  if (updateHash) history.replaceState(null, "", "#travel/loyalty");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function renderTravelLoyaltyPage() {
  document.getElementById("travel-overview").hidden = true;
  document.getElementById("travel-detail").hidden = true;
  document.getElementById("travel-loyalty-view").hidden = false;
  const summary = state.travel?.loyalty_summary || {};
  document.getElementById("loyalty-program-count").textContent = String(summary.programs || 0);
  document.getElementById("loyalty-lounge-pass-count").textContent = summary.lounge_passes_remaining != null && Number.isFinite(Number(summary.lounge_passes_remaining))
    ? String(summary.lounge_passes_remaining)
    : "—";
  document.getElementById("loyalty-status-count").textContent = `${summary.statuses_verified || 0} / ${summary.programs || 0}`;
  document.getElementById("loyalty-progress-count").textContent = String(summary.programs_with_progress || 0);
  document.getElementById("travel-loyalty-observed").textContent = "Balances Reflect Each Provider’s Last Recorded Check";

  const host = document.getElementById("travel-loyalty-list");
  const programs = Array.isArray(state.travel?.loyalty) ? state.travel.loyalty : [];
  host.replaceChildren(...(programs.length ? programs.map((program) => {
    const card = document.createElement("article"); card.className = "travel-loyalty-card";
    const header = document.createElement("header");
    const identity = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = program.program;
    const member = document.createElement("small"); member.textContent = [program.member_id_masked, program.member_since ? `Member Since ${program.member_since}` : ""].filter(Boolean).join(" · ") || program.provider;
    identity.append(name, member);
    const status = document.createElement("b"); status.textContent = program.status || "Member";
    header.append(identity, status);
    const balance = program.balance_label && program.balance_label !== "Balance unavailable" ? document.createElement("div") : null;
    if (balance) {
      balance.className = "travel-loyalty-balance";
      const balanceLabel = document.createElement("span"); balanceLabel.textContent = "Current Balance";
      const balanceValue = document.createElement("strong"); balanceValue.textContent = program.balance_label;
      balance.append(balanceLabel, balanceValue);
    }
    const progress = document.createElement("div"); progress.className = "travel-loyalty-progress";
    const metrics = Array.isArray(program.qualification) ? program.qualification : [];
    progress.replaceChildren(...(metrics.length ? metrics.map((metric) => {
      const row = document.createElement("section");
      const label = document.createElement("strong"); label.textContent = titleCase(metric.label);
      const hasNumbers = Number.isFinite(Number(metric.current)) && Number.isFinite(Number(metric.target)) && Number(metric.target) > 0;
      const value = document.createElement("b"); value.textContent = hasNumbers ? `${metric.current} / ${metric.target}` : "Tracked";
      const detail = document.createElement("small"); detail.textContent = metric.detail || "Qualification Details Verified";
      row.append(label, value, detail);
      if (hasNumbers) {
        const meter = document.createElement("i");
        meter.style.setProperty("--progress", `${Math.min(100, Math.max(0, Number(metric.current) / Number(metric.target) * 100))}%`);
        row.append(meter);
      }
      return row;
    }) : [travelEmpty(program.notes || "Qualification progress was not displayed by this provider.")]));
    const benefits = document.createElement("p"); benefits.className = "travel-loyalty-benefits"; benefits.textContent = (program.benefits || []).join(" · ") || "Benefits are not yet recorded.";
    const verified = document.createElement("small"); verified.className = "travel-loyalty-verified"; verified.textContent = `Verified: ${travelTimestamp(program.verified_at)}`;
    card.append(header, ...(balance ? [balance] : []), progress, benefits, verified, travelEvidence(program));
    return card;
  }) : [travelEmpty("No loyalty programs have been recorded yet.")]));
}

function energyCards() {
  const energy = state.energy;
  if (!energy || energy.status !== "healthy") {
    return [
      ["Solar Production", "—", "Powerwall Data Unavailable"],
      ["House Load", "—", "Awaiting Local Service"],
      ["Battery", "—", "State Of Charge Unavailable"],
      ["Grid", "—", "Flow Unavailable"],
    ];
  }
  const gridValue = Math.abs(Number(energy.grid_kw));
  return [
    ["Solar Production", formatNumber(energy.solar_kw, " kW", 2), `${formatNumber(energy.today?.solar_kwh, " kWh")} Generated Today`],
    ["House Load", formatNumber(energy.home_kw, " kW", 2), `${formatNumber(energy.today?.home_kwh, " kWh")} Used Today · Athena May Be Included`],
    ["Battery", formatNumber(energy.battery_pct, "%"), `${energy.charging ? "Charging" : "Holding"} · ${formatNumber(energy.reserve_pct, "%")} Reserve`],
    ["Grid", formatNumber(gridValue, " kW", 2), `${titleCase(safeText(energy.grid_direction))} · Grid ${energy.grid_up ? "Online" : "Offline"}`],
  ];
}


function statusClass(value) {
  if (["healthy", "running", "resolved", "current", "online"].includes(value)) return "healthy";
  if (["degraded", "monitoring", "unknown"].includes(value)) return "degraded";
  return "unhealthy";
}

function statusItem(item, detail) {
  const article = document.createElement("article");
  article.className = "status-item";
  const copy = document.createElement("span");
  const title = document.createElement("b");
  const note = document.createElement("small");
  const badge = document.createElement("span");
  title.textContent = displayName(item.name || item.id || item.item, "Unnamed Control");
  note.textContent = safeText(detail);
  badge.textContent = safeText(item.status || item.state);
  badge.className = `state ${statusClass(item.status || item.state)}`;
  copy.append(title, note);
  article.append(copy, badge);
  return article;
}

function fillList(id, items, detail) {
  const host = document.getElementById(id);
  host.replaceChildren(...items.map((item) => statusItem(item, detail(item))));
}

function setOverall(status, message) {
  const mode = statusClass(status);
  const dot = document.getElementById("overall-dot");
  dot.className = `pulse-dot ${mode === "unhealthy" ? "is-error" : mode === "degraded" ? "is-degraded" : ""}`;
  document.getElementById("overall-label").textContent = message;
  document.getElementById("systems-state").textContent = status;
  document.querySelector(".systems-summary article").className = mode === "unhealthy" ? "is-error" : mode === "degraded" ? "is-degraded" : "";
}

function render(data) {
  state.status = data;
  const summary = data.summary || {};
  const failures = data.failures || [];
  const requiredSystemsOffline = (data.services || []).filter((service) => service.required && service.status !== "healthy").length;
  const optionalSystemsOffline = (data.services || []).filter((service) => !service.required && service.status !== "healthy").length;
  const actionableFailures = failures.filter((failure) => failure.status !== "monitoring");
  const systemMessage = requiredSystemsOffline > 0
    ? `${requiredSystemsOffline} System${requiredSystemsOffline === 1 ? "" : "s"} Offline`
      : data.health_controls?.status !== "current"
        ? "Health Check Needs Update"
      : actionableFailures.length > 0
      ? `${actionableFailures.length} System Issue${actionableFailures.length === 1 ? "" : "s"}`
      : optionalSystemsOffline > 0
        ? `Core Online · ${optionalSystemsOffline} Optional Offline`
      : "All Systems Online";
  const freshnessOnly = actionableFailures.length > 0 && actionableFailures.every(f => f.source === "health_controls");
  setOverall(freshnessOnly ? "degraded" : actionableFailures.length === 0 ? "healthy" : data.status, systemMessage);
  document.getElementById("last-updated").textContent = `Last Updated ${humanTime(data.observed_at)}`;
  document.getElementById("systems-observed").textContent = humanTime(data.observed_at);
  document.getElementById("systems-host").textContent = safeText(data.host, "Atlas Server");
  const climate = state.home?.climate || {};
  document.getElementById("metric-hvac").textContent = formatNumber(climate.current_temperature, climate.unit || "°F", 0);
  document.getElementById("metric-hvac-note").textContent = climate.target_temperature == null ? "Temperature Controls" : `Set To ${formatNumber(climate.target_temperature, climate.unit || "°F", 0)}`;
  const environment = homeEnvironmentCompactSummary();
  document.getElementById("metric-environment").textContent = environment[0];
  document.getElementById("metric-environment-note").textContent = environment[1];
  const camerasMetric = document.getElementById("metric-cameras");
  if (camerasMetric) camerasMetric.textContent = "";
  const camerasNote = document.getElementById("metric-cameras-note");
  if (camerasNote) camerasNote.textContent = "";
  document.getElementById("metric-pantry").textContent = pantryMissingIngredientsCopy();
  document.getElementById("metric-pantry-note").textContent = "";
  document.getElementById("metric-energy").textContent = formatNumber(state.energy?.battery_pct, "%", 0);
  document.getElementById("metric-energy-note").textContent = state.energy?.status === "healthy" ? `${formatNumber(state.energy.solar_kw, " kW", 1)} Solar` : "Solar And Storage";
  updateNotificationBadges();
  fillList("service-list", data.services || [], (item) => item.http_status ? `HTTP ${item.http_status} · ${Math.round(item.latency_ms || 0)} ms` : item.error || "No response");
  fillList("container-list", data.containers || [], (item) => item.required ? "Required runtime" : "Rollback or optional runtime");
  fillList("control-list", data.health_controls?.items || [], (item) => item.detail || item.topic || "Health evidence");
  renderPantryPage();
}

function renderEnergyPage() {
  const charge = state.energy?.vehicle_charge_snapshot;
  window.AtlasEnergy?.renderChargingHistory(charge);
  const chargeSection = document.getElementById("energy-athena-snapshot");
  if (chargeSection) {
    chargeSection.hidden = !charge;
    document.getElementById("energy-athena-waiting").hidden = Boolean(charge);
    if (charge) {
      const observedAt = charge.timestamp || charge.checked_at;
      const basic = charge.status === "periodic_sample";
      const age = observedAt ? Date.now() - new Date(observedAt).getTime() : Infinity;
      const saved = age > 45 * 60000 || charge.collection_status !== "Updated";
      document.getElementById("energy-athena-observed").textContent = basic
        ? `${charge.collection_status} · ${observedAt ? (saved ? "Last Reading: " : "Read: ") + new Date(observedAt).toLocaleString() : "Waiting For A Reading"}`
        : `Snapshot: ${new Date(observedAt).toLocaleString()} · Not Live`;
      const entries = [["Athena Battery", formatNumber(charge.battery_level, "%", 0)],
        ["Charge Limit", formatNumber(charge.charge_limit_soc, "%", 0)],
        ["Charging Power", formatNumber(charge.charger_power, " kW", 1)],
        ["Rated Range", formatNumber(charge.battery_range, " mi", 0)]];
      document.getElementById("energy-athena-readings").replaceChildren(...entries.map(([label,value]) => {
        const card = document.createElement("article"); card.className = "metric-card";
        const title = document.createElement("span"); title.textContent = label;
        const reading = document.createElement("strong"); reading.textContent = value;
        card.append(title,reading); return card;
      }));
      document.getElementById("energy-athena-state").textContent = `${charge.charging_state} · ${formatNumber(charge.charge_energy_added, " kWh", 2)} In Reported Session. ${basic ? (charge.automatic_collection ? "Checks Every 30 Minutes When Awake. No Wake Or Control Commands." : "Automatic Updates Paused. Controls Off.") : "Automatic Updates And Controls Are Off."}`;
    }
  }
  const vehicleNote = document.getElementById("energy-vehicle-connection");
  if (vehicleNote) {
    const inventory = state.energy?.tesla_vehicles;
    const names = (inventory?.vehicles || []).map(v => v.name).join(", ");
    const observed = inventory?.observed_at ? ` Checked ${new Date(inventory.observed_at).toLocaleString()}.` : "";
    vehicleNote.textContent = charge?.status === "periodic_sample"
      ? "Basic Athena readings share the existing Tesla connection. Saved readings are timestamped; Tesla still controls Charge on Solar. No solar-source attribution is inferred."
      : charge
      ? "Athena charging-data access verified by a successful read. The displayed snapshot does not refresh automatically and is not used as historical energy or solar attribution. Tesla remains the charging controller."
      : inventory?.status === "ready"
      ? `Tesla Vehicle Access Verified: ${names || "No vehicles returned"}.${observed} Automatic vehicle collection is not configured. Tesla controls Charge on Solar.`
      : "Tesla vehicle discovery has not been verified for this session. Live vehicle readings and commands remain disabled. Existing solar and Powerwall data are unaffected.";
  }
  const cards = energyCards();
  const ids = ["solar", "home", "battery", "grid"];
  cards.forEach((card, index) => {
    document.getElementById(`energy-page-${ids[index]}`).textContent = card[1];
  });
  document.getElementById("energy-page-solar-note").textContent = cards[0][2];
  document.getElementById("energy-page-battery-note").textContent = cards[2][2];
  const energyReady = state.energy?.status === "healthy";
  const gridQuiet = energyReady && typeof state.energy.grid_kw === "number" && Number.isFinite(state.energy.grid_kw) && Math.abs(state.energy.grid_kw) < .05;
  document.getElementById("energy-page-grid-note").textContent = gridQuiet ? "No Exchange · Grid Online" : cards[3][2];
  document.getElementById("energy-observed").textContent = state.energy?.polled_at ? `Updated ${humanTime(state.energy.polled_at)}` : "Local data unavailable";
  document.getElementById("energy-exterior-solar-flow").textContent = energyReady && typeof state.energy.solar_kw === "number" && Number.isFinite(state.energy.solar_kw)
    ? `Solar Producing · ${formatNumber(state.energy.solar_kw, " kW", 2)}` : "Solar Reading Unavailable";
  document.getElementById("energy-exterior-battery-flow").textContent = energyReady
    ? `Powerwall · ${state.energy.charging ? "Charging" : "Not Charging"}` : "Powerwall Reading Unavailable";
  document.getElementById("energy-exterior-athena-battery").textContent = charge ? `${formatNumber(charge.battery_level, "%", 0)} Battery` : "— Battery";
  document.getElementById("energy-exterior-athena-range").textContent = charge ? `${formatNumber(charge.battery_range, " mi", 0)} Range` : "— Range";
  document.getElementById("energy-exterior-athena-power").textContent = charge && typeof charge.charger_power === "number" && Number.isFinite(charge.charger_power)
    ? `${formatNumber(charge.charger_power, " kW", 1)} At Last Check` : "— At Last Check";
  document.getElementById("energy-exterior-athena-state").textContent = charge ? safeText(charge.charging_state, "State Unavailable") : "Reading Unavailable";
  const chargeObserved = charge?.timestamp || charge?.checked_at;
  const chargeDate = chargeObserved ? new Date(chargeObserved) : null;
  const chargeTime = chargeDate && Number.isFinite(chargeDate.getTime()) ? chargeDate.toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : null;
  document.getElementById("energy-exterior-athena-observed").textContent = chargeTime
    ? `${charge?.collection_status === "Updated" ? "Checked" : "Saved Reading"} ${chargeTime} · Periodic Snapshot`
    : "Periodic Snapshot · Not Available";

  const monthly = state.energy?.monthly || {};
  const cycleStart = monthly.cycle_start ? new Date(`${monthly.cycle_start}T12:00:00`) : null;
  const cycleEnd = monthly.cycle_end ? new Date(`${monthly.cycle_end}T12:00:00`) : null;
  const cycleText = cycleStart && cycleEnd
    ? `${cycleStart.toLocaleDateString([], { month: "short", day: "numeric" })} – ${cycleEnd.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} · Day ${Math.round(Number(monthly.days_elapsed) || 0)} of ${Math.round(Number(monthly.cycle_days) || 0)}`
    : "Billing dates unavailable";
  document.getElementById("energy-cycle-range").textContent = cycleText;
  const financials = [
    ["Imported to Date", formatNumber(monthly.import_kwh, " kWh")],
    ["Exported to Date", formatNumber(monthly.export_kwh, " kWh")],
    ["Projected Import", formatNumber(monthly.projected_import_kwh, " kWh")],
    ["Projected Export", formatNumber(monthly.projected_export_kwh, " kWh")],
    ["Energy Charge", monthly.energy_charge == null ? "—" : `$${Number(monthly.energy_charge).toFixed(2)}`],
    ["Export Credit", monthly.export_credit == null ? "—" : `$${Number(monthly.export_credit).toFixed(2)}`],
    ["Projected Bill", monthly.estimated_bill == null ? "—" : `$${Number(monthly.estimated_bill).toFixed(2)}`],
    ["Credit Bank", monthly.bank_balance == null ? "—" : `$${Number(monthly.bank_balance).toFixed(2)}`],
  ];
  document.getElementById("energy-financial-list").replaceChildren(...financials.map(([label, value]) => {
    const article = document.createElement("article");
    article.className = "metric-card energy-financial-card";
    const title = document.createElement("span"); title.textContent = label;
    const total = document.createElement("strong"); total.textContent = value;
    article.append(title, total);
    return article;
  }));
  const rates = state.energy?.rates || {};
  document.getElementById("utility-rate-status").textContent = rates.energy == null ? "UTILITY account rates require weekly verification." : `Configured energy rate $${Number(rates.energy).toFixed(3)}/kWh · Buyback $${Number(rates.buyback || 0).toFixed(3)}/kWh · Review weekly against UTILITY.`;
  const current = state.forecast?.current || {};
  document.getElementById("top-weather-icon").textContent = safeText(current.icon, "☼");
  document.getElementById("top-weather-value").textContent = state.forecast?.status === "healthy" ? formatNumber(current.temp_f, "°F", 0) : "—";
  document.getElementById("top-weather-detail").textContent = state.forecast?.status === "healthy" ? titleCase(safeText(current.desc, "Weather")) : "Weather";
}

function renderEnergyHistory() {
  window.AtlasEnergy.render();
}

async function loadEnergyHistory(rangeName) {
  await window.AtlasEnergy.load();
}

function configureExternalLinks() {
  document.getElementById("open-utility").href = externalDestinations.utility;
  document.getElementById("open-sysmon").href = householdUrl(17084, "/d/jarvis-sysmon/jarvis-sysmon-security-monitor?orgId=1&from=now-1h&to=now&timezone=browser&refresh=30s");
}

function renderEntityInventory() {
  const host = document.getElementById("entity-list");
  const inventory = state.inventory;
  if (!inventory || inventory.status !== "healthy") {
    host.replaceChildren(Object.assign(document.createElement("p"), { className: "empty-state", textContent: "Home Assistant inventory is unavailable." }));
    return;
  }
  const summary = inventory.summary || {};
  document.getElementById("entity-summary").textContent = `${summary.available || 0} Pertinent Entities · ${summary.filtered || 0} Noisy or Unavailable Hidden`;
  const backup = inventory.backup || {};
  const backupHost = document.getElementById("backup-health");
  backupHost.className = `backup-health${backup.status === "needs_attention" ? " needs-attention" : ""}`;
  const backupTitle = document.createElement("strong"); backupTitle.textContent = "Backup Health";
  const backupDetail = document.createTextNode(backup.detail || "Backup status unavailable");
  backupHost.replaceChildren(backupTitle, backupDetail);
  const select = document.getElementById("entity-category");
  if (select.options.length === 1) {
    for (const category of Object.keys(inventory.groups || {})) {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = inventory.group_labels?.[category] || titleCase(category);
      select.append(option);
    }
  }
  const category = select.value;
  const query = document.getElementById("entity-search").value.trim().toLowerCase();
  const entities = Object.entries(inventory.groups || {}).flatMap(([group, values]) => values.map((item) => ({ ...item, category: group }))).filter((item) => item.availability === "available" && (category === "all" || item.category === category) && (!query || `${item.name} ${item.entity_id} ${item.state}`.toLowerCase().includes(query)));
  const cards = entities.slice(0, 200).map((item) => {
    const article = document.createElement("article");
    article.className = item.availability === "available" ? "" : "is-unavailable";
    article.classList.toggle("control-entity", Boolean(item.controllable));
    article.classList.toggle("is-on", item.controllable && item.state === "on");
    const name = document.createElement("strong"); name.textContent = displayName(item.name, "Unnamed Device");
    const value = document.createElement(item.controllable ? "button" : "span");
    if (item.controllable) {
      value.type = "button";
      value.className = `entity-toggle${item.state === "on" ? " is-on" : ""}`;
      value.textContent = item.state === "on" ? "On" : "Off";
      value.addEventListener("click", () => setHomeControl(item, item.state !== "on"));
    } else value.textContent = `${safeText(item.state)}${item.unit ? ` ${item.unit}` : ""}`;
    const meta = document.createElement("small"); meta.textContent = `${inventory.group_labels?.[item.category] || titleCase(item.category)} · ${item.entity_id}`;
    article.append(name, value, meta);
    return article;
  });
  host.replaceChildren(...cards);
  if (entities.length > 200) host.append(Object.assign(document.createElement("p"), { className: "empty-state", textContent: `Showing 200 of ${entities.length} matching entities. Refine the search to see more.` }));
}

async function setHomeControl(item, enabled) {
  try {
    await sendHomeControl(item.entity_id, enabled);
    renderEntityInventory();
    renderQuickLights();
    window.setTimeout(refreshHomeInventory, 650);
    return true;
  } catch (error) {
    window.alert(`Home control was not changed: ${error.message}`);
    renderQuickLights();
    return false;
  }
}

async function refreshHomeInventory() {
  try {
    const response = await fetch("/v1/home/entities", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return;
    state.inventory = await response.json();
    renderEntityInventory();
    renderQuickLights();
  } catch (_error) {
    // The accepted state remains visible; the normal refresh cycle will retry.
  }
}

function renderSecurityPage() {
  const ids = state.ids;
  const armed = Boolean(ids?.armed);
  document.getElementById("ids-state").textContent = !ids ? "Vacation IDS · Checking Coverage" : armed ? "Vacation IDS Armed" : "Vacation IDS Disarmed";
  document.getElementById("ids-detail").textContent = !ids ? "Reading configured motion sensors…" : ids.detail || `${ids.coverage?.available || 0} of ${ids.coverage?.total || 0} sensors available.`;
  document.getElementById("ids-mode").textContent = armed ? "Armed" : "Disarmed";
  document.getElementById("ids-panel").classList.toggle("is-armed", armed);
  document.getElementById("ids-arm").textContent = armed ? "Disarm Vacation IDS" : "Arm Vacation IDS";
  document.getElementById("ids-sensors").replaceChildren(...(ids?.sensors || []).map((sensor) => {
    const span = document.createElement("span");
    span.className = sensor.availability !== "available" ? "is-unavailable" : sensor.state === "on" ? "is-active" : "";
    const updated = sensor.updated_at ? ` · ${humanTime(sensor.updated_at)}` : "";
    span.textContent = `${sensor.name}${sensor.type ? ` · ${sensor.type}` : ""}: ${sensor.availability !== "available" ? "Unavailable" : sensor.state === "on" ? (sensor.type?.includes("Contact") ? "Open" : "Motion") : (sensor.type?.includes("Contact") ? "Closed" : "Clear")}${updated}`;
    return span;
  }));
  renderCyberHealth();
}

function renderCyberHealth() {
  const cyber = state.cyber || {};
  const summary = cyber.summary || {};
  const fresh = cyber.fresh;
  const channels = cyber.channels || [];
  document.getElementById("security-server-summary").textContent = `${cyberLabel(cyber)}${cyber.observed_at ? ` · Checked ${humanTime(cyber.observed_at)}` : ""}`;
  const metrics = [
    ["Protection Checks", fresh ? `${summary.passed} / ${summary.total}` : "—"],
    ["Event Sources", fresh ? `${channels.filter(c => c.status === "current" && !c.capped).length} / 3` : "—"],
    ["High Priority · 24h", fresh ? String(summary.high) : "—"],
    ["Review · 24h", fresh ? String(summary.review) : "—"],
    ["Home Network", "Deferred"],
  ].map(([label, value]) => {
    const article = document.createElement("article");
    const strong = document.createElement("strong"); strong.textContent = value;
    const name = document.createElement("span"); name.textContent = label;
    article.append(strong, name);
    return article;
  });
  document.getElementById("security-gauge-grid").replaceChildren(...metrics);
  const controls = (cyber.checks || []).map(c => ({id:c.label, status:!fresh ? "unknown" : c.status === "pass" ? "healthy" : c.status === "attention" ? "unhealthy" : "unknown", detail:!fresh ? "Waiting For Fresh Evidence" : c.status === "pass" ? "Verified Enabled / Current" : "Review This Check"}));
  controls.push(...channels.map(c => ({id:`${c.name} Events`, status:!fresh ? "unknown" : c.status === "current" && !c.capped ? "healthy" : "unknown", detail:!fresh ? "Waiting For Collector" : c.capped ? "Event Limit Reached · Coverage Gap" : ({current:"Readable · Quiet Is OK", access_denied:"Administrator Activation Needed", unavailable:"Not Available",disabled:"Disabled"}[c.status] || "Unknown")})));
  fillList("security-control-list", controls, c => c.detail);
  const host = document.getElementById("cyber-finding-list");
  const findings = cyber.findings || [];
  host.replaceChildren(...findings.map(f => statusItem({id:f.title,status:f.severity === "high" ? "unhealthy" : "degraded"}, `${f.subject} · ${f.count} Events · ${humanTime(f.last_seen)} · Review Context`)));
  if (!findings.length) {
    const empty = document.createElement("p");
    empty.textContent = fresh ? "No Rule Matches In Collected Events · Coverage Shown Above" : "Waiting For Fresh Collection";
    host.append(empty);
  }
  const gap = document.getElementById("cyber-coverage-note");
  gap.textContent = `${(cyber.coverage_gaps || []).length} Collection Gaps · 7-Day Retention · Atlas PC Only`;
}

async function setVacationIDS(armed, confirmation = null) {
  const status = document.getElementById("ids-control-status");
  status.textContent = armed ? "Arming…" : "Disarming…";
  try {
    const response = await fetch("/v1/security/vacation-ids", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ armed, confirmation }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.ids = payload;
    status.textContent = armed ? "Vacation IDS armed. Motion alerts will be sent to Alex's phone." : "Vacation IDS disarmed.";
    document.getElementById("ids-confirm").hidden = true;
    document.getElementById("ids-cancel").hidden = true;
    document.getElementById("ids-arm").hidden = false;
    renderSecurityPage();
  } catch (error) {
    status.textContent = error.message || "Vacation IDS control failed.";
  }
}

function temperatureText(value, digits = 1) {
  return formatNumber(value, state.home?.climate?.unit || "°F", digits);
}

function environmentReading(id) {
  const environment = state.home?.environment || {};
  return Object.values(environment).flat().find((reading) => reading.id === id);
}

function homeEnvironmentSummary() {
  const selected = [
    ["east-hallway-temperature", "Hall"],
    ["office-temperature", "Office"],
    ["living-room-temperature", "Living"],
    ["primary-bedroom-temperature", "Bedroom"],
  ].map(([id, label]) => [environmentReading(id), label]).filter(([reading]) => reading && Number.isFinite(Number(reading.value)));
  if (!selected.length) return ["—", "Household climate data unavailable"];

  const values = selected.map(([reading]) => Number(reading.value));
  const unit = selected[0][0].unit || state.home?.climate?.unit || "°F";
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.abs(high - low) < 0.05
    ? formatNumber(low, unit, 1)
    : `${formatNumber(low, "", 1)}–${formatNumber(high, unit, 1)}`;
  const details = selected.map(([reading, label]) => `${label} ${Math.round(Number(reading.value))}°`);
  const aqi = environmentReading("indoor-aqi");
  if (aqi && Number.isFinite(Number(aqi.value))) details.push(`AQI ${Math.round(Number(aqi.value))}`);
  return [range, details.join(" · ")];
}

function homeEnvironmentCompactSummary() {
  const [range] = homeEnvironmentSummary();
  if (range === "—") return ["—", "Indoor Data Unavailable"];
  const aqi = environmentReading("indoor-aqi");
  const aqiValue = aqi && Number.isFinite(Number(aqi.value)) ? Math.round(Number(aqi.value)) : null;
  return [range, aqiValue == null ? "Indoor Temperature Range" : `Indoor Range · AQI ${aqiValue}`];
}

function readingText(reading, digits = 1) {
  if (!reading) return "—";
  const unit = reading.unit || "";
  const separator = unit && !unit.startsWith("°") && unit !== "%" ? " " : "";
  return formatNumber(reading.value, `${separator}${unit}`, digits);
}

function fillEnvironmentReadings(id, readings, emptyText) {
  const host = document.getElementById(id);
  if (!host) return;
  if (!Array.isArray(readings) || !readings.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    host.replaceChildren(empty);
    return;
  }
  host.replaceChildren(...readings.map((reading) => {
    const article = document.createElement("article");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = reading.label;
    value.textContent = readingText(reading, 1);
    article.append(label, value);
    return article;
  }));
}

function renderEnvironmentSnapshot() {
  const host = document.getElementById("environment-snapshot");
  if (!host) return;
  const readings = [
    environmentReading("office-temperature"),
    environmentReading("living-room-temperature"),
    environmentReading("primary-bedroom-temperature"),
    environmentReading("outdoor-temperature"),
  ].filter(Boolean);
  if (!readings.length) {
    host.replaceChildren();
    return;
  }
  host.replaceChildren(...readings.map((reading) => {
    const article = document.createElement("article");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = reading.label;
    value.textContent = readingText(reading);
    article.append(label, value);
    return article;
  }));
}

function weatherTime(value, weekday = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat([], weekday
    ? { weekday: "short" }
    : { hour: "numeric", minute: "2-digit" }
  ).format(date);
}

function renderOutdoorWeather() {
  const forecast = state.forecast || {};
  const healthy = forecast.status === "healthy";
  const current = healthy ? forecast.current || {} : {};
  const daily = healthy && Array.isArray(forecast.daily) ? forecast.daily : [];
  const hourlySource = healthy && Array.isArray(forecast.hourly) ? forecast.hourly : [];
  const now = Date.now();
  const hourly = hourlySource.filter((item) => {
    const at = new Date(item.time).getTime();
    return Number.isFinite(at) && at >= now - 30 * 60 * 1000;
  }).slice(0, 24);
  const today = daily[0] || {};
  const currentHour = hourly[0] || hourlySource[0] || {};

  const radarImage = document.getElementById("weather-radar-image");
  if (radarImage?.dataset.radarSrc) {
    const radarBucket = String(Math.floor(Date.now() / (5 * 60 * 1000)));
    if (radarImage.dataset.radarBucket !== radarBucket) {
      radarImage.dataset.radarBucket = radarBucket;
      radarImage.src = `${radarImage.dataset.radarSrc}?v=${radarBucket}`;
    }
  }

  const location = document.getElementById("weather-location");
  if (location) location.textContent = healthy
    ? `${safeText(forecast.location, "Copperas Cove, TX")} · Updated ${humanTime(forecast.observed_at)}`
    : "Outdoor Weather Unavailable";
  document.getElementById("weather-now-icon").textContent = safeText(current.icon, "☼");
  document.getElementById("weather-now-temp").textContent = healthy ? formatNumber(current.temp_f, "°F", 0) : "—";
  document.getElementById("weather-now-condition").textContent = healthy ? titleCase(safeText(current.desc, "Current Conditions")) : "Weather Unavailable";
  document.getElementById("weather-now-feels").textContent = healthy ? `Feels Like ${formatNumber(current.feels_like_f, "°F", 0)}` : "Check The Weather Service";

  const facts = healthy ? [
    ["Today's High / Low", `${formatNumber(today.temp_max, "°", 0)} / ${formatNumber(today.temp_min, "°", 0)}`],
    ["Humidity", formatNumber(current.humidity, "%", 0)],
    ["Wind", `${safeText(current.wind_dir, "—")} ${formatNumber(current.wind_mph, " mph", 0)}`],
    ["Gusts", formatNumber(current.wind_gust_mph, " mph", 0)],
    ["Rain Now", formatNumber(current.precip_in, " in", 2)],
    ["Visibility", formatNumber(current.visibility_mi, " mi", 1)],
    ["UV Index", formatNumber(currentHour.uv_index, "", 1)],
    ["Sunrise / Sunset", `${weatherTime(today.sunrise)} / ${weatherTime(today.sunset)}`],
  ] : [];
  const factHost = document.getElementById("weather-fact-grid");
  if (factHost) factHost.replaceChildren(...(facts.length ? facts.map(([labelText, valueText]) => {
    const article = document.createElement("article");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = labelText;
    value.textContent = valueText;
    article.append(label, value);
    return article;
  }) : [Object.assign(document.createElement("p"), { className: "empty-state", textContent: "Current Conditions Are Unavailable." })]));

  const alerts = healthy && Array.isArray(state.energy?.weather_alerts) ? state.energy.weather_alerts : [];
  const alertHost = document.getElementById("weather-alert-list");
  if (alertHost) {
    alertHost.hidden = !alerts.length;
    alertHost.replaceChildren(...alerts.map((alert) => {
      const article = document.createElement("article");
      const title = document.createElement("strong");
      const detail = document.createElement("span");
      title.textContent = titleCase(safeText(alert.event, "Weather Alert"));
      detail.textContent = safeText(alert.headline, alert.severity ? `${alert.severity} Severity` : "Active For The Local Area");
      article.append(title, detail);
      return article;
    }));
  }

  const hourlyHost = document.getElementById("weather-hourly-list");
  if (hourlyHost) hourlyHost.replaceChildren(...(hourly.length ? hourly.map((item, index) => {
    const article = document.createElement("article");
    const time = document.createElement("strong");
    const icon = document.createElement("span");
    const temp = document.createElement("b");
    const precip = document.createElement("small");
    const wind = document.createElement("small");
    time.textContent = index === 0 ? "Now" : weatherTime(item.time);
    icon.className = "weather-hour-icon";
    icon.textContent = safeText(item.icon, "☼");
    temp.textContent = formatNumber(item.temp_f, "°", 0);
    precip.className = Number(item.precip_prob || 0) >= 40 ? "rain-likely" : "";
    precip.textContent = `${formatNumber(item.precip_prob, "%", 0)} Rain · ${formatNumber(item.precip_in, " in", 2)}`;
    wind.textContent = `Wind ${formatNumber(item.wind_mph, " mph", 0)}`;
    article.title = `${safeText(item.desc, "Weather")}; feels like ${formatNumber(item.feels_like_f, "°F", 0)}; humidity ${formatNumber(item.humidity, "%", 0)}; gusts ${formatNumber(item.wind_gust_mph, " mph", 0)}`;
    article.append(time, icon, temp, precip, wind);
    return article;
  }) : [Object.assign(document.createElement("p"), { className: "empty-state", textContent: "Hourly Forecast Is Unavailable." })]));

  const hourlySummary = document.getElementById("weather-hourly-summary");
  if (hourlySummary) {
    const wettest = hourly.reduce((best, item) => Number(item.precip_prob || 0) > Number(best?.precip_prob || 0) ? item : best, null);
    hourlySummary.textContent = wettest && Number(wettest.precip_prob || 0) > 0
      ? `Peak Rain Chance ${formatNumber(wettest.precip_prob, "%", 0)} At ${weatherTime(wettest.time)}`
      : hourly.length ? "No Rain Expected" : "Forecast Unavailable";
  }

  const dailyHost = document.getElementById("weather-daily-list");
  if (dailyHost) dailyHost.replaceChildren(...(daily.length ? daily.slice(0, 7).map((item, index) => {
    const article = document.createElement("article");
    const day = document.createElement("strong");
    const icon = document.createElement("span");
    const temp = document.createElement("b");
    const condition = document.createElement("small");
    const rain = document.createElement("small");
    day.textContent = index === 0 ? "Today" : weatherTime(`${item.date}T12:00:00`, true);
    icon.className = "weather-day-icon";
    icon.textContent = safeText(item.icon, "☼");
    temp.textContent = `${formatNumber(item.temp_max, "°", 0)} / ${formatNumber(item.temp_min, "°", 0)}`;
    condition.textContent = titleCase(safeText(item.desc, "Forecast"));
    rain.textContent = `${formatNumber(item.precip_prob, "%", 0)} Rain · UV ${formatNumber(item.uv_max, "", 0)}`;
    article.append(day, icon, temp, condition, rain);
    return article;
  }) : [Object.assign(document.createElement("p"), { className: "empty-state", textContent: "Daily Forecast Is Unavailable." })]));
}

function renderEnvironmentPage() {
  const environment = state.home?.environment || {};
  fillEnvironmentReadings("environment-temperature-list", environment.temperatures, "Temperature readings are unavailable.");
  fillEnvironmentReadings("environment-humidity-list", environment.humidity, "Humidity readings are unavailable.");
  fillEnvironmentReadings("environment-outdoor-list", environment.outdoor, "Outdoor conditions are unavailable.");
  fillEnvironmentReadings("environment-air-list", environment.air_quality, "Air-quality readings are unavailable.");
  fillEnvironmentReadings("environment-utility-list", environment.utility, "Equipment conditions are unavailable.");
  const observed = document.getElementById("environment-observed");
  if (observed) observed.textContent = state.home?.status === "healthy" ? `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Local data unavailable";
  renderOutdoorWeather();
  renderEnvironmentCharts();
}

const chartColors = ["#67e8f9", "#a78bfa", "#58e6a9", "#ffc96b", "#ff78b6", "#55b8ff", "#f48a4a"];

function drawHistoryChart(canvas, legend, series) {
  if (!canvas || !legend) return;
  const context = canvas.getContext("2d");
  const width = Math.max(320, canvas.clientWidth || 640);
  const height = Math.max(190, canvas.clientHeight || 220);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const normalized = series.map((item) => ({
    ...item,
    points: (item.points || []).map((point) => ({ time: new Date(point.at).valueOf(), value: Number(point.value) })).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value)),
  })).filter((item) => item.points.length);
  if (!normalized.length) {
    context.fillStyle = "#8e98b2";
    context.font = "13px system-ui";
    context.fillText("History is unavailable.", 18, 34);
    legend.replaceChildren();
    return;
  }

  const allPoints = normalized.flatMap((item) => item.points);
  const start = Math.min(...allPoints.map((point) => point.time));
  const end = Math.max(...allPoints.map((point) => point.time));
  let minimum = Math.min(...allPoints.map((point) => point.value));
  let maximum = Math.max(...allPoints.map((point) => point.value));
  const spread = Math.max(1, maximum - minimum);
  minimum -= spread * 0.12;
  maximum += spread * 0.12;
  const plot = { left: 44, top: 14, right: width - 14, bottom: height - 30 };

  context.lineWidth = 1;
  context.strokeStyle = "rgba(151, 165, 197, .16)";
  context.fillStyle = "#7f8aa7";
  context.font = "10px system-ui";
  for (let index = 0; index <= 4; index += 1) {
    const y = plot.top + ((plot.bottom - plot.top) * index / 4);
    const value = maximum - ((maximum - minimum) * index / 4);
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
    context.fillText(value.toFixed(0), 8, y + 3);
  }
  for (let index = 0; index <= 4; index += 1) {
    const time = start + ((end - start) * index / 4);
    const label = new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const x = plot.left + ((plot.right - plot.left) * index / 4);
    context.fillText(label, Math.max(plot.left, Math.min(x - context.measureText(label).width / 2, plot.right - context.measureText(label).width)), height - 9);
  }

  normalized.forEach((item, index) => {
    const color = chartColors[index % chartColors.length];
    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = 2;
    item.points.forEach((point, pointIndex) => {
      const x = plot.left + ((point.time - start) / Math.max(1, end - start)) * (plot.right - plot.left);
      const y = plot.bottom - ((point.value - minimum) / Math.max(1, maximum - minimum)) * (plot.bottom - plot.top);
      if (pointIndex === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  });

  legend.replaceChildren(...normalized.map((item, index) => {
    const entry = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.style.backgroundColor = chartColors[index % chartColors.length];
    entry.append(swatch, document.createTextNode(item.label));
    return entry;
  }));

  const tooltip = canvas.parentElement?.querySelector(".chart-tooltip");
  if (tooltip) {
    canvas.onpointermove = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const time = start + ((Math.max(plot.left, Math.min(plot.right, x)) - plot.left) / Math.max(1, plot.right - plot.left)) * (end - start);
      const candidates = normalized.map((item, index) => {
        const point = item.points.reduce((best, current) => Math.abs(current.time - time) < Math.abs(best.time - time) ? current : best, item.points[0]);
        return { item, point, color: chartColors[index % chartColors.length] };
      });
      const nearest = candidates.reduce((best, current) => Math.abs(current.point.time - time) < Math.abs(best.point.time - time) ? current : best, candidates[0]);
      tooltip.textContent = `${nearest.item.label} · ${new Date(nearest.point.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${nearest.point.value.toFixed(1)}`;
      tooltip.style.left = `${Math.max(8, Math.min(x, rect.width - 210))}px`;
      tooltip.style.top = `${Math.max(34, event.clientY - rect.top - 46)}px`;
      tooltip.hidden = false;
    };
    canvas.onpointerleave = () => { tooltip.hidden = true; };
  }
}

function renderEnvironmentCharts() {
  const history = state.environmentHistory;
  const series = history?.status === "healthy" ? history.series || [] : [];
  drawHistoryChart(
    document.getElementById("temperature-history-chart"),
    document.getElementById("temperature-chart-legend"),
    series.filter((item) => item.metric === "temperatures" || item.id === "outdoor-temperature"),
  );
  drawHistoryChart(
    document.getElementById("humidity-history-chart"),
    document.getElementById("humidity-chart-legend"),
    series.filter((item) => item.metric === "humidity"),
  );
  const status = document.getElementById("environment-history-status");
  if (status) status.textContent = history?.status === "healthy" ? `Updated ${humanTime(history.observed_at)}` : state.environmentHistoryLoading ? "Loading history…" : "History unavailable";
}

async function loadEnvironmentHistory() {
  if (state.environmentHistory || state.environmentHistoryLoading) {
    renderEnvironmentCharts();
    return;
  }
  state.environmentHistoryLoading = true;
  renderEnvironmentCharts();
  try {
    const response = await fetch("/v1/home/environment/history", { headers: { Accept: "application/json" }, cache: "no-store" });
    state.environmentHistory = response.ok ? await response.json() : { status: "unavailable" };
  } catch (_error) {
    state.environmentHistory = { status: "unavailable" };
  } finally {
    state.environmentHistoryLoading = false;
    renderEnvironmentCharts();
  }
}

const hvacUi = { dirty: false, saving: false, needsRefresh: false, message: "", tone: "", pendingTarget: null, revision: 0 };

function hvacControlState() {
  const climate = state.home?.climate || {};
  const validNumber = value => typeof value === "number" && Number.isFinite(value);
  const available = !hvacUi.needsRefresh && state.home?.status === "healthy" && Boolean(climate.state) && !["unknown", "unavailable"].includes(climate.state);
  const fahrenheit = !climate.unit || ["°F", "F"].includes(climate.unit);
  const target = available && validNumber(climate.target_temperature) ? climate.target_temperature : null;
  return {
    climate, available, fahrenheit, target,
    current: available && validNumber(climate.current_temperature) ? climate.current_temperature : null,
    editable: available && fahrenheit && target !== null && target >= 60 && target <= 85,
  };
}

function renderHvacControl() {
  const hvac = hvacControlState();
  if (!hvacUi.dirty && !hvacUi.saving) state.hvacDraft = hvac.target;
  if (hvacUi.pendingTarget !== null && hvac.target !== null && Math.abs(hvac.target - hvacUi.pendingTarget) < .06) {
    hvacUi.message = `Target confirmed at ${temperatureText(hvac.target, 0)}.`;
    hvacUi.tone = "is-success";
    hvacUi.pendingTarget = null;
  }
  const operation = hvac.available ? safeText(hvac.climate.hvac_action, hvac.climate.state).replaceAll("_", " ") : "Thermostat unavailable";
  const message = hvacUi.saving ? "Sending temperature request…"
    : hvacUi.needsRefresh ? hvacUi.message
    : !hvac.editable ? (hvac.available && !hvac.fahrenheit ? "Temperature controls require Fahrenheit." : "Waiting for thermostat data. Controls are unavailable.")
    : hvacUi.message || (hvacUi.dirty ? "Not applied yet. Choose Apply Temperature to send." : "");
  for (const node of document.querySelectorAll("[data-hvac-current]")) node.textContent = temperatureText(hvac.current);
  for (const node of document.querySelectorAll("[data-hvac-target]")) node.textContent = temperatureText(hvac.editable ? state.hvacDraft : hvac.target, 0);
  for (const node of document.querySelectorAll("[data-hvac-operation]")) node.textContent = operation;
  for (const button of document.querySelectorAll("[data-hvac-adjust]")) {
    const delta = Number(button.dataset.hvacAdjust);
    button.disabled = hvacUi.saving || !hvac.editable || (delta < 0 ? Math.round(state.hvacDraft) <= 60 : Math.round(state.hvacDraft) >= 85);
  }
  for (const button of document.querySelectorAll("[data-hvac-apply]")) {
    button.disabled = hvacUi.saving || !hvac.editable || !hvacUi.dirty;
    button.textContent = hvacUi.saving ? "Applying…" : "Apply Temperature";
  }
  for (const node of document.querySelectorAll("[data-hvac-status]")) {
    node.textContent = message;
    node.className = `control-status ${hvac.editable && !hvacUi.saving ? hvacUi.tone : ""}`.trim();
  }
  renderEnvironmentSnapshot();
}

let controlReturnFocus = null;

function closeHomeControl() {
  document.getElementById("home-control-overlay").hidden = true;
  document.body.classList.remove("control-open");
  if (controlReturnFocus && document.contains(controlReturnFocus)) controlReturnFocus.focus();
  controlReturnFocus = null;
}

function openHomeControl(kind) {
  controlReturnFocus = document.activeElement;
  const overlay = document.getElementById("home-control-overlay");
  const hvac = document.getElementById("hvac-control");
  hvac.hidden = false;
  document.getElementById("control-dialog-title").textContent = "Temperature Control";
  overlay.hidden = false;
  document.body.classList.add("control-open");
  renderHvacControl();
  document.getElementById("close-home-control").focus();
}

function adjustTemperature(delta) {
  const hvac = hvacControlState();
  if (hvacUi.saving || !hvac.editable || ![-1, 1].includes(delta)) return;
  const current = hvacUi.dirty ? state.hvacDraft : hvac.target;
  state.hvacDraft = Math.min(85, Math.max(60, Math.round(current) + delta));
  hvacUi.dirty = Math.abs(state.hvacDraft - hvac.target) >= .06;
  hvacUi.message = "";
  hvacUi.tone = "";
  hvacUi.pendingTarget = null;
  renderHvacControl();
}

async function applyTemperature() {
  if (hvacUi.saving || !hvacUi.dirty || !hvacControlState().editable) return;
  const requested = state.hvacDraft;
  if (!Number.isInteger(requested) || requested < 60 || requested > 85) return;
  hvacUi.saving = true;
  hvacUi.revision += 1;
  renderHvacControl();
  try {
    const response = await fetch("/v1/home/hvac", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ temperature: requested }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || result.status !== "accepted") throw new Error("Request not confirmed");
    state.home = result.snapshot || { status: "unavailable" };
    hvacUi.dirty = false;
    hvacUi.pendingTarget = requested;
    hvacUi.message = `Requested ${temperatureText(requested, 0)}. Awaiting thermostat confirmation.`;
    hvacUi.tone = "";
    if (state.status) render(state.status);
  } catch (_error) {
    hvacUi.dirty = false;
    hvacUi.needsRefresh = true;
    hvacUi.pendingTarget = null;
    hvacUi.tone = "is-error";
    hvacUi.message = "Unable to confirm the temperature request. Refresh before trying again; it may have reached the thermostat.";
  } finally {
    hvacUi.saving = false;
    hvacUi.revision += 1;
    renderHvacControl();
  }
}

function renderError() {
  const lastObserved = state.status?.observed_at;
  state.status = null;
  state.cyber = {status:"unavailable",fresh:false};
  setOverall("degraded", "Connection Needs Attention");
  document.getElementById("last-updated").textContent = lastObserved ? `Last Seen ${humanTime(lastObserved)}` : "Waiting For Local API";
  for (const id of ["metric-hvac", "metric-environment", "metric-pantry", "metric-energy"]) document.getElementById(id).textContent = "—";
  renderSecurityPage();
}

async function fetchSnapshot(url) {
  try {
    return await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch (_error) { return null; }
}

async function refresh() {
  const button = document.getElementById("refresh-status");
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Refreshing…";
  const hvacRevision = hvacUi.revision;
  try {
    const [statusResponse, energyResponse, forecastResponse, homeResponse, inventoryResponse, idsResponse, pantryResponse, travelResponse, argoResponse, atlasResponse, householdResponse, cyberResponse] = await Promise.all([
      fetchSnapshot("/v1/atlas/status"),
      fetchSnapshot("/v1/energy/status"),
      fetchSnapshot("/v1/energy/forecast"),
      fetchSnapshot("/v1/home/status"),
      fetchSnapshot("/v1/home/entities"),
      fetchSnapshot("/v1/security/vacation-ids"),
      fetchSnapshot("/v1/galleyquest/status"),
      fetchSnapshot("/v1/travel"),
      fetchSnapshot("/v1/argo"),
      fetchSnapshot("/health"),
      fetchSnapshot(`/v1/household?profile=${encodeURIComponent(state.profile)}`),
      fetchSnapshot("/v1/security/cyber"),
    ]);
    if (!statusResponse?.ok) throw new Error("Status Unavailable");
    state.cyber = cyberResponse?.ok ? await cyberResponse.json() : {status:"unavailable",fresh:false};
    state.energy = energyResponse?.ok ? await energyResponse.json() : { status: "unavailable" };
    state.forecast = forecastResponse?.ok ? await forecastResponse.json() : { status: "unavailable" };
    const homeSnapshot = homeResponse?.ok ? await homeResponse.json() : { status: "unavailable" };
    // A refresh started before a control request must not replace its newer readback.
    if (!hvacUi.saving && hvacRevision === hvacUi.revision) {
      state.home = homeSnapshot;
      if (homeSnapshot.status === "healthy") hvacUi.needsRefresh = false;
    }
    state.inventory = inventoryResponse?.ok ? await inventoryResponse.json() : { status: "unavailable" };
    state.ids = idsResponse?.ok ? await idsResponse.json() : { status: "unavailable", armed: false };
    state.pantry = pantryResponse?.ok ? await pantryResponse.json() : { status: "unavailable" };
    state.travel = travelResponse?.ok ? await travelResponse.json() : { status: "unavailable", summary: {}, trips: [] };
    state.argo = argoResponse?.ok ? await argoResponse.json() : { status: "unavailable", summary: {}, assets: [] };
    state.atlas = atlasResponse?.ok ? await atlasResponse.json() : null;
    state.household = householdResponse?.ok ? await householdResponse.json() : { status: "unavailable", profiles: [], messages: [], unread: 0 };
    render(await statusResponse.json());
    renderEnergyPage();
    renderEnvironmentPage();
    renderEntityInventory();
    renderQuickLights();
    renderSecurityPage();
    renderTravelPage();
    renderHousehold();
    renderAgents();
  } catch (_error) {
    if (!hvacUi.saving && hvacRevision === hvacUi.revision) state.home = { status: "unavailable" };
    renderError();
  } finally {
    renderHvacControl();
    button.disabled = false;
    button.textContent = "Refresh Status";
  }
}

document.getElementById("refresh-status").addEventListener("click", () => {
  refresh();
  if (location.hash === "#energy") window.AtlasEnergy.load(true);
});
document.getElementById("travel-back").addEventListener("click", () => showTravelOverview(true));
document.getElementById("travel-review-open").addEventListener("click", openTravelReview);
document.getElementById("travel-review-save").addEventListener("click", saveTravelReview);
document.getElementById("travel-info-close").addEventListener("click", () => document.getElementById("travel-info-dialog").close());
document.getElementById("travel-review-close").addEventListener("click", () => document.getElementById("travel-review-dialog").close());
document.getElementById("travel-loyalty-back").addEventListener("click", () => showTravelOverview(true));
for (const card of document.querySelectorAll("[data-preview-action]")) {
  card.addEventListener("click", () => {
    const action = card.dataset.previewAction;
    if (action === "hvac") openHomeControl(action);
    else if (action === "galleyquest") activateTab("pantry", true);
    else if (action?.startsWith("galley-")) activateTab("pantry", true);
    else activateTab(action || "home", true);
  });
}
document.getElementById("close-home-control").addEventListener("click", closeHomeControl);
document.getElementById("view-environment").addEventListener("click", () => {
  closeHomeControl();
  activateTab("environment", true);
});
document.getElementById("home-control-overlay").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeHomeControl();
});
for (const button of document.querySelectorAll("[data-hvac-adjust]")) {
  button.addEventListener("click", () => adjustTemperature(Number(button.dataset.hvacAdjust)));
}
for (const button of document.querySelectorAll("[data-hvac-apply]")) button.addEventListener("click", applyTemperature);
renderHvacControl();
document.getElementById("entity-search").addEventListener("input", renderEntityInventory);
document.getElementById("entity-category").addEventListener("change", renderEntityInventory);
for (const button of document.querySelectorAll("[data-energy-range]")) {
  button.addEventListener("click", () => loadEnergyHistory(button.dataset.energyRange));
}
for (const button of document.querySelectorAll("[data-profile-open]")) {
  button.addEventListener("click", () => {
    renderProfile();
    document.getElementById("profile-pin-panel").hidden = true;
    document.getElementById("profile-pin").value = "";
    document.getElementById("profile-pin-status").textContent = "";
    document.getElementById("profile-overlay").hidden = false;
    document.body.classList.add("control-open");
    document.getElementById("close-profile").focus();
  });
}
document.getElementById("close-profile").addEventListener("click", () => {
  document.getElementById("profile-overlay").hidden = true;
  document.body.classList.remove("control-open");
});
document.getElementById("profile-overlay").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) document.getElementById("close-profile").click();
});
document.getElementById("profile-pin-panel").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("profile-pin");
  const status = document.getElementById("profile-pin-status");
  const pin = input.value.trim();
  if (!/^\d{6}$/.test(pin)) { status.textContent = "Enter exactly 6 digits."; return; }
  status.textContent = "Checking PIN…";
  try {
    const response = await fetch("/v1/household/profile/switch", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ profile: "alex", pin }) });
    const payload = await response.json();
    input.value = "";
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (payload.status === "not_configured") { status.textContent = "Configure Alex’s PIN once on the Atlas host, then retry."; return; }
    if (payload.status !== "accepted") { status.textContent = "That PIN was not accepted."; input.focus(); return; }
    await acceptProfile("alex");
  } catch (error) {
    status.textContent = `Profile switch failed: ${error.message}`;
  }
});
for (const button of document.querySelectorAll("[data-agent-open]")) {
  button.addEventListener("click", () => {
    if (button.dataset.agentOpen === "openwebui" && window.matchMedia("(max-width: 700px)").matches) {
      document.getElementById("agent-route-status").textContent = "Open WebUI is available on the Atlas PC only. Use this local Hermes chat from your phone.";
      return;
    }
    const destination = button.dataset.agentOpen === "chatgpt" ? externalDestinations.chatgpt : "http://127.0.0.1:17085/";
    window.open(destination, "_blank", "noopener");
  });
}
document.getElementById("agent-chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("agent-chat-input");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  await sendAgentMessage(message);
  input.focus();
});
document.getElementById("agent-chat-input").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  document.getElementById("agent-chat-form").requestSubmit();
});
document.getElementById("send-message").addEventListener("click", async () => {
  const body = document.getElementById("message-body");
  const recipient = document.getElementById("message-recipient");
  const status = document.getElementById("message-status");
  const message = body.value.trim();
  if (!message) { status.textContent = "Enter a message first."; return; }
  status.textContent = "Sending locally…";
  try {
    const response = await fetch("/v1/household/messages", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sender: state.profile, recipient: recipient.value, body: message }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    body.value = "";
    status.textContent = "Message stored on Atlas.";
    await loadHousehold(false);
  } catch (error) {
    status.textContent = `Message was not sent: ${error.message}`;
  }
});
document.getElementById("ids-arm").addEventListener("click", () => {
  if (state.ids?.armed) {
    setVacationIDS(false);
    return;
  }
  document.getElementById("ids-arm").hidden = true;
  document.getElementById("ids-confirm").hidden = false;
  document.getElementById("ids-cancel").hidden = false;
  document.getElementById("ids-control-status").textContent = "Confirm only when everyone has left and vacation monitoring should begin.";
});
document.getElementById("ids-confirm").addEventListener("click", () => setVacationIDS(true, "ARM VACATION IDS"));
document.getElementById("ids-cancel").addEventListener("click", () => {
  document.getElementById("ids-confirm").hidden = true;
  document.getElementById("ids-cancel").hidden = true;
  document.getElementById("ids-arm").hidden = false;
  document.getElementById("ids-control-status").textContent = "Arming cancelled.";
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.getElementById("home-control-overlay").hidden) closeHomeControl();
  if (event.key === "Escape" && !document.getElementById("profile-overlay").hidden) document.getElementById("close-profile").click();
});
window.addEventListener("resize", () => {
  if (location.hash === "#environment") renderEnvironmentCharts();
  if (location.hash === "#energy") renderEnergyHistory();
});
// Move the existing chat, rather than cloning it, to keep one transcript and route.
const atlasChatLauncher = document.getElementById("atlas-chat-launcher");
const atlasChatDialog = document.getElementById("atlas-chat-dialog");
const atlasSharedChat = document.querySelector("#panel-agents .agent-chat");
const atlasChatHome = document.createComment("Shared Atlas chat home");
atlasSharedChat.before(atlasChatHome);
// Follow the visible viewport when a tablet or phone keyboard opens.
function syncAgentViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty("--agent-viewport-height", `${viewport?.height || window.innerHeight}px`);
  document.documentElement.style.setProperty("--agent-viewport-top", `${viewport?.offsetTop || 0}px`);
}
window.visualViewport?.addEventListener("resize", syncAgentViewport);
window.visualViewport?.addEventListener("scroll", syncAgentViewport);
window.addEventListener("resize", syncAgentViewport);
syncAgentViewport();
function closeAtlasChat() {
  if (atlasChatDialog.open) atlasChatDialog.close();
}
atlasChatLauncher.addEventListener("click", () => {
  if (atlasChatDialog.open) { closeAtlasChat(); return; }
  document.getElementById("atlas-chat-body").append(atlasSharedChat);
  atlasChatDialog.show();
  atlasChatLauncher.setAttribute("aria-expanded", "true");
  document.getElementById("agent-chat-input").focus();
});
document.getElementById("atlas-chat-close").addEventListener("click", closeAtlasChat);
atlasChatDialog.addEventListener("close", () => {
  atlasChatHome.after(atlasSharedChat);
  atlasChatLauncher.setAttribute("aria-expanded", "false");
  atlasChatLauncher.focus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && atlasChatDialog.open) closeAtlasChat();
});
updateClock();
setInterval(updateClock, 30_000);
// Refresh the visible dashboard, independently of the 20-minute host health task.
setInterval(() => { if (!document.hidden) refresh(); }, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
configureGalleyQuestLinks();
configureExternalLinks();
function activateRoute() {
  const route = location.hash.slice(1) || "home";
  if (route === "travel/loyalty") {
    activateTab("travel", false, false);
    openTravelLoyalty(false);
  } else if (route.startsWith("travel/trip/")) {
    activateTab("travel", false, false);
    openTravelTrip(decodeURIComponent(route.slice("travel/trip/".length)), false);
  } else activateTab(route, false, false);
}
activateRoute();
window.addEventListener("hashchange", activateRoute);
refresh();
