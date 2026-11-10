from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..db import get_db
from ..events import bus
from ..models import League, Match, SeatBlock, now_ms
from ..schemas import BlockDetail, BlockSummary, ConfigOut, LeagueOut, LogEntry, MatchOut
from ..services.payments import get_gateway

router = APIRouter(prefix="/api", tags=["catalog"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/config", response_model=ConfigOut)
async def config() -> ConfigOut:
    gw = get_gateway()
    return ConfigOut(
        gateway=gw.name,  # type: ignore[arg-type]
        schedule_import_enabled=bool(settings.football_data_api_key),
        stripe_publishable_key=(settings.stripe_publishable_key or None) if gw.name == "stripe" else None,
        currency=settings.currency,
        max_tickets_per_order=settings.max_tickets_per_order,
        server_time_ms=now_ms(),
    )


@router.get("/leagues", response_model=list[LeagueOut])
async def leagues(db: Session = Depends(get_db)) -> list[League]:
    return list(db.scalars(select(League).order_by(League.sort_order)))


@router.get("/matches", response_model=list[MatchOut])
async def matches(
    league: list[str] | None = Query(None, description="Filter by league id; repeatable"),
    famous: bool = False,
    q: str | None = Query(None, max_length=64),
    db: Session = Depends(get_db),
) -> list[Match]:
    stmt = (
        select(Match)
        .options(selectinload(Match.categories))
        .where(Match.published_at_ms.is_not(None))  # only announced fixtures
        .order_by(Match.sale_opens_at_ms)
    )
    if league:
        stmt = stmt.where(Match.league_id.in_(league))
    if famous:
        stmt = stmt.where(Match.famous_name.is_not(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Match.home_team.ilike(like), Match.away_team.ilike(like), Match.famous_name.ilike(like)))
    return list(db.scalars(stmt))


def _published(db: Session, match_id: int) -> Match:
    m = db.get(Match, match_id)
    if m is None or m.published_at_ms is None:
        raise HTTPException(404, "Match not found")
    return m


def _summary(sb: SeatBlock, zone_code: str) -> dict:
    return {
        "block": sb.block, "zone_code": zone_code, "block_index": sb.block_index, "rank": sb.rank, "gate": sb.gate,
        "rows": sb.rows, "seats_per_row": sb.seats_per_row, "free": sb.free,
    }


@router.get("/matches/{match_id}/seatmap", response_model=list[BlockSummary])
async def seatmap(match_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """All blocks of the stadium with their free-seat counts."""
    m = _published(db, match_id)
    zone_of = {c.id: c.code for c in m.categories}
    blocks = db.scalars(select(SeatBlock).where(SeatBlock.match_id == m.id).order_by(SeatBlock.category_id, SeatBlock.rank))
    return [_summary(sb, zone_of[sb.category_id]) for sb in blocks]


@router.get("/matches/{match_id}/blocks/{block}", response_model=BlockDetail)
async def block_detail(match_id: int, block: str, db: Session = Depends(get_db)) -> dict:
    """Seat-by-seat availability of one block."""
    m = _published(db, match_id)
    sb = db.scalar(select(SeatBlock).where(SeatBlock.match_id == m.id, SeatBlock.block == block))
    if sb is None:
        raise HTTPException(404, "Block not found")
    zone = next(c.code for c in m.categories if c.id == sb.category_id)
    return {**_summary(sb, zone), "state": sb.state}


@router.get("/logs", response_model=list[LogEntry])
async def logs() -> list[dict]:
    return bus.recent_logs()
