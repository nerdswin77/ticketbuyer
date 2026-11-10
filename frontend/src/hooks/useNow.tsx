import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const NowContext = createContext<number>(Date.now());

/**
 * Server-synced clock for countdowns. Ticks once per second, aligned to the second boundary,
 * so every countdown on the page changes in the same frame (no jitter, ~10x fewer renders
 * than a 100 ms ticker). Purchases are timed on the server, not by this clock.
 */
export function NowProvider({ offsetMs, children }: { offsetMs: number; children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    let timer: number;
    const tick = () => {
      const t = Date.now() + offsetMs;
      setNow(t);
      timer = window.setTimeout(tick, 1000 - (t % 1000) + 5);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [offsetMs]);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

export const useNow = () => useContext(NowContext);
