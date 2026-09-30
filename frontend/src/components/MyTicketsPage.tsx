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

