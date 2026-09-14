/* Preview-only quantity integration. Legacy notes are evidence, not inferred units. */
(() => {
  'use strict';
  const parse = window.GalleyQuantity.parse;
  const originalMerge = mergeStockQuantity;
  const originalOpen = openStockModal;
  const quantityInput = document.getElementById('f-stock-qty');
  const saveButton = document.getElementById('stock-modal-save');
  const errorBox = document.createElement('p');
  errorBox.id = 'gq-quantity-error';
  errorBox.setAttribute('role', 'alert');
  errorBox.style.color = '#9f1239';
  errorBox.hidden = true;
  quantityInput.after(errorBox);
  quantityInput.setAttribute('aria-describedby', [quantityInput.getAttribute('aria-describedby'), errorBox.id].filter(Boolean).join(' '));
  quantityInput.placeholder = 'e.g. 1/2 gallon, 2 sticks, 3 cups';

  function canonicalText(quantity) {
    return quantity ? quantity.amount + (quantity.unit ? ' ' + quantity.unit : '') : '';
  }

  function readQuantity(item) {
    if (!item) return null;
    try {
      if (item.quantity_amount !== null && item.quantity_amount !== undefined) {
        return parse(String(item.quantity_amount) + (item.quantity_unit ? ' ' + item.quantity_unit : ''));
      }
      const lines = String(item.notes || '').split('\n').filter(line => /^\s*Qty\s*:/i.test(line));
      // Multiple competing annotations are ambiguous. Ask for an explicit value.
      if (lines.length !== 1) return null;
      return parse(lines[0].replace(/^\s*Qty\s*:\s*/i, ''));
    } catch (_) {
      return null;
    }
  }

  parseStockQuantity = function (item) {
    const quantity = readQuantity(item);
    const amount = quantity ? Number(quantity.amount) : NaN;
    // Existing index.html reads .amount; .number is retained as a compatibility alias.
    return {amount, number: amount, unit: quantity ? quantity.unit : '', canonical_amount: quantity ? quantity.amount : null};
  };

  formatStockQuantity = function (item) {
    const quantity = readQuantity(item);
    return quantity ? canonicalText(quantity) : 'Quantity unknown';
  };

  mergeStockQuantity = function (notes, quantityText) {
    const quantity = canonicalText(parse(quantityText));
    const merged = originalMerge(notes, quantity);
    // The original helper drops lone numeric legacy notes. Preserve those too:
    // only explicit Qty lines are replaced by this editor.
    const legacy = String(notes || '').split('\n').filter(line => !/^\s*Qty\s*:/i.test(line)).join('\n').trim();
    if (legacy && !originalMerge(notes, '')) {
      return [quantity ? 'Qty: ' + quantity : '', legacy].filter(Boolean).join('\n') || null;
    }
    return merged;
  };

  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
    quantityInput.removeAttribute('aria-invalid');
    quantityInput.setCustomValidity('');
  }

  openStockModal = function (item) {
    originalOpen(item);
    quantityInput.value = canonicalText(readQuantity(item));
    clearError();
  };

  quantityInput.addEventListener('input', clearError);
  saveButton.addEventListener('click', event => {
    try {
      quantityInput.value = canonicalText(parse(quantityInput.value));
      clearError();
    } catch (error) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const message = error.message + ' Enter an amount such as 1/2 gallon, or leave quantity blank if unknown.';
      errorBox.textContent = message;
      errorBox.hidden = false;
      quantityInput.setAttribute('aria-invalid', 'true');
      quantityInput.setCustomValidity(message);
      quantityInput.focus();
      quantityInput.reportValidity();
    }
  }, true);

  const inFlight = new Set();
  const attempts = new Map();
  changeStockQuantity = async function (id, delta) {
    if (inFlight.has(id)) return;
    const item = stockItems.find(row => row.id === id);
    if (!item) return;
    const current = readQuantity(item);
    if (!current || !current.unit) {
      setStatus('stock-status', 'Set a known quantity and unit for ' + item.name + ' in Edit before using + or −.', true);
      return;
    }
    if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) {
      setStatus('stock-status', 'Quantity adjustment must be a finite nonzero number.', true);
      return;
    }
    if (!Number.isInteger(item._revision)) {
      setStatus('stock-status', 'Reload inventory before adjusting this item. Its current revision is unavailable.', true);
      return;
    }
    let quantity;
    try { quantity = parse(String(Math.abs(delta)) + ' ' + current.unit); }
    catch (error) { setStatus('stock-status', error.message, true); return; }
    const operation = {stock_id: id, action: delta > 0 ? 'add' : 'consume', quantity_text: canonicalText(quantity), expected_revision: item._revision};
    const fingerprint = JSON.stringify(operation);
    let attempt = attempts.get(id);
    if (!attempt || attempt.fingerprint !== fingerprint) {
      attempt = {fingerprint, requestId: crypto.randomUUID()};
      attempts.set(id, attempt);
    }
    inFlight.add(id);
    let saved = false;
    try {
      const response = await fetch('/api/v1/commands/stock', {
        method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({request_id: attempt.requestId, operations: [operation]})
      });
      const result = await response.json();
      if (!response.ok) throw Error(typeof result.error === 'string' ? result.error : 'The quantity update was rejected.');
      if (result.applied !== true || !Array.isArray(result.items)) throw Error('The server did not confirm the quantity update.');
      saved = true;
      attempts.delete(id);
      await loadStock();
      const expected = result.items.find(row => row && row.id === id);
      const reloaded = stockItems.find(row => row.id === id);
      if (!expected || !reloaded || reloaded._revision !== expected._revision) {
        throw Error('The quantity was saved, but the refreshed inventory could not be verified. Reload the page before another adjustment.');
      }
      if (typeof renderRecipes === 'function' && typeof recipes !== 'undefined' && recipes.length) renderRecipes();
      setStatus('stock-status', item.name + ': ' + formatStockQuantity(reloaded));
      document.dispatchEvent(new CustomEvent('galleyquest:stock-changed', {detail: {source: 'quantity-control'}}));
    } catch (error) {
      setStatus('stock-status', (saved ? '' : 'Quantity update was not confirmed: ') + error.message, true);
    } finally {
      inFlight.delete(id);
    }
  };
})();
