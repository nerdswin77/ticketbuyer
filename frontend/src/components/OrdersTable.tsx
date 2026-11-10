import { useState } from 'react';
import { money } from '../lib/format';
import type { Order } from '../types';
import { formatPositions } from '../lib/format';

interface Props {
  orders: Order[];
  onRefund: (id: string) => Promise<void>;
  onAuthenticate: (o: Order) => Promise<void>;
  onView: (o: Order) => void;
}

const STATUS: Record<Order['status'], string> = {
  pending: 'Pending',
  requires_action: 'Approve payment',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
};

export function OrdersTable({ orders, onRefund, onAuthenticate, onView }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRefund, setConfirmRefund] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
    } finally {
      setBusy(null);
      setConfirmRefund(null);
    }
  };

  return (
    <section className="panel">
      <h2>Orders</h2>
      {orders.length === 0 ? (
        <div className="empty">No orders yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Match</th>
                <th>Seat position</th>
                <th>Total</th>
                <th>Speed</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.id}</td>
                  <td>{o.match_label}</td>
                  <td title={`${o.category_name}, ${o.gate}`}>
                    <span className="seat-pill">{o.category_code}</span> Block <b>{o.block}</b> · <b>{formatPositions(o.positions)}</b>
                  </td>
                  <td>{money(o.total_cents, o.currency)}</td>
                  <td title={o.trigger === 'auto' ? 'Auto-buy' : 'Manual click'}>
                    {o.latency_ms != null ? `${o.latency_ms} ms` : '-'} {o.trigger === 'auto' ? '⚡' : '👆'}
                  </td>
                  <td>
                    <span className={`ostatus o-${o.status}`} title={o.failure_reason || undefined}>
                      {STATUS[o.status]}
                    </span>
                  </td>
                  <td className="actions">
                    {o.status !== 'failed' && (
                      <button className="mini" onClick={() => onView(o)}>
                        🎟 Ticket
                      </button>
                    )}
                    {o.status === 'requires_action' && (
                      <button className="primary" disabled={busy === o.id} onClick={() => act(o.id, () => onAuthenticate(o))}>
                        Approve
                      </button>
                    )}
                    {o.status === 'paid' &&
                      (confirmRefund === o.id ? (
                        <>
                          <button className="danger" disabled={busy === o.id} onClick={() => act(o.id, () => onRefund(o.id))}>
                            Confirm refund
                          </button>
                          <button onClick={() => setConfirmRefund(null)}>Keep</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmRefund(o.id)}>Refund</button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
