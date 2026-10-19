import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertsModal } from './components/AlertsModal';
import { FixtureToasts, SuccessToast } from './components/FixtureToasts';
import { AddMatchModal } from './components/AddMatchModal';
import { JustScheduled } from './components/JustScheduled';
import { MatchDetails } from './components/MatchDetails';
import { SchedulePage } from './components/SchedulePage';
import { MyTicketsPage } from './components/MyTicketsPage';
import type { Page } from './components/Header';
import { TicketModal } from './components/TicketModal';
import { formatPositions } from './lib/format';
import type { Availability } from './components/MatchGrid';
import { BuyNowBanner } from './components/BuyNowBanner';
import { EventLog } from './components/EventLog';
import { Filters, type FilterState } from './components/Filters';
import { Header } from './components/Header';
import { MatchGrid } from './components/MatchGrid';
import { OrdersTable } from './components/OrdersTable';
import { PaymentModal } from './components/PaymentModal';
import { ProfileModal } from './components/ProfileModal';
import { isSoldOut } from './components/SaleBadge';
import { Watchlist } from './components/Watchlist';
import { NowProvider } from './hooks/useNow';
import { useStableCallback } from './hooks/useStableCallback';
import { useTheme } from './hooks/useTheme';
import { useTicketStore, type Data, type StoreActions } from './hooks/useTicketStore';
import { getStripe } from './lib/stripe';
import type { Match, Order, WatchMode } from './types';

const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

