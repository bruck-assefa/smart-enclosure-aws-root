import { useEffect, useState } from 'react';
import { api, clock, dateKey } from './data';
import { FeedingSettings } from './Feeding';

function RelayForm({ relay, enabled, refresh }) {
  const [draft, setDraft] = useState(relay), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [pending, setPending] = useState(null);
  useEffect(() => {
    if (pending && ['name', 'mode', 'on_time', 'off_time'].every(k => relay[k] === pending[k])) {
      setPending(null); setDirty(false); setDraft(relay); setMessage('Saved on enclosure.');
    } else if (!dirty && !busy && !pending) setDraft(relay);
  }, [relay, dirty, busy, pending]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => { setPending(null); setDirty(true); setMessage('Saved response received, but current settings could not be confirmed. Check the overview before saving again.'); }, 20000);
    return () => clearTimeout(timer);
  }, [pending]);
  function change(key, value) { setDraft(d => ({ ...d, [key]: value })); setDirty(true); setMessage('Unsaved changes'); }
  async function save(e) {
    e.preventDefault(); if (busy || !enabled) return;
    if (draft.mode === 'custom' && draft.on_time === draft.off_time) { setMessage('Choose different on and off times.'); return; }
    setBusy(true); setMessage('Saving to enclosure…');
    try {
      const result = await api(`/schedules/${relay.relay_id}?source=hardware`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Enclosure-Control': '1' }, body: JSON.stringify({ name: draft.name.trim(), mode: draft.mode, on_time: draft.on_time, off_time: draft.off_time }) });
      setDraft(result); setPending(result); setMessage('Saved · waiting for refreshed enclosure state.'); await refresh();
    } catch (e) { setMessage(`${e.message}. Your edits are retained; check the overview before retrying.`); }
    finally { setBusy(false); }
  }
  return <form className="panel relay-form" onSubmit={save}>
    <div className="panel-head"><h2>Relay {relay.relay_id}</h2><span className="muted small">Physical output {relay.relay_id}</span></div>
    <label>Device name<input disabled={busy || !!pending} required maxLength="60" value={draft.name || ''} onChange={e => change('name', e.target.value)} placeholder={`Relay ${relay.relay_id}`} /></label>
    <label>Schedule<select disabled={busy || !!pending} value={draft.mode === 'auto' ? 'sun' : draft.mode} onChange={e => change('mode', e.target.value)}><option value="sun">Follow sunrise / sunset</option><option value="custom">Custom daily schedule</option></select></label>
    {draft.mode === 'custom' ? <><div className="custom-times"><label>Turn on<input disabled={busy || !!pending} type="time" required value={draft.on_time} onChange={e => change('on_time', e.target.value)} /></label><label>Turn off<input disabled={busy || !!pending} type="time" required value={draft.off_time} onChange={e => change('off_time', e.target.value)} /></label></div><p className="muted small">{draft.off_time < draft.on_time ? 'Turns off the following day.' : 'Repeats every day.'} All times are America/New_York.</p></> : <p className="schedule-note">On at sunrise · off at sunset.<br />Times adjust daily for McNair, Virginia.</p>}
    <div className="form-actions"><button className="primary" disabled={!enabled || !dirty || busy || !!pending} type="submit">{busy ? 'Saving…' : 'Save relay'}</button><button type="button" disabled={!dirty || busy || !!pending} onClick={() => { setDraft(relay); setDirty(false); setMessage('Changes discarded'); }}>Discard</button></div>
    <p className="form-status" role="status">{message || (!enabled ? 'Saving unavailable until current relay state is received.' : 'Changes apply to the real enclosure after saving.')}</p>
  </form>;
}

export default function Settings({ state, enabled, refresh, feeding }) {
  const relays = state?.schedules?.data, sun = state?.daylight?.data;
  const sunFresh = enabled && !state?.daylight?.error && sun?.date === dateKey(new Date(state.snapshot.generated_at * 1000));
  return <section><div className="section-heading"><h1>Enclosure settings</h1><p className="muted">Set the daily routine for feeding and lighting.</p></div>
    <FeedingSettings feeding={feeding} />
    <div className="settings-section-heading"><h2>Relay settings</h2><p className="muted">Give each device a name and choose its daily rhythm.</p></div>
    <div className="settings-context"><span>{sunFresh ? <>Sunrise <strong>{clock(sun.sunrise)}</strong> · Sunset <strong>{clock(sun.sunset)}</strong></> : 'Waiting for today’s solar times'}</span><span>{sun?.location || 'McNair, Virginia'} · America/New_York</span></div>
    {!relays?.length ? <div className="panel empty">Waiting for relay settings from the enclosure…</div> : <div className="settings-grid">{relays.map(relay => <RelayForm key={relay.relay_id} relay={relay} enabled={enabled} refresh={refresh} />)}</div>}
  </section>;
}
