import { useNow } from '../hooks/useNow';
import { countdown } from '../lib/format';
import type { Match } from '../types';

export const totalAvailable = (m: Match) => m.categories.reduce((n, c) => n + c.available, 0);
export const isSoldOut = (m: Match, now: number) => now >= m.sale_opens_at_ms && totalAvailable(m) === 0;

export function SaleBadge({ match }: { match: Match }) {
  const now = useNow();
  if (match.sale_date_tba) return <span className="tag tag-tba">Sale date TBA · pre-order now</span>;
  const left = match.sale_opens_at_ms - now;
  if (left > 0) return <span className="tag tag-soon">Sale in {countdown(left)}</span>;
  const total = totalAvailable(match);
  if (total === 0) return <span className="tag tag-out">Sold out</span>;
  return <span className="tag tag-open">On sale · {total} left</span>;
}
