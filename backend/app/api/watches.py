from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..events import bus
from ..models import Match, SeatBlock, SeatCategory, Watch, now_ms
from ..schemas import QuickBuy, SeatSelection, WatchCreate, WatchOut, WatchUpdate
from ..services.seating import describe, positions_csv, positions_free
from ..seed import DEFAULT_ZONE_CODES, ZONE_CODES, default_max_price
from ..services.purchase import BUSY_STATUSES, publish_watch, start_purchase
from ..services.sniper import sniper

router = APIRouter(prefix="/api/watches", tags=["watches"])

VALID_CODES = ZONE_CODES
DEFAULT_CODES = DEFAULT_ZONE_CODES
_default_max_price = default_max_price


def _published_match(db: Session, match_id: int) -> Match:
    m = db.get(Match, match_id)
    if m is None or m.published_at_ms is None:  # unannounced fixtures are invisible to buyers
        raise HTTPException(404, f"Match {match_id} not found")
    return m


def _validate_exact(db: Session, m: Match, sel: SeatSelection) -> SeatCategory:
    """Check the block/row/seats exist; if the sale is already open, check they're still free."""
    sb = db.scalar(select(SeatBlock).where(SeatBlock.match_id == m.id, SeatBlock.block == sel.block))
    if sb is None:
        raise HTTPException(422, f"Block {sel.block} does not exist at {m.stadium}")
    if any(r > sb.rows or s > sb.seats_per_row for r, s in sel.positions):
        raise HTTPException(422, f"Block {sb.block} has rows 1-{sb.rows} and seats 1-{sb.seats_per_row}")
    taken = [p for p in sel.positions if not positions_free(sb.state, [p], sb.seats_per_row)]
    if taken:
        raise HTTPException(409, f"Already sold: {describe(taken)}")
    return db.get(SeatCategory, sb.category_id)


def _get(db: Session, watch_id: int) -> Watch:
    w = db.get(Watch, watch_id)
    if w is None:
        raise HTTPException(404, "Watch not found")
    return w


def _clean_codes(codes: list[str]) -> list[str]:
    bad = set(codes) - VALID_CODES
    if bad:
        raise HTTPException(422, f"Unknown seating zones: {', '.join(sorted(bad))}")
    if not codes:
        raise HTTPException(422, "Select at least one seating zone")
    return sorted(set(codes))


@router.get("", response_model=list[WatchOut])
async def list_watches(db: Session = Depends(get_db)) -> list[Watch]:
    return list(db.scalars(select(Watch).order_by(Watch.created_at_ms)))


@router.post("", response_model=list[WatchOut], status_code=201)
async def create_watches(body: WatchCreate, db: Session = Depends(get_db)) -> list[Watch]:
    codes = _clean_codes(body.category_codes) if body.category_codes is not None else DEFAULT_CODES
    existing = set(db.scalars(select(Watch.match_id).where(Watch.match_id.in_(body.match_ids))))
    created: list[Watch] = []
    for mid in dict.fromkeys(body.match_ids):
        if mid in existing:
            continue
        m = _published_match(db, mid)
        max_price = body.max_price_cents or _default_max_price(m, codes)
        w = Watch(match_id=mid, mode=body.mode, strategy=body.strategy, quantity=body.quantity, max_price_cents=max_price)
        w.category_codes = codes
        db.add(w)
        created.append(w)
    db.commit()
    for w in created:
        publish_watch(w)
        when = "now (already on sale)" if w.match.sale_opens_at_ms <= now_ms() else "at sale opening"
        bus.log("info", f"Watching {w.match.label} [{'auto-buy' if w.mode == 'auto' else 'alert'}]: fires {when}")
        sniper.arm(w.id)
    return created


@router.patch("/{watch_id}", response_model=WatchOut)
async def update_watch(watch_id: int, body: WatchUpdate, db: Session = Depends(get_db)) -> Watch:
    w = _get(db, watch_id)
    if w.status in BUSY_STATUSES:
        raise HTTPException(409, f"Cannot edit while {w.status}")
    if body.mode is not None:
        w.mode = body.mode
    if body.strategy is not None:
        w.strategy = body.strategy
    if body.exact_fallback is not None:
        w.exact_fallback = body.exact_fallback
    if body.quantity is not None:
        w.quantity = body.quantity
    if body.max_price_cents is not None:
        w.max_price_cents = body.max_price_cents
    if body.category_codes is not None:
        w.category_codes = _clean_codes(body.category_codes)
    db.commit()
    publish_watch(w)
    return w


