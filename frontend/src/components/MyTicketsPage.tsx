import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { StoreActions } from '../hooks/useTicketStore';
import { useNow } from '../hooks/useNow';
import { countdown, formatPositions, inZone, money, zoneAbbr } from '../lib/format';
import type { Attendee, Match, Order, Profile, Watch } from '../types';
import { TeamCrest } from './Crest';

type Tab = 'tickets' | 'preorders' | 'attention' | 'history';

interface Props {
  matches: Map<number, Match>;
  watches: Watch[];
  orders: Order[];
  profile: Profile;
  actions: StoreActions;
  onOpenMatch: (m: Match) => void;
  onViewTicket: (o: Order) => void;
  onAuthenticate: (o: Order) => Promise<void>;
}

const ACTIVE_ORDER = ['paid', 'pending', 'requires_action'];
const PREORDER_STATUSES = ['watching', 'armed', 'sale_open', 'purchasing'];

/** Everything the buyer has ordered or paid for, with the actions to manage it. */
export function MyTicketsPage(p: Props) {
  const now = useNow();

  const { tickets, preorders, attention, history, stats } = useMemo(() => {
    const t = Date.now();
    const paidOrUpcoming = p.orders.filter((o) => ACTIVE_ORDER.includes(o.status) && o.status !== 'requires_action');
    const tickets = paidOrUpcoming
      .filter((o) => (p.matches.get(o.match_id)?.kickoff_ms ?? 0) > t)
      .sort((a, b) => (p.matches.get(a.match_id)?.kickoff_ms ?? 0) - (p.matches.get(b.match_id)?.kickoff_ms ?? 0));
    const ordered = new Set(p.orders.filter((o) => ACTIVE_ORDER.includes(o.status)).map((o) => o.match_id));
    const preorders = p.watches
      .filter((w) => PREORDER_STATUSES.includes(w.status) && !ordered.has(w.match_id))
      .sort((a, b) => saleKey(p.matches.get(a.match_id)) - saleKey(p.matches.get(b.match_id)));
    const attention = {
      approve: p.orders.filter((o) => o.status === 'requires_action'),
      failed: p.watches.filter((w) => w.status === 'failed' && !ordered.has(w.match_id)),
    };
    const history = p.orders
      .filter((o) => !ACTIVE_ORDER.includes(o.status) || (p.matches.get(o.match_id)?.kickoff_ms ?? 0) <= t)
      .sort((a, b) => b.created_at_ms - a.created_at_ms);
    const spent = p.orders.filter((o) => o.status === 'paid').reduce((s, o) => s + o.total_cents, 0);
    const committed = preorders.reduce((s, w) => s + estimate(w, p.matches.get(w.match_id)), 0);
    return {
      tickets,
      preorders,
      attention,
      history,
      stats: {
        seats: tickets.reduce((s, o) => s + o.quantity, 0),
        matches: new Set(tickets.map((o) => o.match_id)).size,
        spent,
        committed,
        preorderSeats: preorders.reduce((s, w) => s + w.quantity, 0),
      },
    };
    // `now` re-evaluates past/upcoming once per second
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.orders, p.watches, p.matches, Math.floor(now / 60_000)]);

  const attentionCount = attention.approve.length + attention.failed.length;
  const [tab, setTab] = useState<Tab>(() => (attentionCount ? 'attention' : tickets.length ? 'tickets' : 'preorders'));
  const currency = p.orders[0]?.currency ?? 'eur';

  return (
    <div className="my-page">
      <div className="my-stats">
        <Stat value={stats.seats} label="Tickets" sub={`${stats.matches} match${stats.matches === 1 ? '' : 'es'}`} tone="green" />
        <Stat value={preorders.length} label="Pre-orders" sub={`${stats.preorderSeats} seats waiting`} tone="amber" />
        <Stat value={attentionCount} label="Need attention" sub={attentionCount ? 'Action required' : 'All good'} tone={attentionCount ? 'red' : 'muted'} />
        <Stat value={money(stats.spent, currency)} label="Paid" sub={`${money(stats.committed, currency)} reserved in pre-orders`} tone="blue" />
      </div>

      <div className="my-tabs" role="tablist">
        <TabBtn on={tab === 'tickets'} onClick={() => setTab('tickets')} label="🎟 My tickets" count={tickets.length} />
        <TabBtn on={tab === 'preorders'} onClick={() => setTab('preorders')} label="⏱ Pre-orders" count={preorders.length} />
        <TabBtn on={tab === 'attention'} onClick={() => setTab('attention')} label="⚠ Needs attention" count={attentionCount} alert={attentionCount > 0} />
        <TabBtn on={tab === 'history'} onClick={() => setTab('history')} label="🗂 History" count={history.length} />
      </div>

      {tab === 'tickets' &&
        (tickets.length ? (
          <div className="my-list">
            {tickets.map((o) => {
              const m = p.matches.get(o.match_id);
              return m ? <TicketCard key={o.id} order={o} match={m} profile={p.profile} actions={p.actions} onView={p.onViewTicket} /> : null;
            })}
          </div>
        ) : (
          <Empty text="No paid tickets yet. Pre-order seats from the Schedule and they'll appear here once bought." />
        ))}

      {tab === 'preorders' &&
        (preorders.length ? (
          <div className="my-list">
            {preorders.map((w) => {
              const m = p.matches.get(w.match_id);
              return m ? <PreorderCard key={w.id} watch={w} match={m} actions={p.actions} onChange={() => p.onOpenMatch(m)} /> : null;
            })}
          </div>
        ) : (
          <Empty text="No pre-orders. Open the Schedule, pick a match and choose your seats: we buy them the instant the sale opens." />
        ))}

      {tab === 'attention' &&
        (attentionCount ? (
          <div className="my-list">
            {attention.approve.map((o) => {
              const m = p.matches.get(o.match_id);
              return (
                <div key={o.id} className="my-card attention">
                  <MatchHead match={m} />
                  <div className="my-body">
                    <b>Your bank needs you to approve this payment</b>
                    <span>
                      Seats are held for a short time: Block {o.block} · {formatPositions(o.positions)} · {money(o.total_cents, o.currency)}
                    </span>
                  </div>
                  <div className="my-actions">
                    <button className="primary" onClick={() => void p.onAuthenticate(o)}>
                      Approve payment
                    </button>
                  </div>
                </div>
              );
            })}
            {attention.failed.map((w) => {
              const m = p.matches.get(w.match_id);
              return (
                <div key={w.id} className="my-card attention">
                  <MatchHead match={m} />
                  <div className="my-body">
                    <b className="bad">Order failed</b>
                    <span>{w.message}</span>
                  </div>
                  <div className="my-actions">
                    {m && <button onClick={() => p.onOpenMatch(m)}>Choose other seats</button>}
                    <button onClick={() => void p.actions.retry(w.id)}>Re-arm</button>
                    <ConfirmButton label="Remove" confirmLabel="Remove order" danger onConfirm={() => void p.actions.removeWatch(w.id)} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty text="Nothing needs your attention." />
        ))}

      {tab === 'history' &&
        (history.length ? (
          <div className="table-wrap panel">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Match</th>
                  <th>Seats</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((o) => (
                  <tr key={o.id}>
                    <td className="mono">{o.id}</td>
                    <td>{o.match_label}</td>
                    <td>
                      {o.category_code} · Block {o.block} · {formatPositions(o.positions)}
                    </td>
                    <td>{money(o.total_cents, o.currency)}</td>
                    <td>
                      <span className={`ostatus o-${o.status}`} title={o.failure_reason || undefined}>
                        {o.status === 'paid' ? 'Played' : o.status}
                      </span>
                    </td>
                    <td>{new Date(o.created_at_ms).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="No past orders." />
        ))}
    </div>
  );
}

// ------------------------------------------------------------------ cards

function TicketCard({ order: o, match: m, profile, actions, onView }: { order: Order; match: Match; profile: Profile; actions: StoreActions; onView: (o: Order) => void }) {
  const initial = () =>
    o.positions.map(([row, seat]) => ({ row, seat, name: o.attendees.find((a) => a.row === row && a.seat === seat)?.name ?? '' }));
  const [names, setNames] = useState<Attendee[]>(initial);
  const [saved, setSaved] = useState(false);
  useEffect(() => setNames(initial()), [o.attendees]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = names.some((n, i) => n.name !== (initial()[i]?.name ?? ''));
  const missing = names.filter((n) => !n.name.trim()).length;

  return (
    <div className="my-card ticket-card">
      <MatchHead match={m} />
      <div className="my-seat-summary">
        <div>
          <span className="msl">Zone</span>
          <b>{o.category_code}</b>
          <small>{o.category_name}</small>
        </div>
        <div>
          <span className="msl">Block</span>
          <b>{o.block}</b>
          <small>{o.gate}</small>
        </div>
        <div className="grow">
          <span className="msl">Seats</span>
          <b>{formatPositions(o.positions)}</b>
          <small>
            {o.quantity} ticket{o.quantity > 1 ? 's' : ''} · {money(o.total_cents, o.currency)}
          </small>
        </div>
        <div>
          <span className="msl">Order</span>
          <b className="mono">{o.id}</b>
          <small>{o.paid_at_ms ? `Paid ${new Date(o.paid_at_ms).toLocaleString()}` : o.status}</small>
        </div>
      </div>

      <div className="attendees">
        <div className="att-head">
          <b>Ticket holders</b>
          <span className={missing ? 'warn' : 'ok'}>{missing ? `${missing} name${missing > 1 ? 's' : ''} missing` : 'All seats named'}</span>
          {profile.full_name && names.every((n) => n.name !== profile.full_name) && (
            <button
              className="link small"
              onClick={() => setNames((cur) => cur.map((n, i) => (i === 0 && !n.name ? { ...n, name: profile.full_name } : n)))}
            >
              Use my name for the first seat
            </button>
          )}
        </div>
        <div className="att-grid">
          {names.map((n, i) => (
            <label key={`${n.row}-${n.seat}`}>
              <span>
                Row {n.row} · Seat {n.seat}
              </span>
              <input
                value={n.name}
                maxLength={80}
                placeholder="Full name as on ID"
                onChange={(e) => {
                  setSaved(false);
                  setNames((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)));
                }}
              />
            </label>
          ))}
        </div>
        <div className="att-foot">
          <small className="muted">Tickets are personal: the name may be checked against ID at the gate.</small>
          <button
            className={dirty ? 'primary' : ''}
            disabled={!dirty}
            onClick={async () => {
              if (await actions.setAttendees(o.id, names)) setSaved(true);
            }}
          >
            {saved && !dirty ? '✓ Saved' : 'Save names'}
          </button>
        </div>
      </div>

      <div className="my-actions">
        <button className="primary" onClick={() => onView(o)}>
          🎟 View ticket
        </button>
        <a className="btn" href={api.calendarUrl(o.id)} download>
          📅 Add to calendar
        </a>
        {o.status === 'paid' && (
          <ConfirmButton label="Refund" confirmLabel={`Refund ${money(o.total_cents, o.currency)}`} danger onConfirm={() => void actions.refund(o.id)} />
        )}
      </div>
    </div>
  );
}

function PreorderCard({ watch: w, match: m, actions, onChange }: { watch: Watch; match: Match; actions: StoreActions; onChange: () => void }) {
  const now = useNow();
  const zone = m.categories.find((c) => c.code === w.category_codes[0]);
  const est = estimate(w, m);
  let status: JSX.Element;
  if (w.status === 'purchasing') status = <span className="tag tag-open">Buying now…</span>;
  else if (m.sale_date_tba) status = <span className="tag tag-tba">Waiting for the sale date</span>;
  else if (now < m.sale_opens_at_ms)
    status = (
      <span className={`tag ${w.status === 'armed' ? 'tag-open' : 'tag-soon'}`}>
        {w.status === 'armed' ? '⚡ Armed · ' : ''}Sale opens in {countdown(m.sale_opens_at_ms - now)}
      </span>
    );
  else status = <span className="tag tag-open">Sale open</span>;

  return (
    <div className="my-card preorder-card">
      <MatchHead match={m} />
      <div className="my-seat-summary">
        {w.exact_block ? (
          <>
            <div>
              <span className="msl">Zone</span>
              <b>{zone?.code}</b>
              <small>{zone?.name}</small>
            </div>
            <div>
              <span className="msl">Block</span>
              <b>{w.exact_block}</b>
            </div>
            <div className="grow">
              <span className="msl">Exact seats</span>
              <b>{formatPositions(w.exact_positions)}</b>
              <small>
                {w.exact_positions.length} ticket{w.exact_positions.length > 1 ? 's' : ''} · {money(est)}
              </small>
            </div>
          </>
        ) : (
          <div className="grow">
            <span className="msl">Best available in</span>
            <b>{w.category_codes.join(' · ')}</b>
            <small>
              {w.quantity} tickets · {w.strategy === 'best' ? 'best position first' : 'cheapest first'} · up to {money(w.max_price_cents)} each
            </small>
          </div>
        )}
        <div>
          <span className="msl">Status</span>
          {status}
          <small>{w.mode === 'auto' ? 'Buys automatically' : 'Alert only'}</small>
        </div>
      </div>
      {w.exact_block && (
        <label className="fallback-row compact">
          <input type="checkbox" checked={w.exact_fallback} onChange={(e) => void actions.updateWatch(w.id, { exact_fallback: e.target.checked })} />
          <span>If these exact seats are gone, buy the best adjacent seats in {zone?.code} instead</span>
        </label>
      )}
      <div className="my-actions">
        <button onClick={onChange} disabled={w.status === 'purchasing'}>
          Change seats
        </button>
        <ConfirmButton label="Cancel pre-order" confirmLabel="Yes, cancel" danger disabled={w.status === 'purchasing'} onConfirm={() => void actions.removeWatch(w.id)} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ bits

function MatchHead({ match: m }: { match: Match | undefined }) {
  if (!m) return <div className="my-head muted">Match no longer listed</div>;
  return (
    <div className="my-head">
      <TeamCrest team={m.home_team} size={38} url={m.home_crest_url} />
      <div className="my-title">
        <b>
          {m.home_team} <span className="muted">v</span> {m.away_team}
        </b>
        <span>
          {inZone(m.kickoff_ms, m.timezone, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} ·{' '}
          {m.kickoff_tbc ? 'time TBC' : `${inZone(m.kickoff_ms, m.timezone, { hour: '2-digit', minute: '2-digit' })} ${zoneAbbr(m.kickoff_ms, m.timezone)}`} · 🏟{' '}
          {m.stadium}
        </span>
      </div>
      <TeamCrest team={m.away_team} size={38} url={m.away_crest_url} />
      {m.famous_name && <span className="tag tag-hot">🔥 {m.famous_name}</span>}
    </div>
  );
}

function ConfirmButton({ label, confirmLabel, onConfirm, danger, disabled }: { label: string; confirmLabel: string; onConfirm: () => void; danger?: boolean; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = window.setTimeout(() => setAsking(false), 5000);
    return () => window.clearTimeout(t);
  }, [asking]);
  return asking ? (
    <span className="confirm-pair">
      <button className={danger ? 'danger solid' : 'primary'} onClick={() => { setAsking(false); onConfirm(); }}>
        {confirmLabel}
      </button>
      <button onClick={() => setAsking(false)}>Keep</button>
    </span>
  ) : (
    <button className={danger ? 'danger' : ''} disabled={disabled} onClick={() => setAsking(true)}>
      {label}
    </button>
  );
}

function Stat({ value, label, sub, tone }: { value: number | string; label: string; sub: string; tone: string }) {
  return (
    <div className="my-stat">
      <span className={`stat-value ${tone}`}>{value}</span>
      <span className="stat-label">{label}</span>
      <small>{sub}</small>
    </div>
  );
}

function TabBtn({ on, onClick, label, count, alert }: { on: boolean; onClick: () => void; label: string; count: number; alert?: boolean }) {
  return (
    <button role="tab" aria-selected={on} className={`my-tab ${on ? 'on' : ''}`} onClick={onClick}>
      {label}
      <span className={`seg-count ${alert ? 'alert' : ''}`}>{count}</span>
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty panel">{text}</div>;
}

function saleKey(m: Match | undefined): number {
  if (!m) return Number.MAX_SAFE_INTEGER;
  return m.sale_date_tba ? Number.MAX_SAFE_INTEGER - 1 : m.sale_opens_at_ms;
}

function estimate(w: Watch, m: Match | undefined): number {
  if (!m) return 0;
  if (w.exact_block) {
    const z = m.categories.find((c) => c.code === w.category_codes[0]);
    return (z?.price_cents ?? 0) * w.exact_positions.length;
  }
  return w.max_price_cents * w.quantity;
}
