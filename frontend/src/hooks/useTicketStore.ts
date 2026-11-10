import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { api, type BuyOptions } from '../api';
import { beep, notify } from '../lib/alerts';
import { money } from '../lib/format';
import type { AppConfig, League, LogEntry, LogLevel, Match, Order, Profile, ScheduleInfo, ServerEvent, Watch } from '../types';
import { useLiveEvents } from './useLiveEvents';

export interface Data {
  config: AppConfig;
  clockOffset: number;
  leagues: League[];
  matches: Match[];
  watches: Watch[];
  orders: Order[];
  profile: Profile;
  logs: LogEntry[];
  schedule: ScheduleInfo;
  /** Fixtures announced while this page is open that passed the user's alert filter (newest first). */
  announcements: number[];
}

/** Should an announcement for this league trigger an alert, given the user's preferences? */
export const wantsAlert = (p: Profile, leagueId: string) =>
  p.fixture_alerts === 'all' || (p.fixture_alerts === 'favorites' && p.favorite_leagues.includes(leagueId));

interface State {
  data: Data | null;
  error: string | null;
}

type Action =
  | { type: 'loaded'; data: Data }
  | { type: 'load_failed'; error: string }
  | { type: 'event'; event: ServerEvent }
  | { type: 'log'; entry: LogEntry }
  | { type: 'profile'; profile: Profile }
  | { type: 'watches'; watches: Watch[] }
  | { type: 'order'; order: Order };

const MAX_LOGS = 300;

