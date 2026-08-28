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

      {/* ------------------------------------------------ facts */}
      <div className="md-facts">
        <Fact icon="📅" title="Date & kick-off">
          {inZone(m.kickoff_ms, venueTz, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} {tzShort}
          <small>
            {sameZone
              ? 'Local stadium time (same as yours)'
              : `Your time: ${inZone(m.kickoff_ms, localZone(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`}
          </small>
        </Fact>
        <Fact icon="🏟" title="Venue">
          {m.stadium}
          <small>
            {m.city}, {m.country} · {m.capacity.toLocaleString()} seats
          </small>
        </Fact>
        <Fact icon="🚪" title="Gates open">
          {inZone(m.kickoff_ms - GATES_OPEN_MIN * 60_000, venueTz, { hour: '2-digit', minute: '2-digit' })} {tzShort}
          <small>{GATES_OPEN_MIN} min before kick-off; arrive early for security checks</small>
        </Fact>
        <Fact icon="🎟" title="Ticket sale">
          {m.sale_date_tba ? (
            <>
              <span className="warn">Sale date not announced yet</span>
              <small>Pre-order now: your order is bought automatically the moment tickets go on sale.</small>
              <span className="demo-announce">
                <small>Demo: simulate the club announcing the sale</small>
                <button className="mini" onClick={() => p.onAnnounceSale(m.id, 60)}>
                  Opens in 1 min
                </button>
                <button className="mini" onClick={() => p.onAnnounceSale(m.id, 300)}>
                  5 min
                </button>
              </span>
            </>
          ) : (
            <>
              {saleOpen ? (totalLeft ? <span className="ok">On sale · {totalLeft} seats left</span> : <span className="bad">Sold out</span>) : <span className="warn">Opens in {countdown(m.sale_opens_at_ms - now)}</span>}
              <small>
                {saleOpen ? 'Opened' : 'Opens'} {inZone(m.sale_opens_at_ms, localZone(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })} (your time)
              </small>
            </>
          )}
        </Fact>
        <Fact icon="📍" title="Getting there">
          <a href={mapsUrl} target="_blank" rel="noreferrer">
            Open in Google Maps ↗
          </a>
          <small>Public transport recommended; roads close around the stadium on matchday</small>
        </Fact>
        <Fact icon="📋" title="Ticket rules">
          Up to {p.maxTickets} tickets per order
          <small>Personal tickets: each holder's name is printed and ID may be checked. Mobile tickets arrive 48 h before kick-off.</small>
        </Fact>
      </div>

      {/* ------------------------------------------------ your seats */}
      {mySeats && p.order && (
        <div className="my-seats">
          <span className="my-seats-icon">🎟</span>
          <div className="grow">
            <b>{p.order.status === 'paid' ? 'Your seats' : 'Seats held for you'}</b>
            <span>
              {p.order.category_name} · Block <b>{p.order.block}</b> · <b>{formatPositions(p.order.positions)}</b> ·{' '}
              {p.order.gate}
            </span>
          </div>
          <button className="primary" onClick={() => p.order && p.onViewTicket(p.order)}>
            View ticket
          </button>
        </div>
      )}

      {/* ------------------------------------------------ seating */}
      <h3 className="md-h">{mySeats ? 'Where you are sitting' : 'Choose where to sit'}</h3>

      {showMine && p.order ? (
        <div className="md-seating">
          <StadiumMap zones={zones} homeTeam={m.home_team} awayTeam={m.away_team} highlight={mapHighlight} readOnly />
          <div className="exact-panel">
            <div className="exact-title">
              Block <b>{p.order.block}</b> · <b>{formatPositions(p.order.positions)}</b>
              <span className="muted"> · {p.order.gate}</span>
            </div>
            {detail && detail.block === p.order.block ? (
              <SeatGrid detail={detail} color={colors.get(p.order.category_code) ?? '#64748b'} mine={p.order.positions} readOnly />
            ) : (
              <div className="seat-grid-loading">Loading seats…</div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="pick-tabs" role="tablist">
            <button role="tab" aria-selected={pickMode === 'zones'} className={pickMode === 'zones' ? 'on' : ''} onClick={() => setPickMode('zones')} disabled={locked}>
              Best available
              <small>Choose zones; the engine picks the best adjacent seats</small>
            </button>
            <button role="tab" aria-selected={pickMode === 'exact'} className={pickMode === 'exact' ? 'on' : ''} onClick={() => setPickMode('exact')} disabled={locked}>
              🎯 Pick exact seats
              <small>Choose block, row and seat numbers yourself</small>
            </button>
          </div>
          <p className="md-sub">
            {pickMode === 'zones'
              ? 'Prices depend on position: halfway-line seats cost the most, upper corners the least. Click zones on the map or in the list.'
              : `Choose a zone and a block, then click the seats you want one by one, in any rows (click again to remove). Each seat is one ticket, up to ${p.maxTickets}. Row 1 is nearest the pitch.`}{' '}
            <b>{m.away_team}</b> supporters must buy in the Away End (AE).
          </p>
        </>
      )}

      {!(showMine) && pickMode === 'exact' && (
        <div className="md-seating">
          <StadiumMap
            zones={zones}
            selected={exactSelectedSet}
            hovered={hovered}
            saleOpen={saleOpen}
            homeTeam={m.home_team}
            awayTeam={m.away_team}
            onToggle={chooseExactZone}
            onHover={setHovered}
            highlight={mapHighlight}
            readOnly={locked}
          />
          <div className="exact-panel">
            <div className="zone-pills" role="group" aria-label="Zone">
              {zones.map((z) => (
                <button key={z.code} className={`zone-pill ${z.code === exactZone ? 'on' : ''}`} onClick={() => chooseExactZone(z.code)} disabled={locked}>
                  <i style={{ background: colors.get(z.code) }} />
                  {z.code} <b>{money(z.price_cents)}</b>
                </button>
              ))}
            </div>
            {exactZoneCat && <div className="exact-zone-name">{exactZoneCat.name}: {exactZoneCat.description}</div>}
            <div className="block-pills" role="group" aria-label="Block">
              {zoneBlocks.length === 0 && <span className="muted small">Loading blocks…</span>}
              {zoneBlocks.map((b) => (
                <button
                  key={b.block}
                  className={`block-pill ${b.block === exactBlock ? 'on' : ''}`}
                  onClick={() => {
                    setExactBlock(b.block);
                    setPicked([]);
                    setNotice(null);
                  }}
                  disabled={locked}
                  title={b.gate}
                >
                  Block {b.block}
                  <small>{b.free} free</small>
                </button>
              ))}
            </div>
            {detail ? (
              <SeatGrid
                detail={detail}
                color={colors.get(exactZone) ?? '#64748b'}
                selected={picked}
                readOnly={locked}
                onSeat={pickSeat}
              />
            ) : (
              <div className="seat-grid-loading">Loading seats…</div>
            )}
            {notice && <div className="seat-notice">{notice}</div>}
            <label className="fallback-row">
              <input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} disabled={locked} />
              <span>
                If these exact seats are gone when the sale opens, buy the <b>best available adjacent seats in {exactZone}</b> instead
                <small>Off: the order fails rather than giving you different seats</small>
              </span>
            </label>
          </div>
        </div>
      )}

      {!(showMine) && pickMode === 'zones' && (
      <div className="md-seating">
        <StadiumMap
          zones={zones}
          selected={selected}
          hovered={hovered}
          saleOpen={saleOpen}
          homeTeam={m.home_team}
          awayTeam={m.away_team}
          onToggle={toggle}
          onHover={setHovered}
          highlight={mapHighlight}
          readOnly={locked}
        />
        <ul className="zone-list">
          {zones.map((z) => {
            const soldOut = saleOpen && z.available === 0;
            const pct = z.capacity ? (z.available / z.capacity) * 100 : 0;
            return (
              <li
                key={z.code}
                className={`zone-row ${selected.has(z.code) ? 'sel' : ''} ${soldOut ? 'soldout' : ''} ${hovered === z.code ? 'hover' : ''}`}
                onMouseEnter={() => setHovered(z.code)}
                onMouseLeave={() => setHovered(null)}
              >
                <label>
                  <input type="checkbox" checked={selected.has(z.code)} disabled={soldOut} onChange={() => toggle(z.code)} />
                  <span className="swatch" style={{ background: soldOut ? undefined : colors.get(z.code) }}>
                    {z.code}
                  </span>
                  <span className="zone-info">
                    <span className="zone-name">{z.name}</span>
                    <span className="zone-desc">{z.description}</span>
                    {saleOpen && (
                      <span className="avail-bar" title={`${z.available} of ${z.capacity} left`}>
                        <span style={{ width: `${pct}%` }} />
                      </span>
                    )}
                  </span>
                  <span className="zone-price">
                    {money(z.price_cents)}
                    <small>{soldOut ? 'Sold out' : saleOpen ? `${z.available} left` : 'per ticket'}</small>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      )}

