import { useState } from 'react';
import History from './History';
import { clock, dateKey, LABELS, liveZones, temp } from './data';

function Camera({ available }) {
  const [open, setOpen] = useState(false), [expanded, setExpanded] = useState(false);
  return <section className={`panel camera ${expanded ? 'expanded' : ''}`}><div className="panel-head"><div><h2>Inside the enclosure</h2><p className="muted">Camera view</p></div><span className="badge">{open ? 'Stream requested' : 'On demand'}</span></div>
    <div className="camera-screen">{open ? <iframe src="/camera/" title="Live enclosure camera" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen /> : <div className="camera-empty"><span className="camera-symbol" aria-hidden="true">◉</span><h3>A window into their world</h3><p>Your enclosure, in real time.</p><button className="primary" disabled={!available} onClick={() => setOpen(true)}>View camera</button>{!available && <p>Waiting for the enclosure connection.</p>}</div>}</div>
    <div className="panel-foot"><span>{open ? 'Player shows stream status · video may take a moment' : 'Starts only when you open it'}</span><div className="actions">{open && <button onClick={() => setOpen(false)}>Close camera</button>}<button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Collapse' : 'Expand'}</button></div></div>
  </section>;
}

function Daylight({ state, now, fresh }) {
  const sun = state?.daylight?.data, schedules = state?.schedules?.data || [];
  const valid = fresh && sun?.date === dateKey(new Date(now * 1000)) && !state?.daylight?.error;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now * 1000)).split(':');
  const percent = (Number(parts[0]) * 60 + Number(parts[1])) / 1440 * 100;
  function position(stamp) { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(stamp * 1000)).split(':'); return (Number(p[0]) * 60 + Number(p[1])) / 1440 * 100; }
  const day = valid && now >= sun.sunrise && now < sun.sunset;
  return <section className="panel daylight"><div className="panel-head"><h2>Daylight schedule</h2><span className="badge">{valid ? day ? 'Day cycle' : 'Night cycle' : 'Unverified'}</span></div><p className="muted">{sun?.location || 'McNair, Virginia'} · enclosure time</p>
    <div className="sun-times"><div><span className="muted">↗ Sunrise · on</span><strong>{valid ? clock(sun.sunrise) : '—'}</strong></div><div><span className="muted">↘ Sunset · off</span><strong>{valid ? clock(sun.sunset) : '—'}</strong></div></div>
    <div className="day-track" role="img" aria-label={`Current enclosure time ${clock(now)}. ${valid ? `Sunrise ${clock(sun.sunrise)}, sunset ${clock(sun.sunset)}` : 'Solar times unavailable'}`}>
      {valid && <span className="day-fill" style={{ left: `${position(sun.sunrise)}%`, width: `${position(sun.sunset) - position(sun.sunrise)}%` }} />}<span className="now-marker" style={{ left: `${percent}%` }} />
    </div><div className="timeline-labels"><span>12 AM</span><span>Now · {clock(now)}</span><span>12 AM</span></div>
    <p className="cycle-note">{valid ? day ? `Sun-cycle relays turn off at ${clock(sun.sunset)}` : now < sun.sunrise ? `Sun-cycle relays turn on at ${clock(sun.sunrise)}` : 'Daylight ended · next cycle begins tomorrow' : 'Waiting for today’s solar times'}</p>
    <div className="relay-list">{schedules.map(r => <div className="relay-row" key={r.relay_id}><div><strong>{r.name || `Relay ${r.relay_id}`}</strong><span>{r.mode === 'custom' ? 'Custom' : 'Sun cycle'} · {r.on_time}–{r.off_time}{r.off_time < r.on_time ? ' (+1 day)' : ''}</span></div><span className="relay-state">{fresh && !state?.relays?.error ? state?.relays?.data?.[r.relay_id]?.toUpperCase() || 'UNKNOWN' : 'UNKNOWN'}</span></div>)}</div>
  </section>;
}

export default function Dashboard({ state, rows, unit, now, fresh, zonesError }) {
  const zones = liveZones(fresh ? state : null, rows, now);
  return <><div className="section-heading"><p className="eyebrow">YOUR ENCLOSURE, AT A GLANCE</p><h1>A little closer to nature.</h1><p className="muted">Live temperatures and the daily rhythm of your enclosure.</p></div>
    {zonesError && <p className="notice warning" role="status">{zonesError}</p>}
    <section className="zones" aria-label="Current zone temperatures">{zones.map(z => <article className="zone" key={z.zone}><div className="zone-name"><span className={`dot ${z.zone}`} />{LABELS[z.zone]}</div><div className="reading">{temp(z.value, unit)}<small>°{unit}</small></div><p className={`zone-foot ${z.count < z.total ? 'warning' : ''}`}>{z.count ? `${z.count}/${z.total} sensors · updated ${z.age}s ago` : 'No fresh readings'}{z.count > 0 && z.count < z.total ? ' · partial' : ''}</p></article>)}</section>
    <div className="dashboard-grid"><Camera available={fresh && state?.live_available && state?.connection?.status === 'connected'} /><Daylight state={state} now={now} fresh={fresh} /><History unit={unit} state={state} rows={rows} now={now} /></div>
  </>;
}
