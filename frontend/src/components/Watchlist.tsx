import { useEffect, useState } from 'react';
import type { StoreActions } from '../hooks/useTicketStore';
import { useNow } from '../hooks/useNow';
import { countdown, kickoff, money } from '../lib/format';
import type { Match, Order, Strategy, Watch, WatchMode } from '../types';
import { StadiumMap } from './StadiumMap';
import { formatPositions } from '../lib/format';

const STATUS_LABEL: Record<Watch['status'], string> = {
  watching: 'Watching',
  armed: 'Armed',
  sale_open: 'Sale open!',
  purchasing: 'Buying…',
  requires_action: 'Approve payment',
  purchased: 'Purchased',
  failed: 'Failed',
};
const LOCKED: Watch['status'][] = ['purchasing', 'requires_action', 'purchased'];

interface Props {
  watches: Watch[];
  matches: Map<number, Match>;
  orders: Map<string, Order>;
  onViewTicket: (o: Order) => void;
  maxTickets: number;
  defaultMode: WatchMode;
  onDefaultMode: (m: WatchMode) => void;
  actions: StoreActions;
  currency: string;
}

export function Watchlist({ watches, matches, orders, onViewTicket, maxTickets, defaultMode, onDefaultMode, actions, currency }: Props) {
  return (
    <aside className="panel">
      <h2>Watchlist &amp; auto-buy</h2>
      <div className="toolbar small">
        <span className="muted">New items use</span>
        <select value={defaultMode} onChange={(e) => onDefaultMode(e.target.value as WatchMode)}>
          <option value="auto">⚡ Auto-buy (no click)</option>
          <option value="alert">🔔 Alert + 1-click</option>
        </select>
      </div>
      {watches.length === 0 ? (
        <div className="empty">
          Select matches and click <b>Watch selected</b>.<br />
          The server buys the moment sales open, even if this tab is closed.
        </div>
      ) : (
        watches.map((w) => {
          const m = matches.get(w.match_id);
          return m ? (
            <WatchCard
              key={w.id}
              watch={w}
              match={m}
              order={w.order_id ? orders.get(w.order_id) : undefined}
              onViewTicket={onViewTicket}
              maxTickets={maxTickets}
              actions={actions}
              currency={currency}
            />
          ) : null;
        })
      )}
    </aside>
  );
}

function WatchCard({
  watch: w,
  match: m,
  order,
  onViewTicket,
  maxTickets,
  actions,
  currency,
}: {
  watch: Watch;
  match: Match;
  order: Order | undefined;
  onViewTicket: (o: Order) => void;
  maxTickets: number;
  actions: StoreActions;
  currency: string;
}) {
  const hasSeats = !!order && ['paid', 'pending', 'requires_action'].includes(order.status);
  const now = useNow();
  const locked = LOCKED.includes(w.status);
  const [qty, setQty] = useState(String(w.quantity));
  const [maxPrice, setMaxPrice] = useState(String(w.max_price_cents / 100));
  useEffect(() => setQty(String(w.quantity)), [w.quantity]);
  useEffect(() => setMaxPrice(String(w.max_price_cents / 100)), [w.max_price_cents]);

  const commitQty = () => {
    const n = Math.min(maxTickets, Math.max(1, Math.round(Number(qty) || 1)));
    setQty(String(n));
    if (n !== w.quantity) void actions.updateWatch(w.id, { quantity: n });
  };
  const commitPrice = () => {
    const cents = Math.max(100, Math.round((Number(maxPrice) || 0) * 100));
    setMaxPrice(String(cents / 100));
    if (cents !== w.max_price_cents) void actions.updateWatch(w.id, { max_price_cents: cents });
  };
  const toggleCat = (code: string) => {
    const next = w.category_codes.includes(code) ? w.category_codes.filter((c) => c !== code) : [...w.category_codes, code];
    if (next.length) void actions.updateWatch(w.id, { category_codes: next });
  };
  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => e.key === 'Enter' && fn();

  return (
    <div className={`watch st-${w.status}`}>
      <div className="watch-top">
        <div>
          <b>
            {m.home_team} v {m.away_team}
          </b>
          <div className="meta">{kickoff(m.kickoff_ms)}</div>
        </div>
        <div className="right">
          <div className="cd">{m.sale_date_tba ? <span className="cd-tba">Sale TBA</span> : countdown(m.sale_opens_at_ms - now)}</div>
          <span className={`status status-${w.status}`}>{STATUS_LABEL[w.status]}</span>
        </div>
      </div>

      <div className={`seat-preview ${hasSeats ? 'has-seats' : ''}`}>
        <StadiumMap
          zones={m.categories}
          homeTeam={m.home_team}
          awayTeam={m.away_team}
          selected={new Set(w.category_codes)}
          highlight={hasSeats && order ? { code: order.category_code, blockIndex: order.block_index } : null}
          readOnly
          compact
        />
        <div className="seat-preview-text">
          {hasSeats && order ? (
            <>
              <span className="sp-title">{order.status === 'paid' ? 'Your seats' : 'Seats held'}</span>
              <span className="sp-main">
                {order.category_code} · Block {order.block}
              </span>
              <span>
                {formatPositions(order.positions)}
              </span>
              <span className="muted">{order.gate}</span>
              <button className="mini" onClick={() => onViewTicket(order)}>
                🎟 View ticket
              </button>
            </>
          ) : (
            <>
              {w.exact_block ? (
                <>
                  <span className="sp-title">{w.mode === 'auto' && now < m.sale_opens_at_ms ? 'Pre-ordered exact seats' : 'Exact seats'}</span>
                  <span className="sp-main">
                    {w.category_codes[0]} · Block {w.exact_block}
                  </span>
                  <span>
                    {w.exact_positions.length} ticket{w.exact_positions.length > 1 ? 's' : ''} · {formatPositions(w.exact_positions)}
                  </span>
                  <span className="muted">{w.exact_fallback ? 'Falls back to best seats in zone' : 'These seats only'}</span>
                </>
              ) : (
                <>
                  <span className="sp-title">{w.mode === 'auto' && now < m.sale_opens_at_ms ? 'Pre-ordered zones' : 'Target zones'}</span>
                  <span className="sp-main">{w.category_codes.join(' · ')}</span>
                  <span className="muted">
                    {w.strategy === 'best' ? 'Best position first' : 'Cheapest first'}, max {money(w.max_price_cents, currency)}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="row">
        <label>
          Mode
          <select
            value={w.mode}
            disabled={locked}
            onChange={(e) => void actions.updateWatch(w.id, { mode: e.target.value as WatchMode })}
          >
            <option value="auto">⚡ Auto-buy</option>
            <option value="alert">🔔 Alert + 1-click</option>
          </select>
        </label>
        <label>
          Tickets
          <input
            type="number"
            min={1}
            max={maxTickets}
            value={qty}
            disabled={locked}
            onChange={(e) => setQty(e.target.value)}
            onBlur={commitQty}
            onKeyDown={onEnter(commitQty)}
          />
        </label>
        <label>
          Max / ticket
          <input
            type="number"
            min={1}
            value={maxPrice}
            disabled={locked}
            onChange={(e) => setMaxPrice(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={onEnter(commitPrice)}
          />
        </label>
      </div>

      <div className="row">
        <label className="grow">
          If several zones are free
          <select
            value={w.strategy}
            disabled={locked}
            onChange={(e) => void actions.updateWatch(w.id, { strategy: e.target.value as Strategy })}
          >
            <option value="best">Best position first</option>
            <option value="cheapest">Cheapest first</option>
          </select>
        </label>
      </div>

