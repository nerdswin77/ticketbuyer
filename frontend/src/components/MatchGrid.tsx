import { memo } from 'react';
import { useNow } from '../hooks/useNow';
import { inZone, money, zoneAbbr } from '../lib/format';
import type { League, Match, Watch } from '../types';
import { LeagueLogo, TeamCrest } from './Crest';
import { SaleBadge, totalAvailable } from './SaleBadge';

export type Availability = 'available' | 'soldout';

interface Props {
  matches: Match[];
  leagues: League[];
  selected: Set<number>;
  watchByMatch: Map<number, Watch>;
  search: string;
  quantity: number;
  maxTickets: number;
  availability: Availability;
  counts: Record<Availability, number>;
  onAvailability: (a: Availability) => void;
  onSearch: (q: string) => void;
  onQuantity: (n: number) => void;
  onToggle: (id: number) => void;
  onSelectMany: (ids: number[]) => void;
  onUnselectMany: (ids: number[]) => void;
  onClear: () => void;
  onWatch: () => void;
  onQuickBuy: (m: Match) => void;
  onOpen: (m: Match) => void;
  favorites: string[];
  onToggleFavorite: (leagueId: string) => void;
  newIds: Set<number>;
  onGoSchedule: () => void;
}

const AVAILABILITY: { key: Availability; label: string; hint: string }[] = [
  { key: 'available', label: 'Sale started', hint: 'Sale is open and seats are still available' },
  { key: 'soldout', label: 'Sold out', hint: 'No seats left' },
];

