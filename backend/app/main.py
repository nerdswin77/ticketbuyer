import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .api import account, catalog, orders, watches
from .api import fixtures as fixtures_api
from .config import settings
from .db import Base, SessionLocal, engine, migrate_additive, schema_is_outdated
from .events import bus
from .seed import ensure_test_payment_method, reset_schedule, seed_if_empty
from .schemas import ScheduleOut
from .services.exchange import exchange
from .services.fixtures import feed
from .services.payments import get_gateway
from .services.purchase import run_hold_sweeper
from .services.sniper import sniper

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if schema_is_outdated():
        logging.getLogger("kickoff").warning("Database schema is outdated: rebuilding the demo database")
        Base.metadata.drop_all(engine)
    else:
        added = migrate_additive()
        if added:
            logging.getLogger("kickoff").info("Database upgraded in place: %s", ", ".join(added))
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_if_empty(db)
        if settings.demo_reset_on_start:
            reset_schedule(db)
        if settings.seed_test_card and ensure_test_payment_method(db):
            bus.log("ok", "Test payment method saved: VISA •••• 4242 (mock, always succeeds)")
    tasks = [asyncio.create_task(run_hold_sweeper(), name="hold-sweeper")]
    if settings.simulate_rivals:
        tasks.append(asyncio.create_task(exchange.run_rivals(), name="rivals"))
    if settings.fixture_feed_enabled:
        tasks.append(asyncio.create_task(feed.run(), name="fixture-feed"))
    await sniper.restore()
    bus.log("info", f"Engine ready · payment gateway: {get_gateway().name}")
    yield
    sniper.shutdown()
    for t in tasks:
        t.cancel()


app = FastAPI(title="KickOff Tickets API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
for r in (catalog.router, fixtures_api.router, account.router, watches.router, orders.router):
    app.include_router(r)


@app.post("/api/demo/reset", tags=["demo"])
async def demo_reset() -> dict[str, str]:
    """Move sale openings back into the near future and restock inventory."""
    with SessionLocal() as db:
        reset_schedule(db)
    await sniper.rearm_all()
    if settings.fixture_feed_enabled:
        feed.reschedule()
    bus.publish("matches_reset", {})
    bus.log("info", f"Demo reset: new sale schedule and inventory · {feed.pending()} fixtures waiting to be announced")
    return {"status": "ok"}


@app.get("/api/schedule", response_model=ScheduleOut, tags=["schedule"])
async def schedule() -> ScheduleOut:
    """Fixture announcement feed status: how many fixtures are unannounced and when the next drops."""
    return ScheduleOut(
        pending=feed.pending(),
        next_publish_at_ms=feed.next_publish_at_ms if settings.fixture_feed_enabled else None,
        interval_s=settings.fixture_publish_interval_s,
    )


@app.post("/api/demo/publish-next", tags=["demo"])
async def publish_next() -> dict[str, int | None]:
    """Announce the next fixture immediately (demo helper)."""
    return {"match_id": feed.publish_next()}


@app.websocket("/ws")
async def websocket(ws: WebSocket) -> None:
    await ws.accept()
    q = bus.subscribe()

    async def drain_incoming() -> None:  # detect client disconnects promptly
        while True:
            await ws.receive_text()

    reader = asyncio.create_task(drain_incoming())
    try:
        while True:
            get = asyncio.create_task(q.get())
            done, _ = await asyncio.wait({get, reader}, return_when=asyncio.FIRST_COMPLETED)
            if reader in done:
                get.cancel()
                break
            await ws.send_json(get.result())
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        reader.cancel()
        bus.unsubscribe(q)
