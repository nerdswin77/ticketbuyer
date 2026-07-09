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

