"""Ticket inventory source (seat level).

`TicketExchange` is the seam where an authorised ticketing provider API would plug in.
`SimulatedExchange` keeps seat maps in our own DB and simulates rival buyers.

All methods are synchronous and called from the event-loop thread, so each
check-and-take is atomic with respect to other purchases and the rival simulator.
"""

from __future__ import annotations

import asyncio
import logging
import math
import random
from abc import ABC, abstractmethod

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..events import bus
from ..models import Match, SeatBlock, SeatCategory, now_ms
from .seating import FREE, TAKEN, Position, SeatHold, best_run, positions_free, random_run, set_positions, set_seats

log = logging.getLogger("kickoff.exchange")


class TicketExchange(ABC):
    @abstractmethod
    def reserve_best(self, db: Session, category: SeatCategory, quantity: int) -> SeatHold | None:
        """Hold the best `quantity` adjacent seats in a zone."""

    @abstractmethod
    def reserve_exact(self, db: Session, match_id: int, block: str, positions: list[Position]) -> SeatHold | None:
        """Hold exactly these (row, seat) positions, or nothing if any of them is taken."""

    @abstractmethod
    def release(self, db: Session, match_id: int, block: str, positions: list[Position]) -> None:
        """Return held seats to inventory."""


class SimulatedExchange(TicketExchange):
    RIVAL_TICK_S = 0.25
    RIVAL_WARMUP_MS = 1500  # rivals are stuck in the queue for the first 1.5 s

    @staticmethod
    def _hold(db: Session, sb: SeatBlock, positions: list[Position]) -> SeatHold:
        sb.state = set_positions(sb.state, positions, sb.seats_per_row, TAKEN)
        cat = db.get(SeatCategory, sb.category_id)
        cat.available = max(0, cat.available - len(positions))
        db.commit()
        return SeatHold(sb.block, sb.block_index, sorted(positions), sb.gate)

    def reserve_best(self, db: Session, category: SeatCategory, quantity: int) -> SeatHold | None:
        blocks = db.scalars(
            select(SeatBlock).where(SeatBlock.category_id == category.id).order_by(SeatBlock.rank)
        ).all()
        for sb in blocks:
            found = best_run(sb.state, sb.rows, sb.seats_per_row, quantity)
            if found:
                row, seats = found
                return self._hold(db, sb, [(row, s) for s in seats])
        return None

    def reserve_exact(self, db: Session, match_id: int, block: str, positions: list[Position]) -> SeatHold | None:
        sb = db.scalar(select(SeatBlock).where(SeatBlock.match_id == match_id, SeatBlock.block == block))
        if sb is None or not positions:
            return None
        if any(not (1 <= r <= sb.rows and 1 <= s <= sb.seats_per_row) for r, s in positions):
            return None
        if not positions_free(sb.state, positions, sb.seats_per_row):
            return None
        return self._hold(db, sb, positions)

    def release(self, db: Session, match_id: int, block: str, positions: list[Position]) -> None:
        sb = db.scalar(select(SeatBlock).where(SeatBlock.match_id == match_id, SeatBlock.block == block))
        if sb is None or not positions:
            return
        sb.state = set_positions(sb.state, positions, sb.seats_per_row, FREE)
        cat = db.get(SeatCategory, sb.category_id)
        cat.available = min(cat.capacity, cat.available + len(positions)) if cat.capacity else cat.available + len(positions)
        db.commit()

    async def run_rivals(self) -> None:
        while True:
            await asyncio.sleep(self.RIVAL_TICK_S)
            try:
                self._rival_tick()
            except Exception:  # keep the simulator alive
                log.exception("rival tick failed")

    def _rival_tick(self) -> None:
        cutoff = now_ms() - self.RIVAL_WARMUP_MS
        rng = random
        with SessionLocal() as db:
            rows = db.execute(
                select(SeatCategory, Match.demand)
                .join(Match, SeatCategory.match_id == Match.id)
                .where(Match.sale_opens_at_ms <= cutoff, Match.published_at_ms.is_not(None), SeatCategory.available > 0)
            ).all()
            if not rows:
                return
            cat_ids = [c.id for c, _ in rows]
            blocks_by_cat: dict[int, list[SeatBlock]] = {}
            for sb in db.scalars(select(SeatBlock).where(SeatBlock.category_id.in_(cat_ids))):
                blocks_by_cat.setdefault(sb.category_id, []).append(sb)

            changes: dict[int, int] = {}
            for cat, demand in rows:
                # Popular matches sell out in well under a minute; quieter ones take a few minutes.
                target = math.ceil(cat.capacity * demand / 1600 * rng.uniform(0.4, 1.6))
                blocks = [b for b in blocks_by_cat.get(cat.id, []) if FREE in b.state]
                taken = 0
                while taken < target and blocks:
                    sb = rng.choice(blocks)
                    grab = random_run(sb.state, sb.rows, sb.seats_per_row, 4, rng)
                    if grab is None:
                        blocks.remove(sb)
                        continue
                    sb.state = set_seats(sb.state, grab[0], grab[1], sb.seats_per_row, TAKEN)
                    taken += len(grab[1])
                if taken:
                    cat.available = max(0, cat.available - taken)
                    changes[cat.id] = cat.available
            if changes:
                db.commit()
                bus.publish("inventory", changes)


def publish_inventory(db: Session, match_id: int) -> None:
    cats = db.scalars(select(SeatCategory).where(SeatCategory.match_id == match_id)).all()
    bus.publish("inventory", {c.id: c.available for c in cats})


exchange = SimulatedExchange()
