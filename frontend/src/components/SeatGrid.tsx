import { memo } from 'react';
import type { BlockDetail, Position } from '../types';

interface Props {
  detail: BlockDetail;
  color: string;
  /** Seats being chosen. */
  selected?: Position[];
  /** Seats the user already owns in this block. */
  mine?: Position[];
  readOnly?: boolean;
  onSeat?: (row: number, seat: number) => void;
}

const key = (r: number, s: number) => `${r}:${s}`;

/**
 * Seat-by-seat view of one block. Row 1 is nearest the pitch (top).
 * Click seats one by one to select / deselect them.
 */
export const SeatGrid = memo(function SeatGrid({ detail, color, selected = [], mine = [], readOnly = false, onSeat }: Props) {
  const { rows, seats_per_row: spr, state } = detail;
  const sel = new Set(selected.map(([r, s]) => key(r, s)));
  const own = new Set(mine.map(([r, s]) => key(r, s)));
  const seatNumbers = Array.from({ length: spr }, (_, i) => i + 1);

  return (
    <div className="seat-grid-wrap" style={{ ['--zone' as string]: color }}>
      <div className="pitch-edge">▲ Pitch side</div>
      <div className="seat-grid-scroll">
        <table className="seat-table" role="grid" aria-label={`Block ${detail.block} seats`}>
          <thead>
            <tr>
              <th />
              {seatNumbers.map((n) => (
                <th key={n} className="seat-num">
                  {n % 2 === 1 || spr <= 14 ? n : ''}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => {
              const row = r + 1;
              return (
                <tr key={row}>
                  <th className="row-label">{row}</th>
                  {seatNumbers.map((seat) => {
                    const k = key(row, seat);
                    const free = state[r * spr + seat - 1] === '0';
                    const isMine = own.has(k);
                    const isSel = sel.has(k);
                    const cls = isMine ? 'mine' : isSel ? 'sel' : free ? 'free' : 'sold';
                    return (
                      <td key={seat}>
                        <button
                          className={`seat ${cls}`}
                          disabled={readOnly || (!free && !isSel) || isMine}
                          onClick={() => onSeat?.(row, seat)}
                          aria-pressed={isSel}
                          aria-label={`Row ${row}, seat ${seat}${isMine ? ', your seat' : free ? ', available' : ', sold'}`}
                          title={`Row ${row} · Seat ${seat}${isMine ? ' (your seat)' : isSel ? ' (selected)' : free ? '' : ' (sold)'}`}
                        />
                      </td>
                    );
                  })}
                  <th className="row-label">{row}</th>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="seat-legend">
        <span>
          <i className="seat free" /> Available
        </span>
        {!readOnly && (
          <span>
            <i className="seat sel" /> Your choice
          </span>
        )}
        {mine.length > 0 && (
          <span>
            <i className="seat mine" /> Your ticket
          </span>
        )}
        <span>
          <i className="seat sold" /> Sold
        </span>
      </div>
    </div>
  );
});
