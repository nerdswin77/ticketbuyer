import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNow } from '../hooks/useNow';
import { countdown, inZone, zoneAbbr } from '../lib/format';
import type { League, Match, Order, Watch } from '../types';
import { LeagueLogo, TeamCrest } from './Crest';
import { totalAvailable } from './SaleBadge';

interface Props {
  leagues: League[];
  matches: Match[];
  watchByMatch: Map<number, Watch>;
  orderById: Map<string, Order>;
  favorites: string[];
  importEnabled: boolean;
  onOpen: (m: Match) => void;
  onAddMatch: (leagueId: string) => void;
  onImport: () => Promise<void>;
  /** "Just scheduled" strip of newly announced fixtures. */
  announcements?: ReactNode;
}

type SaleFilter = 'all' | 'announced' | 'tba';

/** Schedule page = matches whose ticket sale has NOT started yet (pre-order). */
const notStarted = (m: Match, now: number) => m.kickoff_ms > now && (m.sale_date_tba || now < m.sale_opens_at_ms);

/** Full fixture list per competition, grouped by month and day. Select a match → pick seats → pre-order. */
export function SchedulePage(p: Props) {
  const [importing, setImporting] = useState(false);
  const ordered = useMemo(() => {
    const fav = (id: string) => (p.favorites.includes(id) ? p.favorites.indexOf(id) : 1000);
    return [...p.leagues].sort((a, b) => fav(a.id) - fav(b.id));
  }, [p.leagues, p.favorites]);
  const [league, setLeagueState] = useState<string>(() => ordered[0]?.id ?? 'LIGA');
  const [userPicked, setUserPicked] = useState(false);
  const setLeague = (id: string) => {
    setUserPicked(true);
    setLeagueState(id);
  };
  const [filter, setFilter] = useState<SaleFilter>('all');
  const [q, setQ] = useState('');

  // Re-evaluate every second so a match leaves this page the moment its sale opens.
  const nowSec = Math.floor(useNow() / 1000);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    const now = nowSec * 1000;
    for (const m of p.matches) if (notStarted(m, now)) c.set(m.league_id, (c.get(m.league_id) ?? 0) + 1);
    return c;
  }, [p.matches, nowSec]);

  // Until the user picks a competition, open on the first one that actually has upcoming sales.
  useEffect(() => {
    if (userPicked || (counts.get(league) ?? 0) > 0) return;
    const first = ordered.find((l) => (counts.get(l.id) ?? 0) > 0);
    if (first) setLeagueState(first.id);
  }, [counts, league, ordered, userPicked]);

  const fixtures = useMemo(() => {
    const now = nowSec * 1000;
    const needle = q.trim().toLowerCase();
    return p.matches
      .filter((m) => m.league_id === league && notStarted(m, now))
      .filter((m) => !needle || `${m.home_team} ${m.away_team} ${m.stadium} ${m.city}`.toLowerCase().includes(needle))
      .filter((m) => filter === 'all' || (filter === 'tba' ? m.sale_date_tba : !m.sale_date_tba))
      .sort((a, b) => a.kickoff_ms - b.kickoff_ms);
  }, [p.matches, league, filter, q, nowSec]);

  // month -> day -> matches (in the stadium's local calendar)
  const grouped = useMemo(() => {
    const months = new Map<string, Map<string, Match[]>>();
    for (const m of fixtures) {
      const month = inZone(m.kickoff_ms, m.timezone, { month: 'long', year: 'numeric' });
      const day = inZone(m.kickoff_ms, m.timezone, { weekday: 'long', day: 'numeric', month: 'long' });
      const days = months.get(month) ?? new Map<string, Match[]>();
      days.set(day, [...(days.get(day) ?? []), m]);
      months.set(month, days);
    }
    return months;
  }, [fixtures]);

  const current = p.leagues.find((l) => l.id === league);

  return (
    <div className="schedule-page">
      <aside className="sch-leagues side-card">
        <h2>Competitions</h2>
        <ul>
          {ordered.map((l) => (
            <li key={l.id}>
              <button className={`sch-league ${l.id === league ? 'on' : ''}`} onClick={() => setLeague(l.id)}>
                <LeagueLogo leagueId={l.id} size={30} />
                <span className="league-text">
                  <span className="league-name">
                    {p.favorites.includes(l.id) && <span className="fav-mini">★ </span>}
                    {l.name}
                  </span>
                  <span className="league-country">{l.country}</span>
                </span>
                <span className="league-count">{counts.get(l.id) ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

