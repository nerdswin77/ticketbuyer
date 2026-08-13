import { useNow } from '../hooks/useNow';
import { LEAGUE_BRAND, type Region } from '../lib/brand';
import type { League, Match, Watch } from '../types';
import { LeagueLogo } from './Crest';
import { totalAvailable } from './SaleBadge';

export interface FilterState {
  leagues: Set<string>;
  famousOnly: boolean;
  favoritesOnly: boolean;
  search: string;
}

interface Props {
  leagues: League[];
  matches: Match[];
  /** Matches counted next to each competition (defaults to `matches`). */
  countMatches?: Match[];
  watches: Watch[];
  favorites: string[];
  value: FilterState;
  onChange: (next: FilterState) => void;
  onToggleFavorite: (leagueId: string) => void;
}

const GROUPS: { region: Region; label: string }[] = [
  { region: 'europe', label: 'European leagues' },
  { region: 'americas', label: 'South America' },
  { region: 'uefa', label: 'European cups' },
];

export function Filters({ leagues, matches, countMatches, watches, favorites, value, onChange, onToggleFavorite }: Props) {
  const now = useNow();
  const onSale = matches.filter((m) => now >= m.sale_opens_at_ms && totalAvailable(m) > 0).length;
  const opening = matches.filter((m) => m.sale_opens_at_ms > now && m.sale_opens_at_ms - now < 10 * 60_000).length;
  const active = watches.filter((w) => !['purchased', 'failed'].includes(w.status)).length;
  const bought = watches.filter((w) => w.status === 'purchased').length;

  const countBy = new Map<string, number>();
  for (const m of countMatches ?? matches) countBy.set(m.league_id, (countBy.get(m.league_id) ?? 0) + 1);
  const favSet = new Set(favorites);
  const byId = new Map(leagues.map((l) => [l.id, l]));

  const toggleLeague = (id: string) => {
    const next = new Set(value.leagues);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...value, leagues: next });
  };
  const allOn = value.leagues.size === leagues.length;

  const row = (l: League) => {
    const on = value.leagues.has(l.id);
    const fav = favSet.has(l.id);
    return (
      <li key={l.id} className={`league-item ${on ? 'on' : ''}`}>
        <button className={`league-row ${on ? 'on' : ''}`} onClick={() => toggleLeague(l.id)} aria-pressed={on}>
          <LeagueLogo leagueId={l.id} size={34} />
          <span className="league-text">
            <span className="league-name">{l.name}</span>
            <span className="league-country">{l.country}</span>
          </span>
          <span className="league-count">{countBy.get(l.id) ?? 0}</span>
        </button>
        <button
          className={`fav-star ${fav ? 'on' : ''}`}
          onClick={() => onToggleFavorite(l.id)}
          aria-pressed={fav}
          aria-label={fav ? `Remove ${l.name} from favourites` : `Add ${l.name} to favourites`}
          title={fav ? 'Remove from favourites' : 'Add to favourites'}
        >
          {fav ? '★' : '☆'}
        </button>
      </li>
    );
  };

  return (
    <aside className="sidebar">
      <section className="side-card overview">
        <h2>Live overview</h2>
        <div className="stats">
          <div className="stat">
            <span className="stat-value green">{onSale}</span>
            <span className="stat-label">On sale now</span>
          </div>
          <div className="stat">
            <span className="stat-value amber">{opening}</span>
            <span className="stat-label">Opening &lt;10 min</span>
          </div>
          <div className="stat">
            <span className="stat-value blue">{active}</span>
            <span className="stat-label">Watching</span>
          </div>
          <div className="stat">
            <span className="stat-value">{bought}</span>
            <span className="stat-label">Bought</span>
          </div>
        </div>
      </section>

