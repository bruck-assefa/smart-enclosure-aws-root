import { useEffect, useState } from 'react';
import { api } from './data';
import './feeding.css';

const FOODS = ['salad', 'bugs'];
const NAMES = { salad: 'Salad', bugs: 'Bugs' };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function formatDay(value) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00Z`));
}
function FoodTag({ food }) {
  return <span className={`food-tag ${food}`}><span aria-hidden="true">{food === 'salad' ? '🥬' : '🦗'}</span>{NAMES[food]}</span>;
}

export function FeedingToday({ feeding }) {
  const { data, fresh, error, accept, refresh } = feeding;
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function complete(food) {
    if (!fresh || busy) return;
    setBusy(true); setMessage('Recording feeding…');
    try {
      const saved = await api('/feeding/complete?source=hardware', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Enclosure-Control': '1' }, body: JSON.stringify({ food, version: data.version, date: data.date }) });
      accept(saved); setMessage(`${NAMES[food]} feeding recorded.`);
    } catch (e) { setMessage(e.message); await refresh(); }
    finally { setBusy(false); }
  }
  const configured = data && FOODS.some(food => data.schedules[food].enabled);
  return <section className="panel feeding-today" aria-labelledby="feeding-today-title">
    <div><p className="eyebrow" id="feeding-today-title">FEEDING TODAY</p>
      <div className="feeding-today-value">{!fresh ? <span>{error ? 'Schedule unavailable' : 'Checking feeding schedule…'}</span> : !configured ? <span>Choose a feeding routine</span> : data.today.length ? data.today.map(food => <div className="feeding-action" key={food}><FoodTag food={food} /><button type="button" disabled={busy} onClick={() => complete(food)}>Mark {NAMES[food].toLowerCase()} fed</button>{data.due?.[food] < data.date && <span className="muted small">Carried over from {formatDay(data.due[food])}</span>}</div>) : <span>No feeding due today</span>}</div>
      <p className="muted small">{fresh ? `${formatDay(data.date)} · enclosure time` : 'Waiting for the saved plan'}</p>
      <p className="muted small">Unconfirmed feedings carry forward each day until marked fed.</p>
      <p role="status" className="small">{message}</p>
    </div>
    {fresh && configured && <div className="feeding-next">{FOODS.filter(food => data.next[food]).map(food => <p key={food}>Next {NAMES[food].toLowerCase()} <strong>{formatDay(data.next[food])}</strong></p>)}</div>}
    <a className="feeding-settings-link" href="#settings">{configured ? 'Edit feeding schedule' : 'Set up feeding schedule'} →</a>
  </section>;
}

export function FeedingSettings({ feeding }) {
  const { data, fresh, error, accept, refresh } = feeding;
  const [draft, setDraft] = useState(null), [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    if (data && !dirty && !busy) setDraft({ version: data.version, schedules: data.schedules });
  }, [data, dirty, busy]);
  function change(food, patch) {
    setDraft(d => {
      const plan = { ...d.schedules[food], ...patch };
      if (!plan.enabled || plan.mode === 'weekly') {
        // Inactive fields must not prevent disabling or switching a schedule.
        if (!Number.isInteger(plan.every_days) || plan.every_days < 1 || plan.every_days > 365) plan.every_days = 1;
        if (plan.start_date && (plan.start_date < '2000-01-01' || plan.start_date > '2100-12-31')) plan.start_date = null;
      }
      return { ...d, schedules: { ...d.schedules, [food]: plan } };
    });
    setDirty(true); setMessage('Unsaved feeding changes');
  }
  async function save(event) {
    event.preventDefault(); if (!fresh || busy || !draft) return;
    for (const food of FOODS) {
      const plan = draft.schedules[food];
      if (plan.enabled && plan.mode === 'weekly' && !plan.weekdays.length) { setMessage(`Select at least one weekday for ${NAMES[food].toLowerCase()}.`); return; }
    }
    setBusy(true); setMessage('Saving feeding schedule…');
    try {
      const saved = await api('/feeding?source=hardware', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Enclosure-Control': '1' }, body: JSON.stringify(draft) });
      accept(saved); setDraft({ version: saved.version, schedules: saved.schedules }); setDirty(false);
      setMessage('Feeding schedule saved. Today’s plan is updated.');
    } catch (e) { setMessage(`${e.message} Your edits are retained.`); }
    finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true);
    try { const saved = await refresh(); if (saved) { setDraft({ version: saved.version, schedules: saved.schedules }); setDirty(false); setMessage('Saved feeding plan loaded; unsaved changes discarded.'); } else setMessage('Unable to reload. Your edits are retained.'); }
    finally { setBusy(false); }
  }
  return <section className="feeding-settings" aria-labelledby="feeding-settings-title">
    <div className="settings-section-heading"><h2 id="feeding-settings-title">Feeding schedule</h2><p className="muted">Choose weekdays or repeat every N days. Salad and bugs can share a day. Changing a food’s routine resets its outstanding feeding; history is kept.</p></div>
    {!draft ? <div className="panel empty"><p role="status">{error || 'Loading feeding settings…'}</p>{error && <button type="button" onClick={refresh}>Retry</button>}</div> : <form onSubmit={save}>
      {error && <p className="notice warning" role="status">{error} Your edits will be kept until you can save.</p>}
      <div className="settings-grid">{FOODS.map(food => {
        const plan = draft.schedules[food];
        return <fieldset key={food} className="panel feeding-form" disabled={busy}>
          <legend>{NAMES[food]} schedule</legend>
          <label className="feeding-enabled"><input type="checkbox" checked={plan.enabled} onChange={e => change(food, { enabled: e.target.checked })} />Schedule {NAMES[food].toLowerCase()}</label>
          {!plan.enabled && <p className="muted small">Not scheduled. Enable to choose feeding days.</p>}
          <div className="feeding-fields">
            <label>Repeat<select disabled={!plan.enabled} value={plan.mode} onChange={e => change(food, { mode: e.target.value, start_date: plan.start_date || data.date })}>
              <option value="weekly">On selected weekdays</option><option value="interval">Every N days</option>
            </select></label>
            {plan.mode === 'weekly' ? <div><p className="field-label">Days of the week</p><div className="weekday-picker" role="group" aria-label={`${NAMES[food]} weekdays`}>{DAYS.map((day, index) => <button key={day} type="button" disabled={!plan.enabled} aria-pressed={plan.weekdays.includes(index)} onClick={() => change(food, { weekdays: plan.weekdays.includes(index) ? plan.weekdays.filter(d => d !== index) : [...plan.weekdays, index].sort() })}>{day}</button>)}</div><p className="muted small">Select all seven for every day.</p></div> : <><div className="feeding-interval"><label>Every (days)<input type="number" disabled={!plan.enabled} min="1" max="365" step="1" required={plan.enabled} value={plan.every_days} onChange={e => change(food, { every_days: e.target.value === '' ? '' : Number(e.target.value) })} /></label><label>Starting on<input type="date" disabled={!plan.enabled} min="2000-01-01" max="2100-12-31" required={plan.enabled} value={plan.start_date || ''} onChange={e => change(food, { start_date: e.target.value || null })} /></label></div><p className="muted small">The start date is a feeding day, then every {plan.every_days || 'N'} days after that. Use 1 for every day.</p></>}
          </div>
        </fieldset>;
      })}</div>
      <div className="feeding-save"><button type="submit" className="primary" disabled={!fresh || !dirty || busy}>{busy ? 'Working…' : 'Save feeding schedule'}</button><button type="button" disabled={busy} onClick={reload}>Reload saved plan</button><p role="status">{message || 'Schedules use America/New_York calendar days.'}</p></div>
    </form>}
    {fresh && data && FOODS.some(food => data.schedules[food].enabled) && <div className="feeding-week"><h3>Saved routine · next 7 days</h3><div className="feeding-week-grid">{data.upcoming.map((day, i) => <div key={day.date} className="feeding-day"><strong>{i === 0 ? 'Today' : formatDay(day.date).split(',')[0]}</strong><span className="muted small">{formatDay(day.date).split(',').slice(1).join(',').trim()}</span><div>{day.foods.length ? day.foods.map(food => <FoodTag key={food} food={food} />) : <span className="muted small">No feeding</span>}</div></div>)}</div></div>}
    {fresh && data && <section className="feeding-history" aria-labelledby="feeding-history-title"><h3 id="feeding-history-title">Feeding history</h3><p className="muted small">Latest 100 confirmations · enclosure time. Missed feedings of the same food combine into one outstanding feeding; future dates follow the saved routine.</p>{data.history?.length ? <div className="feeding-history-scroll"><table><thead><tr><th>Food</th><th>Scheduled</th><th>Completed</th></tr></thead><tbody>{data.history.map(item => <tr key={`${item.food}-${item.completed_date}`}><td><FoodTag food={item.food} /></td><td>{item.scheduled_date}</td><td>{item.completed_date}</td></tr>)}</tbody></table></div> : <p className="muted">No feedings confirmed yet.</p>}</section>}
  </section>;
}
