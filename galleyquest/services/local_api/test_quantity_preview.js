'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const quantity = require('./quantity.js');
const elements = new Map();
function element() {
  return {value: '', style: {}, hidden: false, listeners: {}, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key] || null; },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    after() {}, setCustomValidity(value) { this.validity = value; }, focus() {}, reportValidity() {}};
}
const input = element(), save = element();
elements.set('f-stock-qty', input); elements.set('stock-modal-save', save);
const requests = [];
const context = {
  window: {GalleyQuantity: quantity},
  document: {getElementById: id => elements.get(id), createElement: () => element(), dispatchEvent() {}},
  mergeStockQuantity(notes, quantityText) {
    const lines = (notes || '').split('\n').filter(line => !/^\s*Qty\s*:/i.test(line));
    let legacy = lines.join('\n').trim();
    if (/^(\d+(?:\.\d+)?|\d+\/\d+)\s*[a-z]+(?:\s*\([^)]*\))?\s*$/i.test(legacy)) legacy = '';
    return [quantityText ? 'Qty: ' + quantityText : '', legacy].filter(Boolean).join('\n') || null;
  },
  openStockModal() {}, parseStockQuantity() {}, formatStockQuantity() {}, changeStockQuantity() {},
  stockItems: [], recipes: [], renderRecipes() {},
  setStatus(...args) { context.lastStatus = args; },
  crypto: {randomUUID: () => 'test-request-id'}, CustomEvent: function () {},
  async fetch(url, options) {
    requests.push({url, body: JSON.parse(options.body)});
    return {ok: true, async json() { return {applied: true, items: [{id: 'milk', _revision: 2}]}; }};
  },
  async loadStock() { context.stockItems = [{id: 'milk', name: 'Milk', quantity_amount: '1.5', quantity_unit: 'gallon', _revision: 2}]; }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('./quantity-preview.js'), 'utf8'), context);
const item = {name: 'Milk', status: 'OK', notes: 'Qty: 1/2 gallon\nKeep refrigerated'};
assert.equal(context.parseStockQuantity(item).amount, 0.5);
assert.equal(context.parseStockQuantity(item).unit, 'gallon');
assert.equal(context.formatStockQuantity(item), '0.5 gallon');
assert.equal(context.formatStockQuantity({...item, quantity_amount: '2', quantity_unit: 'pint'}), '2 pint');
for (const notes of ['', '1 gallon', 'Qty: about half a bottle', 'Qty: 1 cup\nQty: 2 cups']) {
  assert(Number.isNaN(context.parseStockQuantity({notes, status: 'OK'}).amount));
  assert.equal(context.formatStockQuantity({notes}), 'Quantity unknown');
}
assert.equal(context.formatStockQuantity({notes: 'Qty: 0 gallon', status: 'OUT'}), '0 gallon');
assert.equal(context.formatStockQuantity({name: 'Sugar', notes: 'Qty: 2 lb'}), '2 pound');
assert.equal(context.mergeStockQuantity('Qty: 1 gal\nKeep refrigerated', '1/2 gallon'), 'Qty: 0.5 gallon\nKeep refrigerated');
assert.equal(context.mergeStockQuantity('1 gallon', '1/2 gallon'), 'Qty: 0.5 gallon\n1 gallon');
assert.equal(context.mergeStockQuantity('1 gallon', ''), '1 gallon');
context.openStockModal({notes: ''}); assert.equal(input.value, '');
context.openStockModal(item); assert.equal(input.value, '0.5 gallon');
input.value = '½ gallon'; save.listeners.click({}); assert.equal(input.value, '0.5 gallon');
let blocked = false;
input.value = '-1 gallon';
save.listeners.click({preventDefault() {}, stopImmediatePropagation() { blocked = true; }});
assert(blocked); assert.equal(input.attributes['aria-invalid'], 'true');
(async () => {
  context.stockItems = [{id: 'unknown', name: 'Rice', notes: '', _revision: 1}];
  await context.changeStockQuantity('unknown', 1); assert.equal(requests.length, 0);
  context.stockItems = [{...item, id: 'milk', _revision: 1}];
  await context.changeStockQuantity('milk', 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/v1/commands/stock');
  assert.equal(requests[0].body.operations[0].quantity_text, '1 gallon');
  assert.equal(requests[0].body.operations[0].action, 'add');
  assert.equal(requests[0].body.operations[0].expected_revision, 1);
  console.log('Quantity preview parsing, preservation, validation, and command tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
