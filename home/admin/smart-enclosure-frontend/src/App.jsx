import { timing } from './timing.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import Dashboard from './ui/Dashboard';
import Settings from './ui/Settings';
import { api, serverNow, dateKey } from './ui/data';
import useFeeding from './ui/useFeeding';
import './ui/styles.css';
import './ui/light.css';
import './ui/theme.css';

export default function App() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0e1926' : '#f0f7fd';
    try { localStorage.setItem('enclosure-theme', theme); } catch { /* Preference storage is optional. */ }
  }, [theme]);
  const [page, setPage] = useState(location.hash === '#settings' ? 'settings' : 'overview');
  const [unit, setUnit] = useState(() => { try { return localStorage.getItem('enclosure-unit') === 'C' ? 'C' : 'F'; } catch { return 'F'; } });
  const [state, setState] = useState(null), [received, setReceived] = useState(0), [error, setError] = useState('');
  const [rows, setRows] = useState([]), [zonesError, setZonesError] = useState(''), [now, setNow] = useState(Date.now() / 1000);
  const inFlight = useRef(null);
  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => { try { const data = await api('/state'); setState(data); setReceived(Date.now() / 1000); setError(''); } catch { setError('Connection interrupted. Waiting for fresh enclosure data.'); } finally { inFlight.current = null; } })();
    return inFlight.current;
  }, []);
  useEffect(() => { refresh(); const timer = setInterval(() => { if (!document.hidden) refresh(); }, timing.browser_state_poll_interval * 1000); const tick = setInterval(() => setNow(Date.now() / 1000), timing.browser_clock_interval * 1000); const focus = () => { if (!document.hidden) refresh(); }; document.addEventListener('visibilitychange', focus); return () => { clearInterval(timer); clearInterval(tick); document.removeEventListener('visibilitychange', focus); }; }, [refresh]);
  useEffect(() => { let active = true; async function load() { try { const d = await api('/zones'); if (active) { setRows(d.zones); setZonesError(d.zones.length ? '' : 'No zone assignments are available.'); } } catch { if (active) setZonesError('Zone assignments could not be refreshed. Retaining any previously loaded assignments.'); } } load(); const timer = setInterval(load, timing.browser_zones_poll_interval * 1000); return () => { active = false; clearInterval(timer); }; }, []);
  useEffect(() => { const change = () => setPage(location.hash === '#settings' ? 'settings' : 'overview'); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const fresh = !error && now - received <= timing.browser_state_stale_after;
  const feeding = useFeeding(dateKey(new Date(serverNow(state, received, now) * 1000)));
  function chooseUnit(u) { setUnit(u); try { localStorage.setItem('enclosure-unit', u); } catch { /* Preference storage is optional. */ } }
  return <div className="app"><header className="topbar"><a href="#overview" className="brand"><span className="brand-mark" aria-hidden="true">↟</span>Smart Enclosure</a><nav aria-label="Main navigation"><a href="#overview" aria-current={page === 'overview' ? 'page' : undefined}>Overview</a><a href="#settings" aria-current={page === 'settings' ? 'page' : undefined}>Settings</a><a href="/debug.html">Debug ↗</a></nav><div className="header-controls"><button className="theme-toggle" aria-label="Dark mode" aria-pressed={theme === 'dark'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span><span>{theme === 'dark' ? 'Dark' : 'Light'}</span></button><div className="segmented units" aria-label="Temperature unit">{['F', 'C'].map(u => <button key={u} aria-pressed={unit === u} onClick={() => chooseUnit(u)}>°{u}</button>)}</div></div></header>
    <main><div className="connection"><span className={`status-dot ${fresh && state?.connection?.status === 'connected' ? 'connected' : ''}`} />{error || (!state ? 'Connecting to enclosure…' : fresh && state.connection.status === 'connected' ? 'Connected to enclosure' : 'Enclosure data unavailable or stale')}<span className="connection-time">America/New_York</span></div>
      {page === 'settings' ? <Settings state={state} enabled={fresh && state?.controls_enabled} refresh={refresh} feeding={feeding} /> : <Dashboard state={state} rows={rows} unit={unit} now={serverNow(state, received, now)} fresh={fresh} zonesError={zonesError} feeding={feeding} />}
      <footer><span>Smart Enclosure</span><span>{state?.history?.status === 'recording' ? 'History recording' : `History: ${(state?.history?.status || 'connecting').replaceAll('_', ' ')}`}</span></footer>
    </main></div>;
}
