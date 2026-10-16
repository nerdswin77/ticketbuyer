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

