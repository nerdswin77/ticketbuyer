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

