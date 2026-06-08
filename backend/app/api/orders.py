import asyncio
import json
from datetime import datetime, timedelta, timezone

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal, get_db
from ..events import bus
from ..models import Order, Watch
from ..schemas import AttendeesIn, OrderOut
from ..services.seating import describe
from ..services.exchange import publish_inventory
from ..services.payments import PaymentError, get_gateway
from ..services.purchase import (
    apply_charge_result,
    finalize_failed,
    finalize_paid,
    money,
    publish_order,
    release_order_seats,
    set_watch,
)

router = APIRouter(prefix="/api", tags=["orders"])


def _get(db: Session, order_id: str) -> Order:
    o = db.get(Order, order_id)
    if o is None:
        raise HTTPException(404, "Order not found")
    return o


@router.get("/orders", response_model=list[OrderOut])
async def list_orders(db: Session = Depends(get_db)) -> list[OrderOut]:
    return [OrderOut.from_order(o) for o in db.scalars(select(Order).order_by(Order.created_at_ms.desc()))]


@router.post("/orders/{order_id}/confirm", response_model=OrderOut)
async def confirm_order(order_id: str, db: Session = Depends(get_db)) -> OrderOut:
    """Called after the customer completes 3-D Secure in the browser."""
    o = _get(db, order_id)
    if o.status not in ("requires_action", "pending") or not o.payment_id:
        raise HTTPException(409, f"Order is {o.status}")
    result = await asyncio.to_thread(get_gateway().confirm, o.payment_id)
    apply_charge_result(db, o, result)
    return OrderOut.from_order(o)


@router.post("/orders/{order_id}/refund", response_model=OrderOut)
async def refund_order(order_id: str, db: Session = Depends(get_db)) -> OrderOut:
    o = _get(db, order_id)
    if o.status != "paid" or not o.payment_id:
        raise HTTPException(409, "Only paid orders can be refunded")
    try:
        await asyncio.to_thread(get_gateway().refund, o.payment_id)
    except PaymentError as e:
        raise HTTPException(502, str(e)) from e
    o.status = "refunded"
    db.commit()
    release_order_seats(db, o)
    publish_inventory(db, o.match_id)
    publish_order(o)
    w = db.get(Watch, o.watch_id) if o.watch_id else None
    if w:
        set_watch(db, w, "failed", f"Order {o.id} refunded")
    bus.log("warn", f"↩ Refunded order {o.id} ({money(o.total_cents)})")
    return OrderOut.from_order(o)


@router.put("/orders/{order_id}/attendees", response_model=OrderOut)
async def set_attendees(order_id: str, body: AttendeesIn, db: Session = Depends(get_db)) -> OrderOut:
    """Name the holder of each seat (tickets are personal; ID may be checked at the gate)."""
    o = _get(db, order_id)
    if o.status not in ("paid", "pending", "requires_action"):
        raise HTTPException(409, f"Order is {o.status}")
    seats = set(o.positions)
    for a in body.attendees:
        if (a.row, a.seat) not in seats:
            raise HTTPException(422, f"Row {a.row} seat {a.seat} is not part of order {o.id}")
    by_seat = {(a.row, a.seat): a.name.strip() for a in body.attendees}
    o.attendees_json = json.dumps([{"row": r, "seat": s, "name": by_seat.get((r, s), "")} for r, s in o.positions])
    db.commit()
    publish_order(o)
    named = sum(1 for n in by_seat.values() if n)
    bus.log("info", f"Ticket holders saved for order {o.id}: {named}/{len(o.positions)} named")
    return OrderOut.from_order(o)


