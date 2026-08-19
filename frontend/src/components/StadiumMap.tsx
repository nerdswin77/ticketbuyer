import { memo } from 'react';
import type { SeatCategory } from '../types';
import { money } from '../lib/format';

/** Price heat colour by rank (cheapest teal → most expensive deep violet), so one premium zone can't squash the scale. */
function heat(t: number): string {
  return `hsl(${(172 + t * 96).toFixed(0)} 62% ${(46 - t * 10).toFixed(0)}%)`;
}

export function zoneColors(zones: SeatCategory[]): Map<string, string> {
  const ranks = [...new Set(zones.map((z) => z.price_cents))].sort((a, b) => a - b);
  const t = (p: number) => (ranks.length > 1 ? ranks.indexOf(p) / (ranks.length - 1) : 0.5);
  return new Map(zones.map((z) => [z.code, heat(t(z.price_cents))]));
}

type Shape = { x: number; y: number; w: number; h: number; rx?: number };

// Layout in a 400×300 viewBox. Split zones list their blocks in the same order as the
// backend's `block_index` (left/right wing; corners NW, NE, SW, SE).
const SHAPES: Record<string, Shape[]> = {
  OC: [{ x: 150, y: 16, w: 100, h: 46 }],
  OW: [
    { x: 64, y: 16, w: 82, h: 46 },
    { x: 254, y: 16, w: 82, h: 46 },
  ],
  MC: [{ x: 150, y: 238, w: 100, h: 46 }],
  MW: [
    { x: 64, y: 238, w: 82, h: 46 },
    { x: 254, y: 238, w: 82, h: 46 },
  ],
  VIP: [{ x: 160, y: 218, w: 80, h: 15, rx: 4 }],
  HE: [{ x: 14, y: 70, w: 74, h: 160 }],
  AE: [{ x: 312, y: 70, w: 74, h: 160 }],
  CU: [
    { x: 8, y: 8, w: 52, h: 56, rx: 14 },
    { x: 340, y: 8, w: 52, h: 56, rx: 14 },
    { x: 8, y: 236, w: 52, h: 56, rx: 14 },
    { x: 340, y: 236, w: 52, h: 56, rx: 14 },
  ],
};

export interface SeatHighlight {
  code: string;
  blockIndex: number;
  label?: string;
}

