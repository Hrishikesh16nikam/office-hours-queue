import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';

/**
 * Fetch JSON from the API. With `pollMs`, refreshes on that interval while the
 * page is visible (and right away when it becomes visible again), so the
 * queue stays live without WebSockets.
 */
export function useApi<T>(path: string | null, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const ticket = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++ticket.current;
    try {
      const r = await api<T>(path);
      if (mine === ticket.current) {
        setData(r);
        setError(null);
        setStatus(200);
      }
    } catch (e) {
      if (mine === ticket.current) {
        setError((e as Error).message);
        setStatus((e as { status?: number }).status ?? 0);
      }
    }
  }, [path]);

  useEffect(() => {
    void reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    let timer: number | undefined;
    if (pollMs > 0) {
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void reload();
      }, pollMs);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) window.clearInterval(timer);
    };
  }, [reload, pollMs]);

  return { data, error, status, reload, setData };
}

/** Minimal client-side routing on the History API. */
export function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((to: string) => {
    if (to !== window.location.pathname) window.history.pushState(null, '', to);
    setPath(to);
    window.scrollTo({ top: 0 });
  }, []);
  return [path, go];
}

/** Re-renders every `ms` so "waited 12 min" labels stay current. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}
