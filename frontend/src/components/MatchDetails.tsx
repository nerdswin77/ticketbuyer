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

  /** Pick seats one by one: click to add, click again to remove. The ticket count = seats picked. */
  const pickSeat = useCallback(
    (row: number, seat: number) => {
      setNotice(null);
      setPicked((cur) => {
        if (cur.some(([r, s]) => r === row && s === seat)) return cur.filter(([r, s]) => !(r === row && s === seat));
        if (cur.length >= p.maxTickets) {
          setNotice(`Maximum ${p.maxTickets} tickets per order`);
          return cur;
        }
        return [...cur, [row, seat] as Position].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      });
    },
    [p.maxTickets],
  );

  const chooseExactZone = useCallback((code: string) => {
    setExactZone(code);
    setExactBlock(null);
    setPicked([]);
    setNotice(null);
  }, []);
  const exactZoneCat = zones.find((z) => z.code === exactZone);
  const exactBlockInfo = zoneBlocks.find((b) => b.block === exactBlock);

  const toggle = useCallback(
    (code: string) =>
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(code)) n.delete(code);
        else n.add(code);
        return n;
      }),
    [],
  );

  const chosen = zones.filter((z) => selected.has(z.code));
  const maxPrice = chosen.length ? Math.max(...chosen.map((z) => z.price_cents)) : 0;
  // Which zone the engine would pick right now, following the chosen strategy.
  const expected = useMemo(() => {
    const ordered = [...chosen].sort((a, b) => (strategy === 'best' ? a.sort_order - b.sort_order : a.price_cents - b.price_cents));
    return ordered.find((z) => !saleOpen || z.available >= quantity) ?? null;
  }, [chosen, strategy, saleOpen, quantity]);

  const colors = zoneColors(zones);

  const venueTz = m.timezone;
  const tzShort = zoneAbbr(m.kickoff_ms, venueTz);
  const sameZone = localZone() === venueTz;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${m.stadium}, ${m.city}`)}`;

  const locked = !!w && BUSY.includes(w.status);
  const mySeats = !!p.order && ['paid', 'pending', 'requires_action'].includes(p.order.status);
  const showMine = mySeats && !!p.order;
  const queued = !!w && !saleOpen && w.mode === 'auto' && (w.status === 'watching' || w.status === 'armed');

  const exactReady = pickMode === 'exact' && !!exactBlock && picked.length > 0;
  const buy = async () => {
    if (!p.hasCard) return p.onNeedCard();
    setBusy(true);
    try {
      if (pickMode === 'exact') {
        if (!exactReady) return;
        await p.onBuy(m.id, {
          quantity: picked.length,
          seats: { block: exactBlock!, positions: picked },
          exact_fallback: fallback,
        });
      } else {
        await p.onBuy(m.id, { quantity, strategy, category_codes: [...selected], max_price_cents: maxPrice });
      }
    } finally {
      setBusy(false);
    }
  };
  const watchAlert = async () => {
    setBusy(true);
    try {
      await p.onWatch({ match_ids: [m.id], mode: 'alert', quantity, strategy, category_codes: [...selected], max_price_cents: maxPrice });
    } finally {
      setBusy(false);
    }
  };

  let buyLabel: string;
  if (w?.status === 'purchased') buyLabel = '✓ Tickets bought';
  else if (w?.status === 'purchasing') buyLabel = 'Buying…';
  else if (w?.status === 'requires_action') buyLabel = 'Approve payment in Orders';
  else if (saleOpen && totalLeft === 0) buyLabel = 'Sold out';
  else if (queued) buyLabel = w?.status === 'armed' ? '⚡ Armed: buying at T+0' : '⏱ Pre-ordered: update order';
  else if (pickMode === 'exact')
    buyLabel = saleOpen
      ? `⚡ Buy these seats${exactReady && exactZoneCat ? ` · ${money(exactZoneCat.price_cents * picked.length)}` : ''}`
      : '⏱ Pre-order these exact seats';
  else if (saleOpen) buyLabel = `⚡ Buy now${expected ? ` · ${money(expected.price_cents * quantity)}` : ''}`;
  else buyLabel = '⏱ Pre-order: buys at sale opening';

  const mapHighlight = useMemo(() => {
    if (mySeats && p.order) return { code: p.order.category_code, blockIndex: p.order.block_index, label: `Block ${p.order.block}` };
    if (pickMode === 'exact' && exactBlockInfo) return { code: exactZone, blockIndex: exactBlockInfo.block_index, label: `Block ${exactBlockInfo.block}` };
    return null;
  }, [mySeats, p.order, pickMode, exactBlockInfo, exactZone]);
  const exactSelectedSet = useMemo(() => new Set([exactZone]), [exactZone]);

  return (
    <Modal title={`${m.home_team} vs ${m.away_team}`} onClose={p.onClose} wide hideTitle>
      {/* ------------------------------------------------ hero */}
      <div className="md-hero">
        <div className="md-comp">
          <LeagueLogo leagueId={m.league_id} size={30} />
          <span>
            <b>{p.league?.name}</b> · {m.round_label}
          </span>
          {m.famous_name && <span className="tag tag-hot">🔥 {m.famous_name}</span>}
        </div>
        <div className="md-fixture">
          <div className="md-team">
            <TeamCrest team={m.home_team} size={84} url={m.home_crest_url} />
            <span>{m.home_team}</span>
            <small>Home</small>
          </div>
          <div className="md-center">
            <span className="md-date">{inZone(m.kickoff_ms, venueTz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
            <span className="md-time">
              {m.kickoff_tbc ? (
                <>
                  TBC <small>kick-off time</small>
                </>
              ) : (
                <>
                  {inZone(m.kickoff_ms, venueTz, { hour: '2-digit', minute: '2-digit' })} <small>{tzShort}</small>
                </>
              )}
            </span>
            <span className="md-rel">Kick-off {relative(m.kickoff_ms, now)}</span>
          </div>
          <div className="md-team">
            <TeamCrest team={m.away_team} size={84} url={m.away_crest_url} />
            <span>{m.away_team}</span>
            <small>Away</small>
          </div>
        </div>
      </div>

