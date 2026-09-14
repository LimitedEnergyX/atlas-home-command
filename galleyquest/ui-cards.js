/* ui-cards.js - collapsed-card grid helpers for Recipes, Cook Now, Grocery.
 * MUST load BEFORE app.js (app.js ends with a synchronous init() whose
 * awaited renders can run in microtasks between script tags).
 * Council: cw-council-20260720T193038594463 (plan agreed round 5 + operator
 * grant gate-20260720T194130110756).
 */
(function () {
  'use strict';

  var LS_PREFIX = 'pantry_ui_cards_v1:';
  var memState = {};   // in-memory fallback when localStorage unavailable

  // Quote-safe attribute escaper (escHtml in app.js does NOT escape quotes).
  window.escAttr = function (s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // Injective, collision-free id fragment: lowercase hex of UTF-8 bytes.
  window.hexId = function (s) {
    var out = '', bytes = new TextEncoder().encode(String(s));
    for (var i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
  };

  function loadState(tabKey) {
    try {
      var raw = localStorage.getItem(LS_PREFIX + tabKey);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) arr = [];
      return new Set(arr);
    } catch (e) {
      return new Set(memState[tabKey] || []);
    }
  }

  function saveState(tabKey, set) {
    var arr = Array.from(set);
    memState[tabKey] = arr;
    try { localStorage.setItem(LS_PREFIX + tabKey, JSON.stringify(arr)); }
    catch (e) { /* quota/security: session-only via memState */ }
  }

  function syncFace(card, expanded) {
    var face = card.querySelector('button.card-face');
    if (face) face.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    card.classList.toggle('expanded', !!expanded);
  }

  // Idempotent: one delegated click listener per container. Native buttons
  // synthesize click on Enter/Space, so click is the ONLY toggle path
  // (a keydown toggle would double-fire - council round 5).
  window.wireCardGrid = function (containerId, tabKey) {
    var container = document.getElementById(containerId);
    if (!container || container.dataset.cwWired) return;
    container.dataset.cwWired = '1';
    container.addEventListener('click', function (e) {
      if (e.target.closest('[data-action]')) return;        // actions never toggle
      var face = e.target.closest('button.card-face');
      if (!face || !container.contains(face)) return;
      var card = face.closest('.card[data-card-id]');
      if (!card) return;
      var id = card.getAttribute('data-card-id');
      var state = loadState(tabKey);
      var expanded = !state.has(id);
      if (expanded) state.add(id); else state.delete(id);
      saveState(tabKey, state);
      syncFace(card, expanded);
    });
  };

  // Re-apply persisted expansion after every innerHTML swap.
  window.applyCardState = function (containerId, tabKey) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var state = loadState(tabKey);
    container.querySelectorAll('.card[data-card-id]').forEach(function (card) {
      syncFace(card, state.has(card.getAttribute('data-card-id')));
    });
  };

  // Collapse every card in a tab (clears persisted expansion).
  window.collapseAll = function (containerId, tabKey) {
    saveState(tabKey, new Set());
    window.applyCardState(containerId, tabKey);
  };

  // Grocery actions: change handles ONLY dismiss checkboxes; click handles
  // ONLY button-like restore / delete-extra. Independent marker from toggle
  // wiring; no user-derived text ever enters a JS string literal.
  window.wireGroceryActions = function (containerId) {
    var container = document.getElementById(containerId);
    if (!container || container.dataset.cwActionsWired) return;
    container.dataset.cwActionsWired = '1';
    container.addEventListener('change', function (e) {
      var cb = e.target;
      if (cb.matches('input[type="checkbox"][data-action="dismiss"]')) {
        window.dismissGroceryItem(cb.getAttribute('data-key'));
      }
    });
    container.addEventListener('click', function (e) {
      var el = e.target.closest('[data-action]');
      if (!el || !container.contains(el)) return;
      if (el.matches('input[type="checkbox"]')) return;     // change-only
      var action = el.getAttribute('data-action');
      if (action === 'restore') window.restoreGroceryItem(el.getAttribute('data-key'));
      else if (action === 'delete-extra') window.deleteGroceryExtra(el.getAttribute('data-id'));
      else if (action === 'advance') window.advanceGroceryItem(el.getAttribute('data-id'));
      else if (action === 'picked-up') window.pickedUpGroceryItem(el.getAttribute('data-id'));
      else if (action === 'picked-up-all') window.pickedUpAllGrocery();
      else if (action === 'all-ordered') window.markAllOrdered();
      else if (action === 'all-pending') window.markAllPending();
      else if (action === 'copy-prompt') window.copyOrderPrompt();
      else if (action === 'add-needs') window.addWeekNeeds();
    });
  };
})();

/* Verify-council additions (cw-council-20260720T201145145613 round 2) */
(function () {
  'use strict';

  // Runtime allowlist for status -> CSS class suffix (comments are not
  // enforcement). Returns null for anything outside the fixed set.
  window.safeStatus = function (s) {
    return (s === 'OK' || s === 'LOW' || s === 'OUT') ? s : null;
  };

  // Status badge HTML. OK renders as a green checkmark; LOW/OUT keep their
  // labels. Returns '' for anything outside the allowlist (caller handles it).
  window.statusBadge = function (status) {
    var st = window.safeStatus(status);
    if (st === 'OK') return '<span class="badge badge-OK" title="In stock" aria-label="In stock">✓</span>';
    if (st) return '<span class="badge badge-' + st + '">' + st + '</span>';
    return '';
  };

  // Generic delegated card actions (same injection-safe pattern as grocery):
  // data-action + data-id attributes, no user data in JS string literals.
  window.wireCardActions = function (containerId, handlers) {
    var container = document.getElementById(containerId);
    if (!container || container.dataset.cwCardActionsWired) return;
    container.dataset.cwCardActionsWired = '1';
    container.addEventListener('click', function (e) {
      var el = e.target.closest('[data-action]');
      if (!el || !container.contains(el)) return;
      if (el.matches('input[type="checkbox"]')) return;
      var fn = handlers[el.getAttribute('data-action')];
      if (fn) fn(el.getAttribute('data-id'));
    });
  };
})();
