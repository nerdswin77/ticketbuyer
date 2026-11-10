import { useNow } from '../hooks/useNow';
import { countdown, inZone, zoneAbbr } from '../lib/format';
import type { League, Match, ScheduleInfo, Watch } from '../types';
import { LeagueLogo, TeamCrest } from './Crest';
import { BuyButton } from './MatchGrid';

interface Props {
  fixtures: Match[];
  leagues: League[];
  favorites: string[];
  watchByMatch: Map<number, Watch>;
  schedule: ScheduleInfo;
  onPreorder: (m: Match) => void;
  onOpen: (m: Match) => void;
  onDismiss: (id: number) => void;
  onDismissAll: () => void;
}

/** Newly announced fixtures, so the user can pre-order before the ticket sale opens. */
export function JustScheduled(p: Props) {
  const now = useNow();
  const leagueName = new Map(p.leagues.map((l) => [l.id, l.name]));
  const next = p.schedule.next_publish_at_ms;

  return (
    <section className="just-scheduled" aria-label="Newly announced fixtures">
      <div className="js-head">
        <h3>
          <span className="js-dot" /> Just scheduled
          {p.fixtures.length > 0 && <span className="js-count">{p.fixtures.length} new</span>}
        </h3>
        <span className="js-next">
          {next
            ? <>Next fixture announcement in <b>{countdown(next - now)}</b> · {p.schedule.pending} still to come</>
            : p.schedule.pending === 0
              ? 'All fixtures for this period are announced'
              : 'Waiting for the next announcement'}
        </span>
        {p.fixtures.length > 0 && (
          <button className="link small" onClick={p.onDismissAll}>
            Mark all as seen
          </button>
        )}
      </div>

      {p.fixtures.length === 0 ? (
        <p className="js-empty">
          New fixtures appear here the moment they're announced, with a one-click <b>Pre-order</b> that buys automatically when
          ticket sales open.
        </p>
      ) : (
        <div className="js-list">
          {p.fixtures.map((m) => {
            const saleIn = m.sale_opens_at_ms - now;
            const fav = p.favorites.includes(m.league_id);
            return (
              <article key={m.id} className={`js-card ${fav ? 'fav' : ''}`}>
                <button className="js-close" aria-label="Dismiss" title="Mark as seen" onClick={() => p.onDismiss(m.id)}>
                  ✕
                </button>
                <div className="js-league">
                  <LeagueLogo leagueId={m.league_id} size={20} />
                  <span>{leagueName.get(m.league_id)}</span>
                  {fav && <span className="js-fav">★ Favourite</span>}
                  <span className="js-ago">announced {Math.max(0, Math.round((now - (m.published_at_ms ?? now)) / 60_000))} min ago</span>
                </div>
                <button className="js-fixture" onClick={() => p.onOpen(m)} title="View seats & details">
                  <TeamCrest team={m.home_team} size={40} />
                  <span className="js-teams">
                    <b>{m.home_team}</b>
                    <span className="muted">vs</span>
                    <b>{m.away_team}</b>
                  </span>
                  <TeamCrest team={m.away_team} size={40} />
                </button>
                <div className="js-meta">
                  <span>
                    📅 {inZone(m.kickoff_ms, m.timezone, { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
                    {inZone(m.kickoff_ms, m.timezone, { hour: '2-digit', minute: '2-digit' })} {zoneAbbr(m.kickoff_ms, m.timezone)}
                  </span>
                  <span>
                    🏟 {m.stadium}, {m.city}
                  </span>
                </div>
                <div className={`js-sale ${saleIn > 0 ? 'soon' : 'open'}`}>
                  {saleIn > 0 ? (
                    <>
                      Tickets on sale in <b>{countdown(saleIn)}</b>
                    </>
                  ) : (
                    <b>Tickets on sale now</b>
                  )}
                </div>
                <div className="js-actions">
                  <button className="ghost-outline" onClick={() => p.onOpen(m)}>
                    Choose seats
                  </button>
                  <BuyButton match={m} watch={p.watchByMatch.get(m.id)} onBuy={() => p.onPreorder(m)} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
