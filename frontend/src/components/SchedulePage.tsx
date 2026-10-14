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

      <main className="sch-col">
        {p.announcements}
        <div className="panel sch-main">
        <div className="sch-head">
          <h2 className="sch-title">
            {current && <LeagueLogo leagueId={current.id} size={36} />}
            <span>
              {current?.name}: upcoming ticket sales
              <small>
                {fixtures.length} match{fixtures.length === 1 ? '' : 'es'} not on sale yet · pick seats and pre-order. We buy them the instant the sale opens
              </small>
            </span>
          </h2>
          <div className="sch-actions">
            <button onClick={() => p.onAddMatch(league)}>＋ Add a missing match</button>
            {p.importEnabled && (
              <button
                className="primary"
                disabled={importing}
                onClick={async () => {
                  setImporting(true);
                  try {
                    await p.onImport();
                  } finally {
                    setImporting(false);
                  }
                }}
              >
                {importing ? 'Importing…' : '⟳ Load official schedules'}
              </button>
            )}
          </div>
        </div>

        {!p.importEnabled && (
          <div className="sch-banner">
            <b>Showing fixtures known to KickOff.</b> To load the <b>complete official season schedule</b> for the Premier League,
            La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie, Primeira Liga, Championship, Brasileirão and Champions League, add a
            free football-data.org API key as <code>FOOTBALL_DATA_API_KEY</code> in <code>backend/.env</code> and restart. Anything
            missing can be added with <b>＋ Add a missing match</b>.
          </div>
        )}

        <div className="toolbar">
          <div className="segmented">
            {(
              [
                ['all', 'All upcoming sales'],
                ['announced', 'Sale date announced'],
                ['tba', 'Sale date TBA'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={`seg ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          <input className="grow" placeholder="Search team, stadium or city" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        {fixtures.length === 0 ? (
          <div className="empty">
            No upcoming ticket sales here right now. Matches already on sale are on the Tickets page.
            <div className="empty-cta">
              <button className="primary" onClick={() => p.onAddMatch(league)}>
                ＋ Add a match and pre-order seats
              </button>
            </div>
          </div>
        ) : (
          [...grouped].map(([month, days]) => (
            <section key={month} className="sch-month">
              <h3 className="sch-month-title">{month}</h3>
              {[...days].map(([day, list]) => (
                <div key={day} className="sch-day">
                  <div className="sch-day-title">{day}</div>
                  <ul className="sch-list">
                    {list.map((m) => {
                      const w = p.watchByMatch.get(m.id);
                      return <FixtureRow key={m.id} match={m} watch={w} order={w?.order_id ? p.orderById.get(w.order_id) : undefined} onOpen={p.onOpen} />;
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))
        )}
        </div>
      </main>
    </div>
  );
}

const FixtureRow = memo(function FixtureRow({
  match: m,
  watch: w,
  order: o,
  onOpen,
}: {
  match: Match;
  watch: Watch | undefined;
  order: Order | undefined;
  onOpen: (m: Match) => void;
}) {
  const now = useNow();
  const open = !m.sale_date_tba && now >= m.sale_opens_at_ms;
  const left = totalAvailable(m);

  let sale: JSX.Element;
  if (m.sale_date_tba) sale = <span className="tag tag-tba">Sale date TBA</span>;
  else if (!open) sale = <span className="tag tag-soon">On sale in {countdown(m.sale_opens_at_ms - now)}</span>;
  else if (left === 0) sale = <span className="tag tag-out">Sold out</span>;
  else sale = <span className="tag tag-open">On sale · {left} left</span>;

  let mine: JSX.Element | null = null;
  if (o && ['paid', 'pending', 'requires_action'].includes(o.status)) {
    mine = (
      <span className="sch-mine done">
        ✓ {o.status === 'paid' ? 'Bought' : 'Held'} · Block {o.block} · {o.quantity} seat{o.quantity > 1 ? 's' : ''}
      </span>
    );
  } else if (w && w.mode === 'auto' && (w.status === 'watching' || w.status === 'armed')) {
    mine = (
      <span className="sch-mine queued">
        ⏱ Pre-ordered{w.exact_block ? ` · Block ${w.exact_block} · ${w.exact_positions.length} seat${w.exact_positions.length > 1 ? 's' : ''}` : ''}
      </span>
    );
  } else if (w?.status === 'failed') {
    mine = <span className="sch-mine failed">✖ {w.message}</span>;
  }

