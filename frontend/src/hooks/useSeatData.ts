import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { BlockDetail, BlockSummary } from '../types';

/**
 * Seat-map data for one match (and optionally one block), refreshed in the background while
 * the sale is live. Previous data stays on screen while refreshing and identical responses
 * are ignored, so the seat grid never blinks.
 */
export function useSeatData(matchId: number, block: string | null, live: boolean) {
  const [blocks, setBlocks] = useState<BlockSummary[] | null>(null);
  const [detail, setDetail] = useState<BlockDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastBlocks = useRef('');
  const lastDetail = useRef('');

  useEffect(() => {
    let stop = false;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const data = await api.seatmap(matchId, ctrl.signal);
        const key = JSON.stringify(data);
        if (!stop && key !== lastBlocks.current) {
          lastBlocks.current = key;
          setBlocks(data);
        }
        setError(null);
      } catch (e) {
        if (!stop && !(e instanceof DOMException)) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const id = live ? window.setInterval(load, 3000) : undefined;
    return () => {
      stop = true;
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [matchId, live]);

  useEffect(() => {
    if (!block) {
      setDetail(null);
      lastDetail.current = '';
      return;
    }
    let stop = false;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const data = await api.block(matchId, block, ctrl.signal);
        const key = data.block + data.state;
        if (!stop && key !== lastDetail.current) {
          lastDetail.current = key;
          setDetail(data);
        }
      } catch (e) {
        if (!stop && !(e instanceof DOMException)) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const id = live ? window.setInterval(load, 1500) : undefined;
    return () => {
      stop = true;
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [matchId, block, live]);

  return { blocks, detail: detail && detail.block === block ? detail : null, error };
}
