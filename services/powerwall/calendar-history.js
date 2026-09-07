'use strict';

// Read-only Tesla history. Reuses the adapter's protected token and never sends commands.
function createCalendarReader({ get, getToken, base, now = Date.now }) {
  const cache = new Map();
  const pending = new Map();
  return async function read(query) {
    const kind = String(query.kind || 'energy');
    const period = String(query.period || 'day');
    const start = String(query.start_date || '');
    const end = String(query.end_date || '');
    const zone = String(query.time_zone || 'America/Chicago');
    const span = Date.parse(end) - Date.parse(start);
    if (!['energy', 'power', 'soe'].includes(kind) || !['day', 'month', 'year'].includes(period)
      || (kind !== 'energy' && period !== 'day') || zone !== 'America/Chicago'
      || !/^\d{4}-\d\d-\d\dT/.test(start) || !/^\d{4}-\d\d-\d\dT/.test(end)
      || !Number.isFinite(span) || span < 0 || span > 367 * 86400000
      || Date.parse(start) < Date.UTC(2010, 0, 1) || Date.parse(start) > now() + 86400000) {
      const error = new Error('Invalid calendar history request'); error.status = 400; throw error;
    }
    const params = { kind, period, start_date: start, end_date: end, time_zone: zone };
    const key = JSON.stringify(params);
    const saved = cache.get(key);
    if (saved && now() < saved.expires) {
      if (saved.error) throw saved.error;
      return saved.value;
    }
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 4) { const error = new Error('History busy'); error.status = 503; throw error; }
    const request = (async () => {
      try {
        const token = await getToken();
        const result = await get(base + '/calendar_history', {
          params, headers: { Authorization: 'Bearer ' + token }, timeout: 20000,
        });
        const source = result.data?.response;
        if (!source || !Array.isArray(source.time_series) || source.time_series.length > 10000) throw new Error('Invalid or oversized Tesla history');
        const value = {
          source: 'tesla-fleet-api', kind, period, time_zone: zone,
          start_date: start, end_date: end, fetched_at: new Date(now()).toISOString(),
          time_series: source.time_series.map(row => Object.fromEntries(
            Object.entries(row).filter(([field, val]) => field === 'timestamp'
              ? typeof val === 'string' && Number.isFinite(Date.parse(val))
              : /^[a-z_]+$/.test(field) && typeof val === 'number' && Number.isFinite(val))
          )),
        };
        cache.set(key, { value, expires: now() + 300000 });
        return value;
      } catch (cause) {
        const error = new Error('Tesla history unavailable');
        error.status = 503;
        error.upstream_status = cause.response?.status || null;
        cache.set(key, { error, expires: now() + 60000 });
        throw error;
      } finally {
        pending.delete(key);
        if (cache.size > 64) cache.delete(cache.keys().next().value);
      }
    })();
    pending.set(key, request);
    return request;
  };
}

module.exports = { createCalendarReader };
