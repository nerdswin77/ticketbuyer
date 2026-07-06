import { useEffect, useRef, useState } from 'react';
import type { ServerEvent } from '../types';

/** WebSocket with exponential-backoff reconnect. `onReconnect` lets callers resync state. */
export function useLiveEvents(onEvent: (e: ServerEvent) => void, onReconnect: () => void): boolean {
  const [connected, setConnected] = useState(false);
  const handlers = useRef({ onEvent, onReconnect });
  handlers.current = { onEvent, onReconnect };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: number | undefined;
    let disposed = false;
    let everConnected = false;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        setConnected(true);
        if (everConnected) handlers.current.onReconnect();
        everConnected = true;
        retry = 0;
      };
      ws.onmessage = (msg) => {
        try {
          handlers.current.onEvent(JSON.parse(msg.data as string) as ServerEvent);
        } catch (err) {
          console.error('Bad event', err);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (disposed) return;
        timer = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return connected;
}
