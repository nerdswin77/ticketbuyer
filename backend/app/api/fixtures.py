"""Buyer-added fixtures and ticket-sale announcements."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..events import bus
from ..models import League, Match, Watch, now_ms
from ..schemas import MatchCreate, MatchOut, SaleDateIn, TeamOut
from ..seed import create_user_match, team_directory
from ..services.fixture_import import COMPETITIONS, ImportError_, import_league
from ..services.sniper import ARMABLE, sniper

router = APIRouter(prefix="/api", tags=["fixtures"])


@router.get("/teams", response_model=list[TeamOut])
async def teams() -> list[dict]:
    return sorted(team_directory().values(), key=lambda t: t["name"])


@router.post("/matches", response_model=MatchOut, status_code=201)
async def add_match(body: MatchCreate, response: Response, db: Session = Depends(get_db)) -> Match:
    """Add a fixture that isn't listed yet (e.g. just announced by the club). Ticket sale date starts as TBA,
    but buyers can pick exact seats and pre-order immediately."""
    if db.get(League, body.league_id) is None:
        raise HTTPException(422, "Unknown competition")
    if body.home_team == body.away_team:
        raise HTTPException(422, "Home and away team must be different")
    known = team_directory()
    for t in (body.home_team, body.away_team):
        if t not in known:
            raise HTTPException(422, f"Unknown team: {t}")
    if body.date.toordinal() < __import__("datetime").date.today().toordinal():
        raise HTTPException(422, "The match date is in the past")
    try:
        m, created = create_user_match(db, body.league_id, body.home_team, body.away_team, body.date, body.time)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    if not created:
        response.status_code = 200
        return m
    bus.publish("match_added", MatchOut.model_validate(m).model_dump())
    bus.log("ok", f"➕ Added {m.label} on {body.date.isoformat()} at {m.stadium}. Ticket sale date TBA: you can pre-order seats now")
    return m


@router.post("/schedule/import")
async def import_schedule(league_ids: list[str] | None = None, db: Session = Depends(get_db)) -> dict:
    """Load complete real fixture lists from football-data.org (requires FOOTBALL_DATA_API_KEY)."""
    targets = league_ids or list(COMPETITIONS)
    results: dict[str, dict | str] = {}
    for lid in targets:
        try:
            results[lid] = await asyncio.to_thread(_import_one, lid)
        except ImportError_ as e:
            results[lid] = str(e)
            if "API key" in str(e) or "not configured" in str(e):
                raise HTTPException(400, str(e)) from e
    total = sum(r["created"] for r in results.values() if isinstance(r, dict))
    bus.publish("matches_reset", {})
    bus.log("ok" if total else "info", f"📅 Schedule import: {total} new fixtures from football-data.org")
    return {"results": results, "created": total}


def _import_one(league_id: str) -> dict[str, int]:
    from ..db import SessionLocal

    with SessionLocal() as db:
        return import_league(db, league_id)


@router.post("/matches/{match_id}/announce-sale", response_model=MatchOut)
async def announce_sale(match_id: int, body: SaleDateIn, db: Session = Depends(get_db)) -> Match:
    """Demo stand-in for the club/ticketing provider announcing when the ticket sale opens.
    Every pre-order on the match is re-armed for the exact opening time."""
    m = db.get(Match, match_id)
    if m is None or m.published_at_ms is None:
        raise HTTPException(404, "Match not found")
    if not m.sale_date_tba and m.sale_opens_at_ms <= now_ms():
        raise HTTPException(409, "The ticket sale is already open")
    m.sale_date_tba = False
    m.sale_opens_at_ms = now_ms() + body.opens_in_seconds * 1000
    db.commit()
    armed = 0
    for w in db.scalars(select(Watch).where(Watch.match_id == m.id, Watch.status.in_(ARMABLE))):
        sniper.arm(w.id)
        armed += 1
    data = MatchOut.model_validate(m).model_dump()
    bus.publish("sale_announced", data)
    secs = body.opens_in_seconds
    bus.log(
        "warn",
        f"📣 SALE DATE ANNOUNCED: {m.label}. Tickets on sale in {secs // 60}m {secs % 60:02d}s"
        + (f" · {armed} pre-order{'s' if armed != 1 else ''} armed" if armed else ""),
    )
    return m
