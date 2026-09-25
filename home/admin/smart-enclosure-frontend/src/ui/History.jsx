import { timing } from '../timing.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import Events from './Events';
import useEvents from './useEvents';
import { EVENT_LABELS, eventTimeLabel } from './eventData';
import { api, assignments, customHistoryBounds, clock, dateKey, LABELS, shiftDay, temp, zoneHistory } from './data';

export default function History({ unit, state, rows, now }) {
  const [metric, setMetric] = useState('temperature_c');
  const metricLabel = { temperature_c: 'Temperature', humidity_pct: 'Humidity', pressure_hpa: 'Pressure' }[metric];
  const metricUnit = metric === 'temperature_c' ? `°${unit}` : metric === 'humidity_pct' ? '% RH' : 'hPa';
  const format = value => metric === 'temperature_c' ? temp(value, unit) : value.toFixed(1);
  const today = dateKey(new Date(now * 1000));
  const [range, setRange] = useState({ mode: 'live', start: today, end: today });
  const [draft, setDraft] = useState({ start: today, end: today, startTime: '', endTime: '' });
  const [rangeError, setRangeError] = useState('');
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null), [width, setWidth] = useState(600);
  const [visible, setVisible] = useState({ Warm: true, Transition: true, Cool: true });
  const [activeId, setActiveId] = useState(null);
  const eventStart = range.mode === 'live' ? shiftDay(today, -1) : range.mode === 'today' ? today : range.start;
  const eventEnd = ['live', 'today'].includes(range.mode) ? today : range.end;
  const eventStore = useEvents(eventStart, eventEnd);
  const host = useRef(null);
  useEffect(() => { const obs = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width)); obs.observe(host.current); return () => obs.disconnect(); }, []);
  useEffect(() => {
    let active = true; let controller; let inFlight = false;
    async function load() {
      if (document.hidden || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const current = today;
      const start = range.mode === 'live' ? shiftDay(current, -1) : range.mode === 'today' ? current : range.start;
      const end = ['live', 'today'].includes(range.mode) ? current : range.end;
      const deadline = setTimeout(() => controller.abort(), timing.browser_history_request_timeout * 1000);
      try { const result = await api(`/history/range?start=${start}&end=${end}`, { signal: controller.signal }); if (active) { setData(result); setError(''); } }
      catch (e) { if (active) setError(e.name === 'AbortError' ? 'History request timed out. Try another range.' : e.message); }
      finally { clearTimeout(deadline); inFlight = false; if (active) setLoading(false); }
    }
    setLoading(true); setData(null); setCursor(null); load();
    const timer = setInterval(load, timing.browser_history_poll_interval * 1000);
    document.addEventListener('visibilitychange', load);
    return () => { active = false; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [range, today]);
  const map = useMemo(() => assignments(rows, state?.snapshot?.sensors || []), [rows, state?.snapshot?.sensors]);
  const series = useMemo(() => zoneHistory(data?.series || [], map, metric), [data, map, metric]);
  const start = range.mode === 'live' ? now - 86400 : range.bounds?.start ?? data?.start ?? eventStore.start ?? now - 86400, end = range.mode === 'live' ? now : range.bounds?.end ?? data?.end ?? eventStore.end ?? now;
  const visibleEvents = eventStore.events.filter(event => event.occurred_at >= start && event.occurred_at < end);
  function selectEvent(event) { setActiveId(event.id); setCursor((event.occurred_at - start) / (end - start)); }
  const displayed = series.map(s => ({ ...s, points: s.points.filter(p => p.time >= start && p.time < end) }));
  const values = displayed.flatMap(s => visible[s.zone] ? s.points.map(p => Number(format(p.value))) : []);
  const lo = values.length ? Math.floor(Math.min(...values) - 2) : metric === 'humidity_pct' ? 0 : metric === 'pressure_hpa' ? 980 : unit === 'F' ? 60 : 15;
  const hi = values.length ? Math.ceil(Math.max(...values) + 2) : metric === 'humidity_pct' ? 100 : metric === 'pressure_hpa' ? 1040 : unit === 'F' ? 100 : 40;
  // Keep a 2:1 landscape canvas at every viewport; labels retain their font size.
  const w = Math.max(1, width), h = w / 2, left = 43, right = w - 12, bottom = h - 34;
  const yTickCount = h < 180 ? 3 : 5;
  const x = t => left + (t - start) / (end - start) * (right - left);
  const y = v => bottom - (Number(format(v)) - lo) / (hi - lo) * (bottom - 24);
  const tickCount = width < 420 ? 3 : 4;
  const ticks = Array.from({ length: tickCount }, (_, i) => start + (end - start) * i / (tickCount - 1));
  const tickLabel = t => end - start > 90000 ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(t * 1000)) : clock(t);
  const selected = cursor == null ? null : start + cursor * (end - start);
  const detail = selected == null ? [] : displayed.filter(s => visible[s.zone]).map(s => {
    const p = s.points.reduce((best, p) => !best || Math.abs(p.time - selected) < Math.abs(best.time - selected) ? p : best, null);
    return { zone: s.zone, point: p && Math.abs(p.time - selected) <= (data?.bucket_seconds || 60) ? p : null };
  });
  function inspectTime(e) {
    const r = e.currentTarget.getBoundingClientRect();
    setCursor(Math.max(0, Math.min(1, ((e.clientX - r.left) * w / r.width - left) / (right - left))));
  }
  function preset(mode) {
    const start = mode === 'yesterday' ? shiftDay(today, -1) : mode === 'week' ? shiftDay(today, -6) : today;
    const end = mode === 'yesterday' ? start : today;
    setRangeError(''); setRange({ mode, start, end }); setDraft({ start, end, startTime: '', endTime: '' });
  }
  function applyRange(next) {
    try {
      const bounds = customHistoryBounds(next);
      setRange({ mode: 'custom', ...next, bounds }); setRangeError(''); setCursor(null); setActiveId(null);
    } catch (error) { setRangeError(error.message); }
  }
  function navigate(offset) {
    const next = { startTime: range.startTime || '', endTime: range.endTime || '', start: shiftDay(range.start, offset), end: shiftDay(range.end, offset) };
    if (next.end <= today) { setDraft(next); applyRange(next); }
  }
  return <section className="panel history" aria-labelledby="history-title">
    <div className="panel-head"><div><h2 id="history-title">{metricLabel} history</h2><p className="muted">The rhythm of your enclosure</p></div><div className="segmented range-presets">{[['live', 'Live · 24h'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', '7 days'], ['custom', 'Custom']].map(([key, label]) => <button key={key} aria-pressed={range.mode === key} onClick={() => preset(key)}>{label}</button>)}</div></div>
    <div className="date-controls"><label>Reading<select aria-label="Reading" value={metric} onChange={e => { setMetric(e.target.value); setCursor(null); }}><option value="temperature_c">Temperature</option><option value="humidity_pct">Humidity</option><option value="pressure_hpa">Pressure</option></select></label></div>
    {range.mode !== 'live' && <form className="date-controls" onSubmit={e => { e.preventDefault(); applyRange(draft); }}>
      <button type="button" aria-label="Previous day" onClick={() => navigate(-1)}>←</button>
      <label>From<input type="date" required max={today} value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
      <label>To<input type="date" required min={draft.start} max={today} value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label>
      {range.mode === 'custom' && <><label>Start time<input type="time" value={draft.startTime} onChange={e => setDraft({ ...draft, startTime: e.target.value })} /></label><label>End time<input type="time" value={draft.endTime} onChange={e => setDraft({ ...draft, endTime: e.target.value })} /></label></>}
      <button type="submit">Apply range</button><button type="button" aria-label="Next day" disabled={range.end >= today} onClick={() => navigate(1)}>→</button><span className="muted">Up to 31 days</span>
    </form>}
    {range.mode === 'custom' && <p className="muted small">Times use America/New_York. Leave times blank for full days. End time is exclusive; repeated daylight-saving times include both occurrences.</p>}
    {rangeError && <p className="warning" role="alert">{rangeError}</p>}
    <div className="legend">{series.map(s => <button key={s.zone} aria-pressed={visible[s.zone]} onClick={() => setVisible({ ...visible, [s.zone]: !visible[s.zone] })}><span className={`dot ${s.zone}`} />{LABELS[s.zone]}</button>)}</div>
    <div ref={host} className="chart-host">
      {loading ? <div className="chart-empty" role="status">Loading recorded readings…</div> : error ? <div className="chart-empty warning" role="status">{error}</div> : !values.length && !visibleEvents.length ? <div className="chart-empty">{!rows.length ? 'Zone assignments unavailable.' : 'No recorded readings in this range for the selected zones.'}</div> : <svg viewBox={`0 0 ${w} ${h}`} role="group" aria-label={`Zone ${metricLabel.toLowerCase()} in ${metricUnit}. Tap or point for values.`} onPointerMove={inspectTime} onPointerDown={inspectTime}>
        <text x="4" y="13">{metricUnit}</text>
        {Array.from({ length: yTickCount }, (_, i) => { const v = lo + (hi - lo) * i / (yTickCount - 1), yy = bottom - i / (yTickCount - 1) * (bottom - 24); return <g key={i}><line x1={left} x2={right} y1={yy} y2={yy} className="gridline" /><text x={left - 8} y={yy + 4} textAnchor="end">{v.toFixed(0)}</text></g>; })}
        {ticks.map((t, i) => <text key={i} x={x(t)} y={h - 10} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{tickLabel(t)}</text>)}
        {displayed.filter(s => visible[s.zone]).map(s => { let previous; const d = s.points.map(p => { const command = !previous || p.time - previous > (data.bucket_seconds * 1.5) ? 'M' : 'L'; previous = p.time; return `${command}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`; }).join(' '); return <g key={s.zone}><path d={d} className={`series ${s.zone}`} />{s.points.length === 1 && <circle cx={x(s.points[0].time)} cy={y(s.points[0].value)} r="3" className={`point ${s.zone}`} />}</g>; })}
        {visibleEvents.map((event, index) => <g key={event.id} className={`event-marker ${event.category} ${activeId === event.id ? 'active' : ''}`} role="button" tabIndex="0" aria-label={`${EVENT_LABELS[event.category]}, ${eventTimeLabel(event.occurred_at)}: ${event.note}`} onPointerMove={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onClick={() => selectEvent(event)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectEvent(event); } }}>
          <title>{`${EVENT_LABELS[event.category]} · ${eventTimeLabel(event.occurred_at)}\n${event.note}`}</title>
          <line x1={x(event.occurred_at)} x2={x(event.occurred_at)} y1="24" y2={bottom} />
          <circle cx={x(event.occurred_at)} cy={28 + index % 3 * 14} r="6" />
          <circle cx={x(event.occurred_at)} cy={28 + index % 3 * 14} r="12" style={{ fill: 'transparent', stroke: 'none' }} />
        </g>)}
        {selected != null && <line style={{ pointerEvents: 'none' }} x1={x(selected)} x2={x(selected)} y1="24" y2={bottom} className="cursor" />}
      </svg>}
    </div>
    {!!values.length && !loading && <label className="chart-scrubber">Inspect time<input aria-label="Inspect historical readings by time" type="range" min="0" max="1000" value={Math.round((cursor || 0) * 1000)} onChange={e => setCursor(Number(e.target.value) / 1000)} /></label>}
    <div className="chart-detail" aria-live="polite">{selected == null ? 'Tap the chart or use the time slider to inspect readings.' : <><strong>{new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(selected * 1000))}</strong>{detail.map(d => <span key={d.zone}>{LABELS[d.zone]}: {d.point ? `${format(d.point.value)} ${metricUnit} · ${d.point.count} sensors` : 'No reading'}</span>)}</>}</div>
    {activeId && visibleEvents.some(event => event.id === activeId) && <div className="chart-detail">{visibleEvents.filter(event => event.id === activeId).map(event => <span key={event.id}><strong>{EVENT_LABELS[event.category]} · {eventTimeLabel(event.occurred_at)}</strong> {event.note}</span>)}</div>}
    <Events store={eventStore} events={visibleEvents} selected={selected} now={now} activeId={activeId} selectEvent={selectEvent} />
    <div className="panel-foot"><span>{data?.bucket_seconds ? `${data.bucket_seconds / 60}-minute averages · gaps show missing data` : 'Recorded sensor history'}</span><span>America/New_York</span></div>
  </section>;
}
