"""Fixture announcement feed.

Simulates leagues publishing their schedules: every `fixture_publish_interval_s` one
unannounced fixture becomes public, with its ticket sale opening a few minutes later.
Buyers are notified instantly over /ws (`fixture_published`) and can pre-order before the
sale opens. With `auto_preorder_favorites`, fixtures in favourite leagues are pre-ordered
automatically at announcement time.

In production this is where an authorised fixtures/ticketing provider feed would plug in.
"""

from __future__ import annotations

import asyncio
import logging
import random

from sqlalchemy import func, select

from ..config import settings
from ..db import SessionLocal
from ..events import bus
from ..models import Match, Watch, now_ms
from ..schemas import MatchOut
from ..seed import DEFAULT_ZONE_CODES, default_max_price, restock
from .payments import get_gateway
from .purchase import get_profile, money, publish_watch
from .sniper import sniper

log = logging.getLogger("kickoff.fixtures")


class FixtureFeed:
    def __init__(self) -> None:
        self.next_publish_at_ms: int | None = None
        self._rng = random.Random()

    def pending(self) -> int:
        with SessionLocal() as db:
            return db.scalar(select(func.count()).select_from(Match).where(Match.published_at_ms.is_(None))) or 0

    async def run(self) -> None:
        self.next_publish_at_ms = now_ms() + int(settings.fixture_first_publish_s * 1000)
        while True:
            await asyncio.sleep(max(0, (self.next_publish_at_ms - now_ms()) / 1000))
            try:
                self.publish_next()
            except Exception:
                log.exception("fixture publication failed")
                self.next_publish_at_ms = now_ms() + int(settings.fixture_publish_interval_s * 1000)

    def reschedule(self) -> None:
        """After a demo reset: restart the countdown to the next announcement."""
        self.next_publish_at_ms = now_ms() + int(settings.fixture_first_publish_s * 1000)
        bus.publish("schedule", {"pending": self.pending(), "next_publish_at_ms": self.next_publish_at_ms})

    def publish_next(self) -> int | None:
        """Announce the next fixture. Returns its match id, or None when the pool is empty."""
        with SessionLocal() as db:
            m = db.scalar(select(Match).where(Match.published_at_ms.is_(None)).order_by(Match.id).limit(1))
            now = now_ms()
            if m is None:
                self.next_publish_at_ms = None
                return None
            lead_s = self._rng.randint(settings.fixture_sale_lead_min_s, settings.fixture_sale_lead_max_s)
            m.published_at_ms = now
            m.sale_opens_at_ms = now + lead_s * 1000
            restock(db, m, self._rng)
            db.commit()

            remaining = db.scalar(select(func.count()).select_from(Match).where(Match.published_at_ms.is_(None))) or 0
            self.next_publish_at_ms = now + int(settings.fixture_publish_interval_s * 1000) if remaining else None
            bus.publish(
                "fixture_published",
                {
                    "match": MatchOut.model_validate(m).model_dump(),
                    "pending": remaining,
                    "next_publish_at_ms": self.next_publish_at_ms,
                },
            )
            bus.log(
                "ok",
                f"📅 NEW FIXTURE: {m.label} ({m.league.name}, {m.round_label}) at {m.stadium}. "
                f"Tickets on sale in {lead_s // 60}m {lead_s % 60:02d}s",
            )
            self._auto_preorder(db, m)
            return m.id

    def _auto_preorder(self, db, m: Match) -> None:
        p = get_profile(db)
        if not (p.auto_preorder_favorites and m.league_id in p.favorite_leagues):
            return
        if not p.payment_method_id or p.gateway != get_gateway().name:
            bus.log("warn", f"Auto pre-order skipped for {m.label}: no saved payment card")
            return
        if db.scalar(select(Watch.id).where(Watch.match_id == m.id)):
            return
        codes = list(DEFAULT_ZONE_CODES)
        w = Watch(match_id=m.id, mode="auto", strategy="best", quantity=p.auto_preorder_quantity,
                  max_price_cents=default_max_price(m, codes))
        w.category_codes = codes
        w.message = "Auto pre-ordered (favourite league): buys the instant the sale opens"
        db.add(w)
        db.commit()
        publish_watch(w)
        sniper.arm(w.id)
        bus.log("ok", f"⏱ Auto pre-ordered {w.quantity} tickets for {m.label} (favourite league, max {money(w.max_price_cents)} each)")


feed = FixtureFeed()