export default function App() {
  const { data, error, connected, actions } = useTicketStore();

  if (!data) {
    return (
      <div className="splash">
        {error ? (
          <>
            <h2>Can't reach the KickOff API</h2>
            <p className="muted">{error}</p>
            <p className="muted small">
              Start the backend: <code>cd backend; .venv\Scripts\uvicorn app.main:app --port 8000</code>
            </p>
            <button className="primary" onClick={() => void actions.reload()}>
              Retry
            </button>
          </>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>
    );
  }
  return (
    <NowProvider offsetMs={data.clockOffset}>
      <Dashboard data={data} connected={connected} actions={actions} />
    </NowProvider>
  );
}

function Dashboard({ data, connected, actions }: { data: Data; connected: boolean; actions: StoreActions }) {
  const { config, leagues, matches, watches, orders, profile, logs, schedule, announcements } = data;
  const { theme, toggle: toggleTheme } = useTheme();

  // Persist the leagues the user *hid*, so newly added competitions show up automatically.
  const [filters, setFilters] = useState<FilterState>(() => {
    const hidden = new Set(storage.get<string[]>('hiddenLeagues', []));
    return {
      leagues: new Set(leagues.map((l) => l.id).filter((id) => !hidden.has(id))),
      famousOnly: false,
      favoritesOnly: false,
      search: '',
    };
  });
  const [ticketOrderId, setTicketOrderId] = useState<string | null>(() => /^#ticket-(KO-[A-F0-9]+)$/.exec(location.hash)?.[1] ?? null);
  useEffect(() => {
    if (ticketOrderId) history.replaceState(null, '', `#ticket-${ticketOrderId}`);
    else if (location.hash.startsWith('#ticket-')) history.replaceState(null, '', location.pathname + location.search);
  }, [ticketOrderId]);
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability>(() => {
    const saved = storage.get<string>('availability', 'available');
    return saved === 'soldout' ? 'soldout' : 'available';
  });
  // Match details are deep-linkable: #match-12
  const [detailsId, setDetailsId] = useState<number | null>(() => {
    const m = /^#match-(\d+)(\/seats)?$/.exec(location.hash);
    return m ? Number(m[1]) : null;
  });
  const [openOnSeats] = useState(() => /\/seats$/.test(location.hash));
  useEffect(() => {
    const target = detailsId != null ? `#match-${detailsId}` : '';
    if (location.hash !== target) history.replaceState(null, '', target || location.pathname + location.search);
  }, [detailsId]);
  // Re-evaluate time-based filters (sales opening, selling out) once per second.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [defaultMode, setDefaultMode] = useState<WatchMode>(() => storage.get<WatchMode>('defaultMode', 'auto'));
  const [quantity, setQuantity] = useState<number>(() =>
    Math.min(config.max_tickets_per_order, storage.get<number>('quantity', 2)),
  );
  const [modal, setModal] = useState<'payment' | 'profile' | 'alerts' | 'add-match' | null>(null);
  const [seatPickerFor, setSeatPickerFor] = useState<number | null>(null);
  const [addMatchLeague, setAddMatchLeague] = useState<string | undefined>(undefined);
  const [page, setPage] = useState<Page>(() =>
    location.hash === '#schedule'
      ? 'schedule'
      : location.hash === '#my-tickets'
        ? 'mine'
        : location.hash === '#watchlist'
          ? 'watch'
          : storage.get<Page>('page', 'tickets'),
  );
  const changePage = (pg: Page) => {
    setPage(pg);
    storage.set('page', pg);
    window.scrollTo({ top: 0 });
  };

  // ---- newly announced fixtures ------------------------------------------------
  // A fixture is "new" if it was announced in the last few hours and the user hasn't seen it yet.
  const [seen, setSeen] = useState<Set<number>>(() => new Set(storage.get<number[]>('seenFixtures', [])));
  const markSeen = useCallback((ids: number[]) => {
    setSeen((s) => {
      const n = new Set(s);
      ids.forEach((id) => n.add(id));
      storage.set('seenFixtures', [...n].slice(-500));
      return n;
    });
  }, []);
  const [toastIds, setToastIds] = useState<number[]>([]);
  const dismissToast = useCallback((id: number) => setToastIds((t) => t.filter((x) => x !== id)), []);
  useEffect(() => {
    const latestId = announcements[0];
    if (latestId != null) setToastIds((t) => (t.includes(latestId) ? t : [latestId, ...t]));
  }, [announcements]);

  const updateFilters = (f: FilterState) => {
    setFilters(f);
    storage.set(
      'hiddenLeagues',
      leagues.map((l) => l.id).filter((id) => !f.leagues.has(id)),
    );
  };
  const favorites = profile.favorite_leagues;
  const toggleFavorite = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
    void actions.setFavorites(profile, next);
    // Make sure a newly starred competition is visible.
    if (!filters.leagues.has(id) && !favorites.includes(id)) updateFilters({ ...filters, leagues: new Set([...filters.leagues, id]) });
    if (!next.length && filters.favoritesOnly) setFilters((f) => ({ ...f, favoritesOnly: false }));
  };

  // Pop a "tickets secured" banner for purchases that complete while the page is open.
  const seenPaid = useRef<Set<string> | null>(null);
  useEffect(() => {
    const paid = orders.filter((o) => o.status === 'paid').map((o) => o.id);
    if (seenPaid.current === null) {
      seenPaid.current = new Set(paid);
      return;
    }
    const fresh = paid.find((id) => !seenPaid.current!.has(id));
    paid.forEach((id) => seenPaid.current!.add(id));
    if (fresh) setCelebrate(fresh);
  }, [orders]);
  const updateDefaultMode = (m: WatchMode) => {
    setDefaultMode(m);
    storage.set('defaultMode', m);
  };

  const updateQuantity = (n: number) => {
    setQuantity(n);
    storage.set('quantity', n);
  };

  const matchById = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const watchByMatch = useMemo(() => new Map(watches.map((w) => [w.match_id, w])), [watches]);
  const watched = useMemo(() => new Set(watchByMatch.keys()), [watchByMatch]);
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const ticketOrder = ticketOrderId ? orderById.get(ticketOrderId) : undefined;
  const celebrateOrder = celebrate ? orderById.get(celebrate) : undefined;

  const quickBuy = (m: Match) => {
    if (!profile.has_payment_method) {
      actions.log('warn', 'Add a payment card first');
      setModal('payment');
      return;
    }
    void actions.quickBuy(m.id, { quantity });
  };

  const NEW_WINDOW_MS = 6 * 3_600_000;
  const newFixtures = useMemo(() => {
    const now = Date.now() + data.clockOffset;
    return matches
      // Fixtures you added yourself are not "announcements".
      .filter((m) => m.source !== 'user' && m.published_at_ms != null && now - m.published_at_ms < NEW_WINDOW_MS && !seen.has(m.id))
      .sort((a, b) => (b.published_at_ms ?? 0) - (a.published_at_ms ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, seen, data.clockOffset, tick]);
  const newIds = useMemo(() => new Set(newFixtures.map((m) => m.id)), [newFixtures]);
  const toastMatches = toastIds.map((id) => matchById.get(id)).filter((m): m is Match => !!m);

  const preorder = (m: Match) => {
    markSeen([m.id]);
    dismissToast(m.id);
    quickBuy(m);
  };
  const openFixture = (m: Match) => {
    markSeen([m.id]);
    dismissToast(m.id);
    setDetailsId(m.id);
  };

  const updateAvailability = (a: Availability) => {
    setAvailability(a);
    storage.set('availability', a);
  };

  // Tickets page = matches whose sale has STARTED (on sale or sold out). Not-yet-on-sale matches live on the Schedule page.
  const { visible, counts, saleStartedMatches } = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const now = Date.now() + data.clockOffset;
    const started = matches.filter((m) => !m.sale_date_tba && now >= m.sale_opens_at_ms && m.kickoff_ms > now);
    const base = started.filter(
      (m) =>
        filters.leagues.has(m.league_id) &&
        (!filters.favoritesOnly || favorites.includes(m.league_id)) &&
        (!filters.famousOnly || m.famous_name) &&
        (!q || `${m.home_team} ${m.away_team} ${m.famous_name ?? ''} ${m.stadium} ${m.city}`.toLowerCase().includes(q)),
    );
    const soldOut = (m: Match) => isSoldOut(m, now);
    const counts: Record<Availability, number> = {
      available: base.filter((m) => !soldOut(m)).length,
      soldout: base.filter(soldOut).length,
    };
    const visible = availability === 'soldout' ? base.filter(soldOut) : base.filter((m) => !soldOut(m));
    return { visible, counts, saleStartedMatches: started };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, filters, favorites, availability, data.clockOffset, tick]);

  const detailsMatch = detailsId != null ? matchById.get(detailsId) : undefined;

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Stable identities for handlers passed to memoised cards (prevents re-rendering every card each second).
  const onToggleCard = useStableCallback(toggle);
  const onQuickBuyCard = useStableCallback(quickBuy);
  const onOpenCard = useStableCallback((m: Match) => setDetailsId(m.id));
  const onToggleFavorite = useStableCallback(toggleFavorite);
  // From the schedule: open the match straight on the exact-seat picker.
  const onOpenSchedule = useStableCallback((m: Match) => {
    setSeatPickerFor(m.id);
    setDetailsId(m.id);
  });

  const watchSelected = async () => {
    const ids = [...selected].filter((id) => !watched.has(id));
    if (!ids.length) return setSelected(new Set());
    if (defaultMode === 'auto' && !profile.has_payment_method) {
      actions.log('warn', 'Add a payment card first. Auto-buy charges it the instant seats are held');
      setModal('payment');
    }
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    const created = await actions.watchMatches({ match_ids: ids, mode: defaultMode, quantity });
    if (created) setSelected(new Set());
  };

  const authenticate = useCallback(
    async (o: Order) => {
      if (config.gateway === 'stripe') {
        if (!config.stripe_publishable_key || !o.client_secret) return;
        const stripe = await getStripe(config.stripe_publishable_key);
        const res = await stripe?.confirmCardPayment(o.client_secret, { payment_method: o.payment_method_id ?? undefined });
        if (res?.error) actions.log('error', `Authentication failed: ${res.error.message}`);
      }
      await actions.confirm(o.id); // mock gateway: simulated 3-D Secure approval
    },
    [actions, config],
  );

  return (
    <>
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        connected={connected}
        gateway={config.gateway}
        profile={profile}
        onAlerts={() => setModal('alerts')}
        newFixtures={newFixtures.length}
        nextAnnouncementAt={schedule.next_publish_at_ms}
        onPayment={() => setModal('payment')}
        onProfile={() => setModal('profile')}
        onReset={() => void actions.resetDemo()}
        page={page}
        onPage={changePage}
        watchBadge={watches.filter((w) => ['watching', 'armed', 'sale_open', 'purchasing'].includes(w.status)).length}
        myBadge={
          orders.filter((o) => o.status === 'requires_action').length +
          watches.filter((w) => w.status === 'failed' && !orders.some((o) => o.match_id === w.match_id && ['paid', 'pending', 'requires_action'].includes(o.status))).length
        }
      />

      {page === 'mine' && (
        <MyTicketsPage
          matches={matchById}
          watches={watches}
          orders={orders}
          profile={profile}
          actions={actions}
          onOpenMatch={onOpenSchedule}
          onViewTicket={(o) => setTicketOrderId(o.id)}
          onAuthenticate={authenticate}
        />
      )}

