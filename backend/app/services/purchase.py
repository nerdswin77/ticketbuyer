"""Purchase pipeline: hold seats -> charge saved card -> confirm or release."""

from __future__ import annotations

import asyncio
import logging
import secrets
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal
from ..events import bus
from ..models import BuyerProfile, Order, SeatCategory, Watch, now_ms
from ..schemas import OrderOut, WatchOut
from .exchange import exchange, publish_inventory
from .payments import ChargeResult, get_gateway
from .seating import LAYOUT, SeatHold, describe, positions_csv


def _zone_blocks(zone_code: str) -> list[str]:
    return [b.name for b in LAYOUT.get(zone_code, [])]

log = logging.getLogger("kickoff.purchase")

_locks: dict[int, asyncio.Lock] = {}

BUSY_STATUSES = {"purchasing", "requires_action", "purchased"}


def money(cents: int) -> str:
    return f"€{cents / 100:,.2f}"


def get_profile(db: Session) -> BuyerProfile:
    p = db.get(BuyerProfile, 1)
    if p is None:
        p = BuyerProfile(id=1)
        db.add(p)
        db.commit()
    return p


def publish_watch(w: Watch) -> None:
    bus.publish("watch", WatchOut.model_validate(w).model_dump())


def publish_order(o: Order) -> None:
    bus.publish("order", OrderOut.from_order(o).model_dump())


def set_watch(db: Session, w: Watch, status: str, message: str = "") -> None:
    w.status, w.message = status, message
    db.commit()
    publish_watch(w)


def _new_order_id(db: Session) -> str:
    while True:
        oid = "KO-" + secrets.token_hex(3).upper()
        if db.get(Order, oid) is None:
            return oid


_background: set[asyncio.Task[Order | None]] = set()


def start_purchase(watch_id: int, trigger: str) -> None:
    """Fire-and-forget: the HTTP caller gets an immediate response; progress streams over /ws."""
    task = asyncio.create_task(execute_purchase(watch_id, trigger), name=f"purchase-{watch_id}")
    _background.add(task)
    task.add_done_callback(_background.discard)


async def execute_purchase(watch_id: int, trigger: str) -> Order | None:
    """Try to buy tickets for a watch. Safe to call concurrently; only one run per watch."""
    lock = _locks.setdefault(watch_id, asyncio.Lock())
    if lock.locked():
        return None
    async with lock:
        with SessionLocal() as db:
            w = db.get(Watch, watch_id)
            if w is None or w.status in BUSY_STATUSES:
                return None
            m = w.match
            gw = get_gateway()
            profile = get_profile(db)
            if not profile.payment_method_id or profile.gateway != gw.name:
                set_watch(db, w, "failed", "No saved payment method. Add a card first.")
                bus.log("error", f"✖ {m.label}: no saved payment method")
                return None

            # No status writes before the first hold attempt: every millisecond counts at T+0.
            # The per-watch asyncio lock already prevents concurrent runs.
            deadline = time.monotonic() + settings.purchase_timeout_seconds
            attempts = 0
            reserved: SeatCategory | None = None
            seat: SeatHold | None = None
            eligible: list[SeatCategory] = []
            exact_lost = False
            while time.monotonic() < deadline:
                if now_ms() < m.sale_opens_at_ms:
                    await asyncio.sleep(0.005)
                    continue
                attempts += 1
                db.expire_all()

                # 1) Exact seats chosen by the buyer: all of them or none.
                if w.exact_block and not exact_lost:
                    seat = exchange.reserve_exact(db, m.id, w.exact_block, w.exact_positions)
                    if seat:
                        reserved = next(c for c in m.categories if any(b == w.exact_block for b in _zone_blocks(c.code)))
                        break
                    exact_lost = True
                    if not w.exact_fallback:
                        break
                    bus.log("warn", f"{m.label}: your exact seats were taken, falling back to the best seats in your zone")

                # 2) Best available adjacent seats in the chosen zones.
                wanted = set(w.category_codes)
                eligible = [c for c in m.categories if c.code in wanted and c.price_cents <= w.max_price_cents]
                # best: best-positioned zone you can afford first; cheapest: lowest price first
                eligible.sort(key=(lambda c: c.sort_order) if w.strategy == "best" else (lambda c: (c.price_cents, c.sort_order)))
                for c in eligible:
                    seat = exchange.reserve_best(db, c, w.quantity)
                    if seat:
                        reserved = c
                        break
                # Seat-level holds are definitive: if no zone has enough adjacent seats now, retrying won't help.
                break

            if reserved is None or seat is None:
                if now_ms() < m.sale_opens_at_ms:
                    reason = "Sale did not open in time"
                elif exact_lost and not w.exact_fallback:
                    reason = f"Your exact seats (Block {w.exact_block}, {describe(w.exact_positions)}) were already taken"
                elif not eligible:
                    reason = "No seating zone matches your price limit"
                elif any(c.available >= w.quantity for c in eligible):
                    reason = f"No {w.quantity} seats together left in your zones. Try fewer tickets or more zones"
                else:
                    reason = "Sold out in your zones and price range"
                set_watch(db, w, "failed", reason)
                bus.log("error", f"✖ {m.label}: {reason} ({attempts} attempts)")
                return None

            order = Order(
                block=seat.block,
                row=seat.positions[0][0],
                seats_csv=positions_csv(seat.positions),
                gate=seat.gate,
                block_index=seat.block_index,
                id=_new_order_id(db),
                watch_id=w.id,
                match_id=m.id,
                category_id=reserved.id,
                quantity=len(seat.positions),
                unit_price_cents=reserved.price_cents,
                total_cents=reserved.price_cents * len(seat.positions),
                currency=settings.currency,
                status="pending",
                gateway=gw.name,
                payment_method_id=profile.payment_method_id,
                latency_ms=max(0, now_ms() - m.sale_opens_at_ms),
                trigger=trigger,
                hold_expires_at_ms=now_ms() + settings.hold_seconds * 1000,
            )
            db.add(order)
            w.order_id = order.id
            db.commit()
            set_watch(db, w, "purchasing", f"Seats held: Block {seat.block}, {describe(seat.positions)}. Charging card…")
            publish_order(order)
            publish_inventory(db, m.id)
            bus.publish("seats", {"match_id": m.id, "block": seat.block})
            bus.log(
                "info",
                f"⚡ Held Block {seat.block}, {describe(seat.positions)} for {m.label} "
                f"{order.latency_ms} ms after opening "
                f"({attempts} attempt{'s' if attempts > 1 else ''}). Charging {money(order.total_cents)}",
            )

            result = await asyncio.to_thread(
                gw.charge,
                customer_id=profile.customer_id,
                payment_method_id=profile.payment_method_id,
                amount_cents=order.total_cents,
                currency=order.currency,
                idempotency_key=f"order-{order.id}",
                description=f"{m.label} · {w.quantity}× {reserved.name}",
                metadata={"order_id": order.id, "match_id": str(m.id)},
            )
            apply_charge_result(db, order, result)
            return order


