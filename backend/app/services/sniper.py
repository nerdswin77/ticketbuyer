"""Server-side scheduler: one asyncio task per watched match fires at the sale opening."""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from ..config import settings
from ..db import SessionLocal
from ..events import bus
from ..models import Watch, now_ms
from .purchase import execute_purchase, set_watch

log = logging.getLogger("kickoff.sniper")

ARMABLE = {"watching", "armed"}


class Sniper:
    def __init__(self) -> None:
        self._tasks: dict[int, asyncio.Task[None]] = {}

    def arm(self, watch_id: int) -> None:
        self.disarm(watch_id)
        self._tasks[watch_id] = asyncio.create_task(self._run(watch_id), name=f"watch-{watch_id}")

    def disarm(self, watch_id: int) -> None:
        task = self._tasks.pop(watch_id, None)
        if task and task is not asyncio.current_task():
            task.cancel()

    async def restore(self) -> None:
        with SessionLocal() as db:
            ids = db.scalars(select(Watch.id).where(Watch.status.in_(ARMABLE))).all()
        for wid in ids:
            self.arm(wid)

    async def rearm_all(self) -> None:
        self.shutdown()
        await self.restore()

    def shutdown(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        self._tasks.clear()

    async def _run(self, watch_id: int) -> None:
        try:
            with SessionLocal() as db:
                w = db.get(Watch, watch_id)
                if w is None or w.status not in ARMABLE:
                    return
                opens_at, label = w.match.sale_opens_at_ms, w.match.label

            # Coarse sleep until shortly before opening, then a tight loop for precision.
            lead = opens_at - now_ms() - settings.arm_lead_ms
            if lead > 0:
                await asyncio.sleep(lead / 1000)
            if now_ms() < opens_at:
                with SessionLocal() as db:
                    w = db.get(Watch, watch_id)
                    if w is None or w.status not in ARMABLE:
                        return
                    set_watch(db, w, "armed", "Ready to buy at opening")
                bus.log("warn", f"ARMED {label}: opens in {(opens_at - now_ms()) / 1000:.1f}s")
                while now_ms() < opens_at:
                    await asyncio.sleep(0.005)

            # Re-read: the user may have switched mode while waiting.
            with SessionLocal() as db:
                w = db.get(Watch, watch_id)
                if w is None or w.status not in ARMABLE:
                    return
                mode = w.mode
                if mode == "alert":
                    set_watch(db, w, "sale_open", "Sale is open. Click BUY NOW")
                    bus.publish("sale_open", {"watch_id": w.id, "match_id": w.match_id, "label": label})
                    bus.log("warn", f"🔔 SALE OPEN {label}: waiting for your click")
                    return
            await execute_purchase(watch_id, "auto")
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("watch %s failed", watch_id)
        finally:
            if self._tasks.get(watch_id) is asyncio.current_task():
                self._tasks.pop(watch_id, None)


sniper = Sniper()
