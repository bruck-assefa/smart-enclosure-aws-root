export const TIMEZONE = 'America/New_York';
// Compare hardware timestamps with server time, not the browser's wall clock.
export const serverNow = (state, received, clientNow) => Number.isFinite(state?.snapshot?.generated_at)
  ? state.snapshot.generated_at + Math.max(0, clientNow - received) : clientNow;
export const ZONES = ['Warm', 'Transition', 'Cool'];
export const LABELS = { Warm: 'Hot zone', Transition: 'Transition zone', Cool: 'Cold zone' };
export const dateKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export function shiftDay(day, offset) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); }
export const clock = stamp => Number.isFinite(stamp) ? new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(stamp * 1000)) : '—';
export const temp = (c, unit) => Number.isFinite(c) ? (unit === 'F' ? c * 9 / 5 + 32 : c).toFixed(1) : '—';
export function assignments(rows, sensors) {
  const map = {};
  for (const s of sensors) {
    const key = `${s.hardware.multiplexer_address}-ch${s.hardware.channel}`;
    const row = rows.find(r => r.sensor_id === key || r.sensor_id === s.sensor_id);
    if (row && ZONES.includes(row.zone)) map[s.sensor_id] = row.zone;
  }
  return map;
}
export function liveZones(state, rows, now) {
  const sensors = state?.snapshot?.sensors || [];
  const map = assignments(rows, sensors);
  const connected = state?.connection?.status === 'connected' && state?.snapshot?.collector?.status === 'running';
  return ZONES.map(zone => {
    const configured = sensors.filter(s => s.enabled && map[s.sensor_id] === zone);
    const valid = configured.filter(s => connected && s.status === 'healthy' && now - s.last_success_at <= 30 && now >= s.last_success_at && Number.isFinite(s.last_good_reading?.temperature_c));
    return { zone, total: configured.length, count: valid.length,
      value: valid.length ? valid.reduce((sum, s) => sum + s.last_good_reading.temperature_c, 0) / valid.length : null,
      age: valid.length ? Math.max(...valid.map(s => Math.floor(now - s.last_success_at))) : null };
  });
}
export function zoneHistory(series, map, field = 'temperature_c') {
  const groups = Object.fromEntries(ZONES.map(z => [z, new Map()]));
  for (const s of series) {
    const buckets = groups[map[s.sensor_id]];
    if (!buckets) continue;
    for (const p of s.points) {
      if (!Number.isFinite(p[field])) continue;
      const b = buckets.get(p.time) || { time: p.time, sum: 0, count: 0 };
      b.sum += p[field]; b.count += 1; buckets.set(p.time, b);
    }
  }
  return ZONES.map(zone => ({ zone, points: [...groups[zone].values()].sort((a, b) => a.time - b.time).map(b => ({ time: b.time, value: b.sum / b.count, count: b.count })) }));
}
export async function api(path, options = {}) {
  const response = await fetch(`/enclosure${path}`, { cache: 'no-store', ...options, signal: options.signal || AbortSignal.timeout(7000) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`);
  return data;
}

// Interpret wall-clock inputs in the enclosure timezone, independently of the browser.
// Repeated fall-back times span both occurrences (earlier start, later end).
export function customHistoryBounds(draft) {
  const parse = (day, time, last) => {
    const local = `${day}T${time || '00:00'}`;
    const nominal = Date.parse(`${local}:00Z`);
    const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const matches = [];
    for (let offset = -14; offset <= 14; offset++) {
      const stamp = nominal + offset * 3600000;
      if (Number.isFinite(stamp) && formatter.format(new Date(stamp)).replace(' ', 'T') === local) matches.push(stamp / 1000);
    }
    if (!matches.length) throw new Error('Choose a valid enclosure date and time. That time may not exist during the daylight-saving change.');
    return last ? matches.at(-1) : matches[0];
  };
  const days = (Date.parse(draft.end) - Date.parse(draft.start)) / 86400000 + 1;
  if (!Number.isFinite(days) || days < 1 || days > 31) throw new Error('Choose dates spanning no more than 31 calendar days.');
  const start = parse(draft.start, draft.startTime, false);
  const end = parse(draft.endTime ? draft.end : shiftDay(draft.end, 1), draft.endTime, true);
  if (end <= start) throw new Error('End date and time must be after the start.');
  return { start, end };
}