def apply_charge_result(db: Session, order: Order, r: ChargeResult) -> None:
    if r.payment_id:
        order.payment_id = r.payment_id
    if r.status == "succeeded":
        finalize_paid(db, order)
    elif r.status in ("requires_action", "processing"):
        order.status = "requires_action" if r.status == "requires_action" else "pending"
        order.client_secret = r.client_secret
        db.commit()
        publish_order(order)
        w = db.get(Watch, order.watch_id) if order.watch_id else None
        if w and r.status == "requires_action":
            set_watch(db, w, "requires_action", "Your bank needs you to approve this payment")
            bus.log("warn", f"⚠ {order.match.label}: bank authentication required (seats held {settings.hold_seconds}s)")
    else:
        finalize_failed(db, order, r.error or "Payment failed")


def finalize_paid(db: Session, order: Order) -> None:
    order.status = "paid"
    order.paid_at_ms = now_ms()
    order.client_secret = None
    order.hold_expires_at_ms = None
    db.commit()
    publish_order(order)
    w = db.get(Watch, order.watch_id) if order.watch_id else None
    if w:
        set_watch(
            db, w, "purchased",
            f"{order.category.name} · Block {order.block}, {describe(order.positions)} · {money(order.total_cents)}",
        )
    bus.log(
        "ok",
        f"✔ BOUGHT {order.match.label}: {order.quantity}× {order.category.code} {money(order.total_cents)}, "
        f"Block {order.block} · {describe(order.positions)} "
        f"(order {order.id}, {order.latency_ms} ms after opening)",
    )


def release_order_seats(db: Session, order: Order) -> None:
    exchange.release(db, order.match_id, order.block, order.positions)
    bus.publish("seats", {"match_id": order.match_id, "block": order.block})


def finalize_failed(db: Session, order: Order, reason: str) -> None:
    if order.status in ("pending", "requires_action"):
        release_order_seats(db, order)
        publish_inventory(db, order.match_id)
    order.status = "failed"
    order.failure_reason = reason
    order.client_secret = None
    order.hold_expires_at_ms = None
    db.commit()
    publish_order(order)
    w = db.get(Watch, order.watch_id) if order.watch_id else None
    if w:
        set_watch(db, w, "failed", f"Payment failed: {reason}")
    bus.log("error", f"✖ Payment failed for {order.match.label} (order {order.id}): {reason}. Seats released")


async def run_hold_sweeper() -> None:
    """Release seats whose 3-D Secure authentication was never completed."""
    while True:
        await asyncio.sleep(5)
        try:
            with SessionLocal() as db:
                expired = db.scalars(
                    select(Order).where(
                        Order.status.in_(["pending", "requires_action"]),
                        Order.hold_expires_at_ms.is_not(None),
                        Order.hold_expires_at_ms < now_ms(),
                    )
                ).all()
                for o in expired:
                    finalize_failed(db, o, "Seat hold expired before payment was approved")
        except Exception:
            log.exception("hold sweeper failed")
