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

