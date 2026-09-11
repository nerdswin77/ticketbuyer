import { formatPositions, inZone, money, zoneAbbr } from '../lib/format';
import type { League, Match, Order } from '../types';
import { LeagueLogo, TeamCrest } from './Crest';
import { Modal } from './Modal';
import { StadiumMap, zoneColors } from './StadiumMap';
import { SeatGrid } from './SeatGrid';
import { useSeatData } from '../hooks/useSeatData';

const STATUS: Record<Order['status'], string> = {
  pending: 'Payment pending',
  requires_action: 'Approve payment to confirm',
  paid: 'Confirmed',
  failed: 'Failed',
  refunded: 'Refunded',
};

export const seatRange = (seats: number[]) =>
  seats.length === 0 ? '-' : seats.length === 1 ? String(seats[0]) : `${seats[0]}–${seats[seats.length - 1]}`;

interface Props {
  order: Order;
  match: Match;
  league: League | undefined;
  onClose: () => void;
}

export function TicketModal({ order: o, match: m, league, onClose }: Props) {
  const tz = m.timezone;
  const zone = m.categories.find((c) => c.code === o.category_code);
  const { detail } = useSeatData(m.id, o.block || null, false);
  const rowsUsed = [...new Set(o.positions.map(([r]) => r))].sort((a, b) => a - b);
  return (
    <Modal title={`Ticket ${o.id}`} onClose={onClose} wide hideTitle>
      <div className="ticket">
        <div className="ticket-head">
          <div className="md-comp">
            <LeagueLogo leagueId={m.league_id} size={28} />
            <span>
              <b>{league?.name}</b> · {m.round_label}
            </span>
            <span className={`ostatus o-${o.status}`}>{STATUS[o.status]}</span>
          </div>
          <div className="ticket-fixture">
            <TeamCrest team={m.home_team} size={64} />
            <div className="ticket-title">
              <span className="ticket-teams">
                {m.home_team} <span className="muted">vs</span> {m.away_team}
              </span>
              <span className="ticket-when">
                {inZone(m.kickoff_ms, tz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
                {inZone(m.kickoff_ms, tz, { hour: '2-digit', minute: '2-digit' })} {zoneAbbr(m.kickoff_ms, tz)}
              </span>
              <span className="ticket-where">
                🏟 {m.stadium}, {m.city}, {m.country}
              </span>
            </div>
            <TeamCrest team={m.away_team} size={64} />
          </div>
        </div>

        <div className="ticket-perf" aria-hidden />

        <div className="ticket-body">
          <div className="seat-grid">
            <SeatCell label="Zone" value={o.category_code} sub={o.category_name} wide />
            <SeatCell label="Entrance" value={o.gate.split(' · ')[0] ?? o.gate} sub={o.gate.split(' · ')[1]} />
            <SeatCell label="Block" value={o.block} />
            <SeatCell label={rowsUsed.length > 1 ? 'Rows' : 'Row'} value={rowsUsed.join(', ')} />
            <SeatCell
              label={o.positions.length > 1 ? 'Seats' : 'Seat'}
              value={rowsUsed.length > 1 ? String(o.positions.length) : seatRange(o.seats)}
              sub={rowsUsed.length > 1 ? formatPositions(o.positions) : `${o.quantity} ticket${o.quantity > 1 ? 's' : ''}`}
            />
          </div>

          <div className="ticket-map">
            <StadiumMap
              zones={m.categories}
              homeTeam={m.home_team}
              awayTeam={m.away_team}
              highlight={{ code: o.category_code, blockIndex: o.block_index, label: `Block ${o.block}` }}
              readOnly
            />
            <div className="ticket-directions">
              <b>Your seats in Block {o.block}</b>
              {detail ? (
                <SeatGrid detail={detail} color={zoneColors(m.categories).get(o.category_code) ?? '#64748b'} mine={o.positions} readOnly />
              ) : (
                <div className="seat-grid-loading">Loading seat map…</div>
              )}
              <b>How to find your seats</b>
              <ol>
                <li>
                  Enter through <b>{o.gate}</b>. Gates open{' '}
                  {inZone(m.kickoff_ms - 90 * 60_000, tz, { hour: '2-digit', minute: '2-digit' })} {zoneAbbr(m.kickoff_ms, tz)}.
                </li>
                <li>
                  Follow the signs to <b>Block {o.block}</b>.
                </li>
                <li>
                  Your seats: <b>{formatPositions(o.positions)}</b>.
                </li>
              </ol>
              {zone && <p className="muted small">{zone.description}</p>}
              <b>Ticket holders</b>
              <ul className="holder-list">
                {o.positions.map(([r, s]) => {
                  const name = o.attendees.find((a) => a.row === r && a.seat === s)?.name;
                  return (
                    <li key={`${r}-${s}`}>
                      <span>
                        Row {r} · Seat {s}
                      </span>
                      <b className={name ? '' : 'warn'}>{name || 'Name not set'}</b>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>