export function MatchGrid(p: Props) {
  // Favourite competitions first (in the order the user starred them), then the default order.
  const favRank = (id: string) => {
    const i = p.favorites.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const groups = [...p.leagues]
    .sort((a, b) => favRank(a.id) - favRank(b.id))
    .map((league) => ({
      league,
      matches: p.matches.filter((m) => m.league_id === league.id).sort((a, b) => a.kickoff_ms - b.kickoff_ms),
    }))
    .filter((g) => g.matches.length > 0);

  return (
    <main className="panel">
      <div className="avail-switch" role="tablist" aria-label="Ticket availability">
        {AVAILABILITY.map((a) => (
          <button
            key={a.key}
            role="tab"
            aria-selected={p.availability === a.key}
            className={`avail-tab ${p.availability === a.key ? 'on' : ''} avail-${a.key}`}
            onClick={() => p.onAvailability(a.key)}
            title={a.hint}
          >
            <span className="avail-label">{a.label}</span>
            <span className="avail-count">{p.counts[a.key]}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input
          className="grow"
          placeholder="Search team, stadium, city or fixture (e.g. Barcelona, Milan, Derby)"
          value={p.search}
          onChange={(e) => p.onSearch(e.target.value)}
        />
        <label className="inline small muted">
          Tickets
          <select value={p.quantity} onChange={(e) => p.onQuantity(Number(e.target.value))}>
            {Array.from({ length: p.maxTickets }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button onClick={p.onClear} disabled={!p.selected.size}>
          Clear
        </button>
        <button className="primary" disabled={!p.selected.size} onClick={p.onWatch}>
          + Watch selected ({p.selected.size})
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="empty">
          {p.availability === 'soldout'
            ? 'No sold-out matches for these filters.'
            : 'No matches with seats on sale right now for these competitions.'}
          <div className="empty-cta">
            Matches whose sale hasn't started are on the Schedule page, where you can pre-order seats.{' '}
            <button className="primary" onClick={p.onGoSchedule}>
              📅 Go to Schedule
            </button>
          </div>
        </div>
      ) : (
        groups.map(({ league, matches }) => (
          <section key={league.id} className="league-section">
            <div className="league-head">
              <h3>
                <LeagueLogo leagueId={league.id} size={32} />
                <span>{league.name}</span>
                <span className="league-pill">{matches.length} matches</span>
                <button
                  className={`fav-star ${p.favorites.includes(league.id) ? 'on' : ''}`}
                  onClick={() => p.onToggleFavorite(league.id)}
                  aria-pressed={p.favorites.includes(league.id)}
                  title={p.favorites.includes(league.id) ? 'Remove from favourites' : 'Add to favourites'}
                >
                  {p.favorites.includes(league.id) ? '★' : '☆'}
                </button>
              </h3>
              {(() => {
                const ids = matches.map((m) => m.id);
                const allSelected = ids.every((id) => p.selected.has(id));
                return (
                  <button
                    className="link small"
                    onClick={() => (allSelected ? p.onUnselectMany(ids) : p.onSelectMany(ids))}
                  >
                    {allSelected ? 'Unselect all' : 'Select all'}
                  </button>
                );
              })()}
            </div>
            <div className="grid">
              {matches.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  selected={p.selected.has(m.id)}
                  watch={p.watchByMatch.get(m.id)}
                  isNew={p.newIds.has(m.id)}
                  onToggle={p.onToggle}
                  onBuy={p.onQuickBuy}
                  onOpen={p.onOpen}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}

/** Memoised: re-renders only when this match, its watch or its selection changes (callbacks are stable). */
const MatchCard = memo(function MatchCard({
  match: m,
  selected,
  watch,
  isNew,
  onToggle: toggleById,
  onBuy: buyMatch,
  onOpen: openMatch,
}: {
  match: Match;
  selected: boolean;
  isNew: boolean;
  watch: Watch | undefined;
  onToggle: (id: number) => void;
  onBuy: (m: Match) => void;
  onOpen: (m: Match) => void;
}) {
  const onToggle = () => toggleById(m.id);
  const onBuy = () => buyMatch(m);
  const onOpen = () => openMatch(m);
  const prices = m.categories.filter((c) => c.code !== 'VIP').map((c) => c.price_cents);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`card ${selected ? 'sel' : ''} ${watch ? 'watched' : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${m.home_team} vs ${m.away_team}: view details and seats`}
    >
      {isNew && <span className="new-ribbon">NEW</span>}
      <div className="card-top">
        <span className="date-chip">{inZone(m.kickoff_ms, m.timezone, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        <span className="round">{m.round_label}</span>
        <button
          className={`check ${selected ? 'on' : ''}`}
          aria-pressed={selected}
          aria-label={selected ? 'Unselect match' : 'Select match'}
          title="Select for bulk watch"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {selected ? '✓' : ''}
        </button>
      </div>

      <div className="fixture">
        <div className="side">
          <TeamCrest team={m.home_team} size={60} url={m.home_crest_url} />
          <span className="team-name">{m.home_team}</span>
        </div>
        <div className="vs">
          <span className="ko-time">{m.kickoff_tbc ? 'TBC' : inZone(m.kickoff_ms, m.timezone, { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="tz">{m.kickoff_tbc ? 'kick-off time' : zoneAbbr(m.kickoff_ms, m.timezone)}</span>
          <span className="vs-label">VS</span>
        </div>
        <div className="side">
          <TeamCrest team={m.away_team} size={60} url={m.away_crest_url} />
          <span className="team-name">{m.away_team}</span>
        </div>
      </div>

      {m.famous_name && (
        <div className="famous">
          <span className="tag tag-hot">🔥 {m.famous_name}</span>
        </div>
      )}
      <div className="venue">
        🏟 {m.stadium} · {m.city}
      </div>

      <div className="card-foot">
        <span className="price">
          <b>{money(Math.min(...prices))}</b> – <b>{money(Math.max(...prices))}</b>
          <small> by seat position</small>
        </span>
        <SaleBadge match={m} />
      </div>
      <div className="card-actions">
        <button
          className="ghost-outline"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          Seats &amp; details
        </button>
        <BuyButton match={m} watch={watch} onBuy={onBuy} />
      </div>
    </div>
  );
});

export function BuyButton({ match: m, watch: w, onBuy }: { match: Match; watch: Watch | undefined; onBuy: () => void }) {
  const now = useNow();
  const open = now >= m.sale_opens_at_ms;

  let label: string;
  let cls = '';
  let disabled = false;
  if (w?.status === 'purchased') [label, disabled, cls] = ['✓ Bought', true, 'done'];
  else if (w?.status === 'purchasing') [label, disabled] = ['Buying…', true];
  else if (w?.status === 'requires_action') [label, disabled] = ['Approve payment', true];
  else if (open && totalAvailable(m) === 0) [label, disabled] = ['Sold out', true];
  else if (!open && w?.mode === 'auto' && (w.status === 'watching' || w.status === 'armed'))
    [label, disabled, cls] = [w.status === 'armed' ? '⚡ Armed' : '⏱ Pre-ordered', true, 'queued'];
  else if (open) [label, cls] = ['⚡ Buy now', 'primary'];
  else [label, cls] = ['⏱ Pre-order', 'preorder'];

  return (
    <button
      className={`card-buy ${cls}`}
      disabled={disabled}
      title={open ? 'Buy the best seats available within the default zones' : 'Queue an order that fires the instant the sale opens'}
      onClick={(e) => {
        e.stopPropagation();
        onBuy();
      }}
    >
      {label}
    </button>
  );
}
