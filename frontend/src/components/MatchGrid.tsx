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

