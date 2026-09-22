import type { Match, Watch } from '../types';

interface Props {
  watches: Watch[];
  matches: Map<number, Match>;
  onBuy: (id: number) => void;
}

export function BuyNowBanner({ watches, matches, onBuy }: Props) {
  const open = watches.filter((w) => w.status === 'sale_open');
  if (!open.length) return null;
  return (
    <div className="buy-banner" role="alert">
      {open.map((w) => {
        const m = matches.get(w.match_id);
        return (
          <button key={w.id} className="buy-now" onClick={() => onBuy(w.id)}>
            🎟 BUY NOW: {m ? `${m.home_team} v ${m.away_team}` : `match ${w.match_id}`}
          </button>
        );
      })}
    </div>
  );
}
