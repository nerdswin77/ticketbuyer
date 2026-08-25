import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSeatData } from '../hooks/useSeatData';
import { SeatGrid } from './SeatGrid';
import type { BuyOptions, WatchCreate } from '../api';
import { useNow } from '../hooks/useNow';
import { countdown, inZone, localZone, money, relative, zoneAbbr } from '../lib/format';
import type { League, Match, Order, Strategy, Watch } from '../types';
import { formatPositions } from '../lib/format';
import type { Position } from '../types';
import { LeagueLogo, TeamCrest } from './Crest';
import { Modal } from './Modal';
import { StadiumMap, zoneColors } from './StadiumMap';

interface Props {
  match: Match;
  league: League | undefined;
  watch: Watch | undefined;
  order: Order | undefined;
  onViewTicket: (o: Order) => void;
  initialPickMode?: 'zones' | 'exact';
  onAnnounceSale: (matchId: number, seconds: number) => void;
  hasCard: boolean;
  maxTickets: number;
  defaultQuantity: number;
  onClose: () => void;
  onNeedCard: () => void;
  onBuy: (matchId: number, opts: BuyOptions) => Promise<void>;
  onWatch: (body: WatchCreate) => Promise<unknown>;
}

const GATES_OPEN_MIN = 90;
const BUSY = ['purchasing', 'requires_action', 'purchased'];

export function MatchDetails(p: Props) {
  const { match: m, watch: w } = p;
  const now = useNow();
  const saleOpen = now >= m.sale_opens_at_ms;
  const zones = m.categories;
  const totalLeft = zones.reduce((n, z) => n + z.available, 0);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(w?.category_codes ?? zones.filter((z) => z.code !== 'VIP').map((z) => z.code)),
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(w?.quantity ?? p.defaultQuantity);
  const [strategy, setStrategy] = useState<Strategy>(w?.strategy ?? 'best');
  const [busy, setBusy] = useState(false);

  // ---- exact seat selection --------------------------------------------------
  const [pickMode, setPickMode] = useState<'zones' | 'exact'>(p.initialPickMode ?? (w?.exact_block ? 'exact' : 'zones'));
  const [exactZone, setExactZone] = useState<string>(() => (w?.exact_block ? (w.category_codes[0] ?? 'MC') : 'MC'));
  const [exactBlock, setExactBlock] = useState<string | null>(w?.exact_block ?? null);
  const [picked, setPicked] = useState<Position[]>(w?.exact_positions ?? []);
  const [fallback, setFallback] = useState<boolean>(w?.exact_fallback ?? false);
  const [notice, setNotice] = useState<string | null>(null);

  const myOrderBlock = p.order && ['paid', 'pending', 'requires_action'].includes(p.order.status) ? p.order.block : null;
  const gridBlock = myOrderBlock ?? (pickMode === 'exact' ? exactBlock : null);
  const { blocks, detail } = useSeatData(m.id, gridBlock, saleOpen);
  const zoneBlocks = useMemo(() => (blocks ?? []).filter((b) => b.zone_code === exactZone).sort((a, b) => a.rank - b.rank), [blocks, exactZone]);

  // Default to the best block of the chosen zone that still has seats.
  useEffect(() => {
    if (pickMode !== 'exact' || !zoneBlocks.length) return;
    if (!exactBlock || !zoneBlocks.some((b) => b.block === exactBlock)) {
      setExactBlock((zoneBlocks.find((b) => b.free > 0) ?? zoneBlocks[0])!.block);
      setPicked([]);
    }
  }, [pickMode, zoneBlocks, exactBlock]);

  // If someone else buys one of the seats you've picked, drop just that seat and tell you.
  useEffect(() => {
    if (!detail || detail.block !== exactBlock || !picked.length) return;
    if (w?.exact_block === exactBlock && BUSY.includes(w?.status ?? '')) return; // those are being bought by you
    const spr = detail.seats_per_row;
    const gone = picked.filter(([r, s]) => detail.state[(r - 1) * spr + s - 1] !== '0');
    if (gone.length) {
      setPicked((cur) => cur.filter(([r, s]) => !gone.some(([gr, gs]) => gr === r && gs === s)));
      setNotice(`Just sold to someone else: ${formatPositions(gone)}`);
    }
  }, [detail, exactBlock, picked, w]);

