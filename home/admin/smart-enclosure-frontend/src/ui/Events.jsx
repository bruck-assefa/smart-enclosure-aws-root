import { useState } from 'react';
import { api } from './data';
import { EVENT_LABELS, eventLocalTime, eventFold, eventTimeLabel } from './eventData';
import './events.css';

export default function Events({ store, events, selected, now, activeId, selectEvent }) {
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  function open(event, stamp = now) {
    setDraft(event ? { id: event.id, version: event.version, local_time: event.local_time, fold: event.fold, category: event.category, note: event.note } : {
      id: crypto.randomUUID(), version: 0, local_time: eventLocalTime(stamp), fold: eventFold(stamp), category: 'other', note: '',
    });
    setMessage(''); setConfirmDelete(false);
  }
  async function save(deleting = false) {
    setBusy(true); setMessage('');
    try {
      await api('/events?source=hardware', {
        method: deleting ? 'DELETE' : draft.version ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Enclosure-Control': '1' },
        body: JSON.stringify(deleting ? { id: draft.id, version: draft.version } : draft),
        signal: AbortSignal.timeout(8000),
      });
      setDraft(null); setConfirmDelete(false); setMessage(deleting ? 'Event deleted.' : 'Event saved.');
      await store.refresh();
    } catch (error) { setMessage(`${error.message} Your draft is retained. Reload events to check the saved record.`); }
    finally { setBusy(false); }
  }
  return <div className="events-panel">
    <div className="event-heading"><div><h3>Enclosure events</h3><p className="muted">Manual notes for this time range</p></div><div className="event-actions">
      <button type="button" disabled={busy || !!draft} onClick={() => open(null)}>Add event now</button>
      {selected != null && selected <= now && <button type="button" disabled={busy || !!draft} onClick={() => open(null, selected)}>Add note at selected time</button>}
    </div></div>
    {draft && <form className="event-form" onSubmit={e => { e.preventDefault(); save(); }}>
      <h3>{draft.version ? 'Edit event' : 'Add event'}</h3>
      <fieldset disabled={busy}>
        <div className="event-fields">
          <label>Category<select aria-label="Category" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>{Object.entries(EVENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Date and time · America/New_York<input required type="datetime-local" min="2000-01-01T00:00" max={eventLocalTime(now)} value={draft.local_time} onChange={e => setDraft({ ...draft, local_time: e.target.value, fold: 0 })} /></label>
        </div>
        <details><summary>Daylight saving time</summary><label>If this time occurs twice when clocks turn back<select value={draft.fold} onChange={e => setDraft({ ...draft, fold: Number(e.target.value) })}><option value={0}>First occurrence</option><option value={1}>Second occurrence</option></select></label></details>
        <label>Note<textarea aria-label="Note" autoFocus required maxLength={2000} rows={3} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} placeholder="For example: Replaced the basking bulb with a 100W bulb." /></label>
        <div className="event-actions"><button className="primary" type="submit">{busy ? 'Saving…' : 'Save event'}</button><button type="button" onClick={() => { setDraft(null); setMessage(''); setConfirmDelete(false); }}>Cancel</button>{draft.version > 0 && <button type="button" onClick={() => setConfirmDelete(true)}>Delete event</button>}</div>
        {confirmDelete && <div className="event-delete"><p>Delete this event from the historical charts?</p><button type="button" onClick={() => save(true)}>Confirm delete</button><button type="button" onClick={() => setConfirmDelete(false)}>Keep event</button></div>}
      </fieldset>
    </form>}
    {message && <p role="status">{message}</p>}
    {store.error && <p className="warning" role="status">Events could not be refreshed. Any notes shown may be outdated. {store.error}</p>}
    <button className="event-refresh" type="button" disabled={busy} onClick={store.refresh}>Reload events</button>
    {store.loading ? <p role="status">Loading events…</p> : !events.length && !store.error ? <p className="muted">No events recorded in this range.</p> : null}
    <ul className="event-list">{events.map(event => <li key={event.id} className={activeId === event.id ? 'event-selected' : ''}>
      <button type="button" className="event-time" onClick={() => selectEvent(event)}><span className={`event-dot ${event.category}`} aria-hidden="true" /><strong>{EVENT_LABELS[event.category]}</strong><span>{eventTimeLabel(event.occurred_at)}</span></button>
      <p>{event.note}</p><button type="button" disabled={busy || !!draft} onClick={() => open(event)}>Edit event</button>
    </li>)}</ul>
  </div>;
}