@router.delete("/{watch_id}", status_code=204)
async def delete_watch(watch_id: int, db: Session = Depends(get_db)) -> Response:
    w = _get(db, watch_id)
    if w.status in ("purchasing", "requires_action"):
        raise HTTPException(409, "Purchase in progress")
    sniper.disarm(w.id)
    label = w.match.label
    db.delete(w)
    db.commit()
    bus.publish("watch_removed", {"id": watch_id})
    bus.log("info", f"Removed {label} from watchlist")
    return Response(status_code=204)


def _order_now(db: Session, w: Watch) -> Watch:
    """Never makes the caller wait: buys in the background if on sale, otherwise pre-orders for T+0."""
    if w.status in BUSY_STATUSES:
        raise HTTPException(409, f"Already {w.status}")
    if w.match.sale_opens_at_ms > now_ms():
        w.mode, w.status = "auto", "watching"
        w.message = (
            "Pre-ordered: waiting for the sale date. Buys the instant tickets go on sale"
            if w.match.sale_date_tba
            else "Pre-ordered: buys the instant the sale opens"
        )
        db.commit()
        publish_watch(w)
        seats = f" (Block {w.exact_block}, {describe(w.exact_positions)})" if w.exact_block else ""
        when = "as soon as the sale date is announced and opens" if w.match.sale_date_tba else "automatically at opening"
        bus.log("info", f"⏱ Pre-order placed for {w.match.label}{seats}: fires {when}")
        sniper.arm(w.id)
    else:
        sniper.disarm(w.id)
        start_purchase(w.id, "manual")
    return w


@router.post("/quick-buy", response_model=WatchOut, status_code=202)
async def quick_buy(body: QuickBuy, db: Session = Depends(get_db)) -> Watch:
    """One click from a match card: create the watch if needed and order immediately."""
    m = _published_match(db, body.match_id)
    if body.seats:
        zone = _validate_exact(db, m, body.seats)
        codes = [zone.code]
        max_price = zone.price_cents
        quantity = len(body.seats.positions)
    else:
        codes = _clean_codes(body.category_codes) if body.category_codes is not None else DEFAULT_CODES
        max_price = body.max_price_cents or _default_max_price(m, codes)
        quantity = body.quantity
    w = db.scalar(select(Watch).where(Watch.match_id == m.id))
    if w is None:
        w = Watch(match_id=m.id, mode="auto")
        db.add(w)
    if w.status not in BUSY_STATUSES:
        # A click from the match page carries the buyer's current choice of seats/zones, budget and strategy.
        w.quantity, w.strategy, w.max_price_cents = quantity, body.strategy, max_price
        w.category_codes = codes
        if body.seats:
            w.exact_block, w.exact_row = body.seats.block, body.seats.positions[0][0]
            w.exact_seats_csv = positions_csv(body.seats.positions)
            w.exact_fallback = body.exact_fallback
        else:
            w.exact_block, w.exact_row, w.exact_seats_csv, w.exact_fallback = None, None, "", False
        db.commit()
        publish_watch(w)
    return _order_now(db, w)


@router.post("/{watch_id}/buy", response_model=WatchOut, status_code=202)
async def buy_now(watch_id: int, db: Session = Depends(get_db)) -> Watch:
    """BUY NOW from the watchlist. Returns 202 immediately; the result streams over /ws."""
    return _order_now(db, _get(db, watch_id))


@router.post("/{watch_id}/retry", response_model=WatchOut)
async def retry(watch_id: int, db: Session = Depends(get_db)) -> Watch:
    w = _get(db, watch_id)
    if w.status in BUSY_STATUSES:
        raise HTTPException(409, f"Cannot retry while {w.status}")
    w.status, w.message, w.order_id = "watching", "", None
    db.commit()
    publish_watch(w)
    sniper.arm(w.id)
    return w