interface Props {
  zones: SeatCategory[];
  selected?: Set<string>;
  hovered?: string | null;
  saleOpen?: boolean;
  homeTeam: string;
  awayTeam: string;
  /** Exact purchased block: everything else is dimmed and a pin marks the seats. */
  highlight?: SeatHighlight | null;
  readOnly?: boolean;
  compact?: boolean;
  onToggle?: (code: string) => void;
  onHover?: (code: string | null) => void;
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
const sameHighlight = (a: SeatHighlight | null | undefined, b: SeatHighlight | null | undefined) =>
  a === b || (!!a && !!b && a.code === b.code && a.blockIndex === b.blockIndex && a.label === b.label);

/** Memoised: callbacks are ignored in the comparison (they only call stable state setters). */
export const StadiumMap = memo(StadiumMapImpl, (a, b) =>
  a.zones === b.zones &&
  sameSet(a.selected ?? EMPTY, b.selected ?? EMPTY) &&
  a.hovered === b.hovered &&
  a.saleOpen === b.saleOpen &&
  a.readOnly === b.readOnly &&
  a.compact === b.compact &&
  a.homeTeam === b.homeTeam &&
  a.awayTeam === b.awayTeam &&
  sameHighlight(a.highlight, b.highlight) &&
  a.onToggle === b.onToggle,
);
const EMPTY = new Set<string>();

function StadiumMapImpl({
  zones,
  selected = new Set(),
  hovered = null,
  saleOpen = false,
  homeTeam,
  awayTeam,
  highlight = null,
  readOnly = false,
  compact = false,
  onToggle,
  onHover,
}: Props) {
  const colors = zoneColors(zones);
  const pinShape = highlight ? SHAPES[highlight.code]?.[highlight.blockIndex] ?? SHAPES[highlight.code]?.[0] : undefined;

  return (
    <div className={`stadium-map ${compact ? 'compact' : ''} ${readOnly ? 'readonly' : ''}`}>
      <svg viewBox="0 0 400 300" role="group" aria-label="Stadium seating map">
        <rect x="1" y="1" width="398" height="298" rx="26" className="bowl" />
        <g className="pitch">
          <rect x="100" y="76" width="200" height="132" rx="3" />
          <line x1="200" y1="76" x2="200" y2="208" />
          <circle cx="200" cy="142" r="20" />
          <rect x="100" y="112" width="26" height="60" />
          <rect x="274" y="112" width="26" height="60" />
        </g>

        {zones.map((z) => {
          const shapes = SHAPES[z.code];
          if (!shapes) return null;
          const soldOut = !highlight && saleOpen && z.available === 0;
          const isSel = selected.has(z.code);
          const dim = highlight ? z.code !== highlight.code : selected.size > 0 && !isSel;
          const interactive = !readOnly && !soldOut;
          const label = `${z.name}: ${money(z.price_cents)}${soldOut ? ' (sold out)' : saleOpen ? ` (${z.available} left)` : ''}`;
          return (
            <g
              key={z.code}
              className={`zone ${isSel ? 'sel' : ''} ${dim ? 'dim' : ''} ${soldOut ? 'soldout' : ''} ${hovered === z.code ? 'hover' : ''}`}
              onClick={interactive ? () => onToggle?.(z.code) : undefined}
              onMouseEnter={() => onHover?.(z.code)}
              onMouseLeave={() => onHover?.(null)}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : -1}
              aria-pressed={interactive ? isSel : undefined}
              aria-label={label}
              onKeyDown={(e) => interactive && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle?.(z.code))}
            >
              <title>{label}</title>
              {shapes.map((s, i) => {
                const other = highlight && z.code === highlight.code && i !== highlight.blockIndex;
                const mine = highlight && z.code === highlight.code && i === highlight.blockIndex;
                return (
                  <rect
                    key={i}
                    x={s.x}
                    y={s.y}
                    width={s.w}
                    height={s.h}
                    rx={s.rx ?? 6}
                    className={mine ? 'mine' : other ? 'other-block' : undefined}
                    fill={soldOut ? undefined : colors.get(z.code)}
                  />
                );
              })}
              {!compact &&
                shapes.map((s, i) => (
                  <text key={`t${i}`} x={s.x + s.w / 2} y={s.y + s.h / 2 + 4} textAnchor="middle" className="zone-code">
                    {z.code}
                  </text>
                ))}
            </g>
          );
        })}

        {pinShape && (
          <g className="seat-pin" transform={`translate(${pinShape.x + pinShape.w / 2} ${pinShape.y + pinShape.h / 2})`}>
            <circle r="16" className="pin-pulse" />
            <circle r="9" className="pin-dot" />
            {highlight?.label && !compact && (
              <g transform={`translate(0 ${pinShape.y > 150 ? -26 : 30})`}>
                <rect x={-48} y={-10} width={96} height={20} rx={10} className="pin-label-bg" />
                <text textAnchor="middle" y={4} className="pin-label">
                  {highlight.label}
                </text>
              </g>
            )}
          </g>
        )}
      </svg>

      {!compact && (
        <>
          <div className="map-caption">
            <span>◀ HE · {homeTeam} home end</span>
            <span>Main stand &amp; dugouts ▼</span>
            <span>{awayTeam} fans · AE ▶</span>
          </div>
          {!highlight && (
            <div className="map-legend">
              <span>Cheaper</span>
              <span className="legend-bar" style={{ background: `linear-gradient(90deg, ${heat(0)}, ${heat(0.5)}, ${heat(1)})` }} />
              <span>Pricier</span>
              <span className="legend-sold">Sold out</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
