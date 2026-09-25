import { timing } from '../timing.js';
import { useCallback, useEffect, useState } from 'react';
import { api } from './data';

export default function useEvents(start, end) {
  const [result, setResult] = useState({ key: '', events: [], error: '', loaded: false });
  const key = `${start}/${end}`;
  const [generation] = useState(() => ({ value: 0, key }));
  const refresh = useCallback(async () => {
    if (generation.key !== key) return;
    const current = ++generation.value;
    try {
      const data = await api(`/events?start=${start}&end=${end}`, { signal: AbortSignal.timeout(timing.browser_events_request_timeout * 1000) });
      if (current === generation.value) setResult({ key, events: data.events, start: data.start, end: data.end, error: '', loaded: true });
    } catch (error) {
      if (current === generation.value) setResult(previous => ({ key, start: previous.key === key ? previous.start : null, end: previous.key === key ? previous.end : null, events: previous.key === key ? previous.events : [], error: error.message, loaded: true }));
    }
  }, [start, end, key, generation]);
  useEffect(() => {
    generation.key = key;
    refresh();
    const load = () => { if (!document.hidden) refresh(); };
    const timer = setInterval(load, timing.browser_events_poll_interval * 1000);
    document.addEventListener('visibilitychange', load);
    return () => { generation.value++; clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [refresh, generation, key]);
  return { start: result.key === key ? result.start : null, end: result.key === key ? result.end : null, events: result.key === key ? result.events : [], error: result.key === key ? result.error : '', loading: result.key !== key || !result.loaded, refresh };
}
