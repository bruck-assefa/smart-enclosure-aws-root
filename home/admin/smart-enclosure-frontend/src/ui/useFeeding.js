import { timing } from '../timing.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './data';

export default function useFeeding(day) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [received, setReceived] = useState(0);
  const active = useRef(false), pending = useRef(null);
  const accept = useCallback(next => {
    if (!active.current) return;
    setData(previous => previous && previous.version > next.version ? previous : next);
    setReceived(Date.now()); setError('');
  }, []);
  const refresh = useCallback(async () => {
    if (pending.current) return pending.current;
    pending.current = (async () => {
      try { const next = await api('/feeding'); accept(next); return next; }
      catch { if (active.current) setError('Feeding schedule is temporarily unavailable.'); return null; }
      finally { pending.current = null; }
    })();
    return pending.current;
  }, [accept]);
  useEffect(() => {
    active.current = true;
    const load = () => { if (!document.hidden) refresh(); };
    load(); const timer = setInterval(load, timing.browser_feeding_poll_interval * 1000);
    document.addEventListener('visibilitychange', load);
    return () => { active.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [refresh, day]);
  return { data, error, refresh, accept,
    fresh: !!data && !error && Date.now() - received < timing.browser_feeding_stale_after * 1000 && data.date === day };
}
