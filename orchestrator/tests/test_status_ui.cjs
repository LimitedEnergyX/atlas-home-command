// Isolated UI regression tests; no browser, live service, or household writes.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const js = fs.readFileSync(path.join(__dirname, '../src/atlas_orchestrator/web/atlas.js'), 'utf8');
const state = {status:{health_controls:{status:'current'},scores:{overall:100},failures:[]}};
const context = {state, AbortSignal, titleCase:x=>x, safeText:(x,f)=>x||f};
vm.createContext(context);
vm.runInContext(js.slice(js.indexOf('function currentHealthScores('), js.indexOf('function updateNotificationBadges(')), context);
assert.equal(context.currentHealthScores().overall, 100);
for (const status of ['stale','missing','unavailable']) {
  state.status.health_controls.status = status;
  assert.equal(context.currentHealthScores().overall, undefined, status);
}
state.status = null;
assert.equal(context.currentHealthScores().overall, undefined);
state.status = {failures:[{status:'monitoring',id:'Routine'}, {status:'open',id:'Real Issue'}]};
assert.equal(context.systemNotices().length, 1);
assert.equal(context.systemNotices()[0].title, 'Real Issue');
vm.runInContext(js.slice(js.indexOf('async function fetchSnapshot('), js.indexOf('async function refresh(')), context);
(async () => {
  context.fetch = async () => { throw new Error('Offline'); };
  assert.equal(await context.fetchSnapshot('/test'), null);
  context.fetch = async (url, opts) => { assert(opts.signal); assert.equal(opts.cache,'no-store'); return {ok:true}; };
  assert.equal((await context.fetchSnapshot('/test')).ok, true);
  console.log('Status UI: fresh/stale/missing/offline, actionable notices and bounded fetch checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