function upsert<T extends { id: number | string }>(list: T[], item: T, prepend = false): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return prepend ? [item, ...list] : [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

function reducer(state: State, action: Action): State {
  if (action.type === 'loaded') return { data: action.data, error: null };
  if (action.type === 'load_failed') return { ...state, error: action.error };
  const d = state.data;
  if (!d) return state;
  switch (action.type) {
    case 'log':
      return { ...state, data: { ...d, logs: [action.entry, ...d.logs].slice(0, MAX_LOGS) } };
    case 'profile':
      return { ...state, data: { ...d, profile: action.profile } };
    case 'watches':
      return { ...state, data: { ...d, watches: action.watches.reduce((acc, w) => upsert(acc, w), d.watches) } };
    case 'order':
      return { ...state, data: { ...d, orders: upsert(d.orders, action.order, true) } };
    case 'event': {
      const e = action.event;
      switch (e.type) {
        case 'log':
          return reducer(state, { type: 'log', entry: e.data });
        case 'watch':
          return reducer(state, { type: 'watches', watches: [e.data] });
        case 'watch_removed':
          return { ...state, data: { ...d, watches: d.watches.filter((w) => w.id !== e.data.id) } };
        case 'order':
          return reducer(state, { type: 'order', order: e.data });
        case 'schedule':
          return { ...state, data: { ...d, schedule: { ...d.schedule, ...e.data } } };
        case 'match_added':
        case 'sale_announced':
          return { ...state, data: { ...d, matches: upsert(d.matches, e.data) } };
        case 'fixture_published': {
          const { match, pending, next_publish_at_ms } = e.data;
          return {
            ...state,
            data: {
              ...d,
              matches: upsert(d.matches, match),
              schedule: { ...d.schedule, pending, next_publish_at_ms },
              announcements: wantsAlert(d.profile, match.league_id) ? [match.id, ...d.announcements].slice(0, 20) : d.announcements,
            },
          };
        }
        case 'inventory': {
          const inv = e.data;
          return {
            ...state,
            data: {
              ...d,
              matches: d.matches.map((m) =>
                m.categories.some((c) => String(c.id) in inv)
                  ? { ...m, categories: m.categories.map((c) => (String(c.id) in inv ? { ...c, available: inv[String(c.id)]! } : c)) }
                  : m,
              ),
            },
          };
        }
        default:
          return state;
      }
    }
  }
}

async function loadAll(): Promise<Data> {
  const t0 = Date.now();
  const [config, leagues, matches, watches, orders, profile, logs, schedule] = await Promise.all([
    api.config(),
    api.leagues(),
    api.matches(),
    api.watches(),
    api.orders(),
    api.profile(),
    api.logs(),
    api.schedule(),
  ]);
  const rtt = Date.now() - t0;
  return {
    config,
    clockOffset: config.server_time_ms + rtt / 2 - Date.now(),
    leagues,
    matches,
    watches,
    orders,
    profile,
    logs: logs.slice().reverse(),
    schedule,
    announcements: [],
  };
}

export function useTicketStore() {
  const [state, dispatch] = useReducer(reducer, { data: null, error: null });
  // Latest state for event side effects (alert preferences) without re-subscribing the socket.
  const latest = useRef(state);
  latest.current = state;

  const log = useCallback((level: LogLevel, message: string) => {
    dispatch({ type: 'log', entry: { ts: Date.now(), level, message } });
  }, []);

  const reload = useCallback(async () => {
    try {
      dispatch({ type: 'loaded', data: await loadAll() });
    } catch (err) {
      dispatch({ type: 'load_failed', error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onEvent = useCallback(
    (e: ServerEvent) => {
      if (e.type === 'matches_reset') {
        void reload();
        return;
      }
      if (e.type === 'fixture_published') {
        const p = latest.current.data?.profile;
        const m = e.data.match;
        if (p && wantsAlert(p, m.league_id)) {
          beep(784, 0.14, 3);
          const secs = Math.max(0, Math.round((m.sale_opens_at_ms - (m.published_at_ms ?? Date.now())) / 1000));
          notify('📅 New fixture announced', `${m.home_team} v ${m.away_team}: tickets on sale in ${Math.floor(secs / 60)}m ${secs % 60}s. Pre-order now.`);
        }
      }
      if (e.type === 'sale_announced') {
        const m = e.data;
        const hasOrder = latest.current.data?.watches.some((w) => w.match_id === m.id);
        beep(880, 0.16, hasOrder ? 4 : 2);
        const secs = Math.max(0, Math.round((m.sale_opens_at_ms - Date.now()) / 1000));
        notify(
          '📣 Ticket sale date announced',
          `${m.home_team} v ${m.away_team}: on sale in ${Math.floor(secs / 60)}m ${secs % 60}s.` +
            (hasOrder ? ' Your pre-order is armed.' : ' Pre-order now.'),
        );
      }
      if (e.type === 'sale_open') {
        beep(988, 0.18, 5);
        notify('🎟 Tickets ON SALE', `${e.data.label}: click BUY NOW`);
      }
      if (e.type === 'order') {
        const o = e.data;
        if (o.status === 'paid') {
          beep(1320, 0.1, 2);
          notify('✅ Tickets secured!', `${o.match_label}: ${o.quantity}× ${o.category_code} ${money(o.total_cents, o.currency)}`);
        } else if (o.status === 'failed') notify('❌ Purchase failed', `${o.match_label}: ${o.failure_reason}`);
        else if (o.status === 'requires_action') {
          beep(700, 0.2, 3);
          notify('⚠ Approve your payment', `${o.match_label}: your bank needs confirmation`);
        }
      }
      dispatch({ type: 'event', event: e });
    },
    [reload],
  );

  const connected = useLiveEvents(onEvent, reload);

  /** Wrap an API call: surface errors in the log instead of throwing. */
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, failMsg: string): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (err) {
        log('error', `${failMsg}: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      }
    },
    [log],
  );

  const actions = useMemo(
    () => ({
      reload,
      log,
      setProfile: (profile: Profile) => dispatch({ type: 'profile', profile }),
      /** Optimistic: the star toggles instantly, the server copy is authoritative. */
      setFavorites: async (current: Profile, leagues: string[]) => {
        dispatch({ type: 'profile', profile: { ...current, favorite_leagues: leagues } });
        const p = await run(() => api.setFavorites(leagues), 'Could not save favourites');
        dispatch({ type: 'profile', profile: p ?? current });
      },
      setOrder: (order: Order) => dispatch({ type: 'order', order }),
      watchMatches: async (body: Parameters<typeof api.createWatches>[0]) => {
        const created = await run(() => api.createWatches(body), 'Could not add to watchlist');
        if (created) dispatch({ type: 'watches', watches: created });
        return created;
      },
      updateWatch: async (id: number, body: Parameters<typeof api.updateWatch>[1]) => {
        const w = await run(() => api.updateWatch(id, body), 'Could not update watch');
        if (w) dispatch({ type: 'watches', watches: [w] });
      },
      removeWatch: (id: number) => run(() => api.deleteWatch(id), 'Could not remove watch'),
      buy: async (id: number) => {
        const w = await run(() => api.buy(id), 'Order failed');
        if (w) dispatch({ type: 'watches', watches: [w] });
      },
      quickBuy: async (matchId: number, opts: BuyOptions) => {
        const w = await run(() => api.quickBuy(matchId, opts), 'Order failed');
        if (w) dispatch({ type: 'watches', watches: [w] });
      },
      retry: (id: number) => run(() => api.retry(id), 'Retry failed'),
      refund: async (orderId: string) => {
        const o = await run(() => api.refundOrder(orderId), 'Refund failed');
        if (o) dispatch({ type: 'order', order: o });
      },
      confirm: async (orderId: string) => {
        const o = await run(() => api.confirmOrder(orderId), 'Payment confirmation failed');
        if (o) dispatch({ type: 'order', order: o });
      },
      resetDemo: () => run(() => api.resetDemo(), 'Reset failed'),
      publishNext: () => run(() => api.publishNext(), 'Could not announce fixture'),
      addMatch: async (body: Parameters<typeof api.addMatch>[0]) => {
        const m = await api.addMatch(body); // errors are shown in the form
        dispatch({ type: 'event', event: { type: 'match_added', data: m } });
        return m;
      },
      setAttendees: async (orderId: string, attendees: Parameters<typeof api.setAttendees>[1]) => {
        const o = await run(() => api.setAttendees(orderId, attendees), 'Could not save ticket holders');
        if (o) dispatch({ type: 'order', order: o });
        return !!o;
      },
      importSchedule: async () => {
        const r = await run(() => api.importSchedule(), 'Schedule import failed');
        if (r) await reload();
      },
      announceSale: async (matchId: number, seconds: number) => {
        const m = await run(() => api.announceSale(matchId, seconds), 'Could not announce sale');
        if (m) dispatch({ type: 'event', event: { type: 'sale_announced', data: m } });
      },
      setPreferences: async (prefs: Parameters<typeof api.setPreferences>[0]) => {
        const p = await run(() => api.setPreferences(prefs), 'Could not save alert settings');
        if (p) dispatch({ type: 'profile', profile: p });
        return p;
      },
    }),
    [reload, log, run],
  );

  return { ...state, connected, actions };
}

export type StoreActions = ReturnType<typeof useTicketStore>['actions'];
