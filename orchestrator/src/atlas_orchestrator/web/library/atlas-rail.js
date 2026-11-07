/* Atlas Library 20261106-home-rail: Atlas left module rail for every Library page.
   Markup synced with web/index.html <nav class="module-rail"> order:
   Library, Home, Calendar, Energy, Environment, Security, Pantry, Travel, Vehicles,
   Maintenance, Systems, Agents, Notifications, Command. */
"use strict";
(function () {
  const V = "20261106-home-rail", b = document.body, root = document.documentElement;
  if (!b || b.classList.contains("reader") || document.querySelector(".module-rail")) return;
  const tabs = [
    ["library", "Library", "/library/"],
    ["home", "Home", "/#home"],
    ["calendar", "Calendar"],
    ["energy", "Energy"],
    ["environment", "Environment"],
    ["security", "Security"],
    ["pantry", "Pantry"],
    ["travel", "Travel"],
    ["argo", "Vehicles", "/argo/", "vehicles"],
    ["maintenance", "Maintenance"],
    ["systems", "Systems"],
    ["agents", "Agents"],
    ["notifications", "Notifications"],
    ["command", "Command", null, "systems"]
  ];
  const nav = document.createElement("nav");
  nav.className = "module-rail atlas-rail"; nav.setAttribute("aria-label", "Atlas modules");
  for (const [id, label, href, icon] of tabs) {
    const a = document.createElement("a");
    a.className = "module-tab" + (id === "library" ? " active" : "");
    a.href = href || ("/#" + id);
    a.dataset.tab = id;
    if (id === "library") a.setAttribute("aria-current", "page");
    const i = document.createElement("span");
    i.className = "nav-icon icon-" + (icon || id);
    i.setAttribute("aria-hidden", "true");
    const t = document.createElement("b"); t.textContent = label;
    a.append(i, t); nav.append(a);
  }
  const bar = document.querySelector(".lbar");
  const fit = () => root.style.setProperty("--lbar-h", bar ? bar.offsetHeight + "px" : "0px");
  const mount = () => { b.prepend(nav); b.classList.add("has-rail", bar ? "rail-lib" : "rail-page"); fit(); addEventListener("resize", fit); };
  if (document.querySelector('link[href^="/library/assets/atlas-rail.css"]')) { mount(); return; }
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/library/assets/atlas-rail.css?v=" + V;
  l.onload = mount; l.onerror = () => {}; document.head.append(l);
})();
