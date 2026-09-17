import { useEffect, useMemo, useRef, useState } from 'react';
import { api, assignments, clock, dateKey, LABELS, shiftDay, temp, zoneHistory } from './data';

export default function History({ unit, state, rows }) {
  const today = dateKey();
  const [range, setRange] = useState({ mode: 'live', start: today, end: today });
  const [draft, setDraft] = useState({ start: today, end: today });
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null), [width, setWidth] = useState(600);
  const [visible, setVisible] = useState({ Warm: true, Transition: true, Cool: true });
  const host = useRef(null);
  useEffect(() => { const obs = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width)); obs.observe(host.current); return () => obs.disconnect(); }, []);
  useEffect(() => {
    let active = true; let controller; let inFlight = false;
    async function load() {
      if (document.hidden || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const current = dateKey();
      const start = range.mode === 'live' ? shiftDay(current, -1) : range.mode === 'today' ? current : range.start;
      const end = ['live', 'today'].includes(range.mode) ? current : range.end;
      const deadline = setTimeout(() => controller.abort(), 8000);
      try { const result = await api(`/history/range?start=${start}&end=${end}`, { signal: controller.signal }); if (active) { setData(result); setError(''); } }
      catch (e) { if (active) setError(e.name === 'AbortError' ? 'History request timed out. Try another range.' : e.message); }
      finally { clearTimeout(deadline); inFlight = false; if (active) setLoading(false); }
    }
    setLoading(true); setData(null); setCursor(null); load();
    const timer = setInterval(load, 60000);
    document.addEventListener('visibilitychange', load);
    return () => { active = false; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [range]);
  const map = useMemo(() => assignments(rows, state?.snapshot?.sensors || []), [rows, state?.snapshot?.sensors]);
  const series = useMemo(() => zoneHistory(data?.series || [], map), [data, map]);
  const now = Date.now() / 1000, start = range.mode === 'live' ? now - 86400 : data?.start || now - 86400, end = range.mode === 'live' ? now : data?.end || now;
  const displayed = series.map(s => ({ ...s, points: s.points.filter(p => p.time >= start && p.time <= end) }));
  const values = displayed.flatMap(s => visible[s.zone] ? s.points.map(p => Number(temp(p.value, unit))) : []);
  const lo = values.length ? Math.floor(Math.min(...values) - 2) : unit === 'F' ? 60 : 15;
  const hi = values.length ? Math.ceil(Math.max(...values) + 2) : unit === 'F' ? 100 : 40;
  const w = Math.max(240, width), h = 280, left = 43, right = w - 12, bottom = h - 34;
  const x = t => left + (t - start) / (end - start) * (right - left);
  const y = v => bottom - (Number(temp(v, unit)) - lo) / (hi - lo) * (bottom - 24);
  const ticks = Array.from({ length: 4 }, (_, i) => start + (end - start) * i / 3);
  const tickLabel = t => end - start > 90000 ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(t * 1000)) : clock(t);
  const selected = cursor == null ? null : start + cursor * (end - start);
  const detail = selected == null ? [] : displayed.filter(s => visible[s.zone]).map(s => {
    const p = s.points.reduce((best, p) => !best || Math.abs(p.time - selected) < Math.abs(best.time - selected) ? p : best, null);
    return { zone: s.zone, point: p && Math.abs(p.time - selected) <= (data?.bucket_seconds || 60) ? p : null };
  });
  function preset(mode) {
    const start = mode === 'yesterday' ? shiftDay(today, -1) : mode === 'week' ? shiftDay(today, -6) : today;
    const end = mode === 'yesterday' ? start : today;
    setRange({ mode, start, end }); setDraft({ start, end });
  }
  function navigate(offset) { const start = shiftDay(range.start, offset), end = shiftDay(range.end, offset); if (end <= today) { setRange({ mode: 'custom', start, end }); setDraft({ start, end }); } }
  return <section className="panel history" aria-labelledby="history-title">
    <div className="panel-head"><div><h2 id="history-title">Temperature history</h2><p className="muted">The rhythm of your enclosure</p></div><div className="segmented range-presets">{[['live', 'Live · 24h'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', '7 days'], ['custom', 'Custom']].map(([key, label]) => <button key={key} aria-pressed={range.mode === key} onClick={() => preset(key)}>{label}</button>)}</div></div>
    {range.mode !== 'live' && <form className="date-controls" onSubmit={e => { e.preventDefault(); setRange({ mode: 'custom', ...draft }); }}>
      <button type="button" aria-label="Previous day" onClick={() => navigate(-1)}>←</button>
      <label>From<input type="date" required max={today} value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
      <label>To<input type="date" required min={draft.start} max={today} value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label>
      <button type="submit">Apply dates</button><button type="button" aria-label="Next day" disabled={range.end >= today} onClick={() => navigate(1)}>→</button><span className="muted">Up to 31 days</span>
    </form>}
    <div className="legend">{series.map(s => <button key={s.zone} aria-pressed={visible[s.zone]} onClick={() => setVisible({ ...visible, [s.zone]: !visible[s.zone] })}><span className={`dot ${s.zone}`} />{LABELS[s.zone]}</button>)}</div>
    <div ref={host} className="chart-host">
      {loading ? <div className="chart-empty" role="status">Loading recorded temperatures…</div> : error ? <div className="chart-empty warning" role="status">{error}</div> : !values.length ? <div className="chart-empty">{!rows.length ? 'Zone assignments unavailable.' : 'No recorded readings in this range for the selected zones.'}</div> : <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Zone temperatures in degrees ${unit}. Tap or point for values.`} onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); setCursor(Math.max(0, Math.min(1, ((e.clientX - r.left) * w / r.width - left) / (right - left)))); }}>
        <text x="4" y="13">°{unit}</text>
        {[0, 1, 2, 3, 4].map(i => { const v = lo + (hi - lo) * i / 4, yy = bottom - i / 4 * (bottom - 24); return <g key={i}><line x1={left} x2={right} y1={yy} y2={yy} className="gridline" /><text x={left - 8} y={yy + 4} textAnchor="end">{v.toFixed(0)}</text></g>; })}
        {ticks.map((t, i) => <text key={i} x={x(t)} y={h - 10} textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}>{tickLabel(t)}</text>)}
        {displayed.filter(s => visible[s.zone]).map(s => { let previous; const d = s.points.map(p => { const command = !previous || p.time - previous > (data.bucket_seconds * 1.5) ? 'M' : 'L'; previous = p.time; return `${command}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`; }).join(' '); return <g key={s.zone}><path d={d} className={`series ${s.zone}`} />{s.points.length === 1 && <circle cx={x(s.points[0].time)} cy={y(s.points[0].value)} r="3" className={`point ${s.zone}`} />}</g>; })}
        {selected != null && <line x1={x(selected)} x2={x(selected)} y1="24" y2={bottom} className="cursor" />}
      </svg>}
    </div>
    {!!values.length && !loading && <label className="chart-scrubber">Inspect time<input aria-label="Inspect historical temperatures by time" type="range" min="0" max="1000" value={Math.round((cursor || 0) * 1000)} onChange={e => setCursor(Number(e.target.value) / 1000)} /></label>}
    <div className="chart-detail" aria-live="polite">{selected == null ? 'Tap the chart or use the time slider to inspect readings.' : <><strong>{new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(selected * 1000))}</strong>{detail.map(d => <span key={d.zone}>{LABELS[d.zone]}: {d.point ? `${temp(d.point.value, unit)}°${unit} · ${d.point.count} sensors` : 'No reading'}</span>)}</>}</div>
    <div className="panel-foot"><span>{data?.bucket_seconds ? `${data.bucket_seconds / 60}-minute averages · gaps show missing data` : 'Recorded sensor history'}</span><span>America/New_York</span></div>
  </section>;
}
