"""Import complete real fixture lists from football-data.org (optional; needs a free API key).

Every scheduled fixture becomes a match with `sale_date_tba`, so buyers can pick seats and
pre-order the whole season. Clubs we know are mapped to our names (crests, home grounds);
other clubs keep the API's short name and crest URL.
"""

from __future__ import annotations

import logging
import random
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Match, SeatCategory, now_ms
from ..seed import STADIUMS, UNPUBLISHED_SALE_MS, ZONES, _pair_info, _zone_price, restock, team_directory

log = logging.getLogger("kickoff.import")

# our league id -> football-data.org competition code (free tier)
COMPETITIONS = {
    "EPL": "PL", "LIGA": "PD", "SA": "SA", "BUN": "BL1", "L1": "FL1", "ERE": "DED",
    "POR": "PPL", "ELC": "ELC", "BRA": "BSA", "UCL": "CL",
}

LEAGUE_TZ = {
    "EPL": "Europe/London", "ELC": "Europe/London", "LIGA": "Europe/Madrid", "SA": "Europe/Rome",
    "BUN": "Europe/Berlin", "L1": "Europe/Paris", "ERE": "Europe/Amsterdam", "POR": "Europe/Lisbon",
    "BRA": "America/Sao_Paulo", "UCL": "Europe/Paris",
}

# football-data.org team id -> our team name (same ids as the crest files in frontend/public/logos)
FD_TEAMS = {
    86: "Real Madrid", 81: "Barcelona", 78: "Atlético Madrid", 559: "Sevilla", 90: "Real Betis", 77: "Athletic Club",
    95: "Valencia", 94: "Villarreal", 66: "Manchester United", 64: "Liverpool", 57: "Arsenal", 73: "Tottenham",
    65: "Manchester City", 62: "Everton", 61: "Chelsea", 67: "Newcastle", 71: "Sunderland", 58: "Aston Villa",
    108: "Inter", 98: "AC Milan", 109: "Juventus", 100: "Roma", 110: "Lazio", 113: "Napoli", 102: "Atalanta",
    5: "Bayern Munich", 4: "Borussia Dortmund", 6: "Schalke 04", 3: "Bayer Leverkusen", 721: "RB Leipzig",
    19: "Eintracht Frankfurt", 524: "Paris Saint-Germain", 516: "Marseille", 523: "Lyon", 527: "Saint-Étienne",
    548: "Monaco", 521: "Lille", 546: "Lens", 678: "Ajax", 675: "Feyenoord", 674: "PSV", 682: "AZ", 666: "Twente",
    1903: "Benfica", 503: "Porto", 498: "Sporting CP", 5613: "Braga", 610: "Galatasaray", 613: "Fenerbahçe",
    600: "Beşiktaş", 602: "Trabzonspor", 851: "Club Brugge", 726: "Anderlecht", 1858: "Genk", 1866: "Standard Liège",
    1864: "Antwerp", 1783: "Flamengo", 1765: "Fluminense", 1769: "Palmeiras", 1779: "Corinthians", 1776: "São Paulo",
    6685: "Santos", 68: "Norwich", 349: "Ipswich", 345: "Sheffield Wednesday", 356: "Sheffield United",
    340: "Southampton", 343: "Middlesbrough", 338: "Leicester", 74: "West Brom", 732: "Celtic", 99: "Fiorentina",
    354: "Crystal Palace",
}


class ImportError_(Exception):
    pass


def _team(t: dict) -> tuple[str, str | None]:
    """(our name, crest url for clubs we don't have artwork for)."""
    name = FD_TEAMS.get(t.get("id") or -1)
    if name:
        return name, None
    return (t.get("shortName") or t.get("name") or "TBD"), t.get("crest")


def fetch_matches(code: str, client: httpx.Client | None = None) -> list[dict]:
    if not settings.football_data_api_key:
        raise ImportError_("FOOTBALL_DATA_API_KEY is not configured")
    own = client is None
    client = client or httpx.Client(timeout=20)
    try:
        r = client.get(
            f"{settings.football_data_base_url}/competitions/{code}/matches",
            params={"status": "SCHEDULED,TIMED"},
            headers={"X-Auth-Token": settings.football_data_api_key},
        )
        if r.status_code == 429:
            raise ImportError_("Rate limit reached (free tier: 10 requests/minute). Try again in a minute.")
        if r.status_code in (401, 403):
            raise ImportError_(f"football-data.org refused access to {code} (check the API key / plan)")
        r.raise_for_status()
        return r.json().get("matches", [])
    except httpx.HTTPError as e:
        raise ImportError_(f"Could not reach football-data.org: {e}") from e
    finally:
        if own:
            client.close()


def import_league(db: Session, league_id: str, client: httpx.Client | None = None) -> dict[str, int]:
    code = COMPETITIONS.get(league_id)
    if not code:
        raise ImportError_(f"{league_id} is not available from football-data.org")
    directory = team_directory()
    created = updated = 0
    rng = random.Random()
    for fx in fetch_matches(code, client):
        ext = f"fd:{fx['id']}"
        home, home_crest = _team(fx.get("homeTeam") or {})
        away, away_crest = _team(fx.get("awayTeam") or {})
        if "TBD" in (home, away):
            continue  # knockout tie without teams yet
        kickoff = datetime.fromisoformat(fx["utcDate"].replace("Z", "+00:00")).astimezone(timezone.utc)
        kickoff_ms = int(kickoff.timestamp() * 1000)
        tbc = fx.get("status") == "SCHEDULED"  # TIMED = kick-off time confirmed
        rnd = f"Matchday {fx['matchday']}" if fx.get("matchday") else (fx.get("stage") or "").replace("_", " ").title()

        m = db.scalar(select(Match).where(Match.external_id == ext))
        if m is not None:  # keep sale state; refresh date/time (fixtures get moved for TV)
            if (m.kickoff_ms, m.kickoff_tbc) != (kickoff_ms, tbc):
                m.kickoff_ms, m.kickoff_tbc = kickoff_ms, tbc
                updated += 1
            continue

        stadium = directory.get(home, {}).get("stadium") or (fx.get("venue") or f"{home} home ground")
        city, country, capacity, tz = STADIUMS.get(stadium, ("", "", 0, LEAGUE_TZ.get(league_id, "UTC")))
        famous, demand = _pair_info(home, away)
        now = now_ms()
        m = Match(
            league_id=league_id, home_team=home, away_team=away, stadium=stadium, famous_name=famous, demand=demand,
            city=city, country=country, capacity=capacity, timezone=tz, round_label=rnd or "Scheduled",
            kickoff_ms=kickoff_ms, kickoff_tbc=tbc, published_at_ms=now, sale_date_tba=True,
            sale_opens_at_ms=now + UNPUBLISHED_SALE_MS, source="import", external_id=ext,
            home_crest_url=home_crest, away_crest_url=away_crest,
            categories=[
                SeatCategory(code=z.code, name=z.name, stand=z.stand, sort_order=n, price_cents=_zone_price(z, demand),
                             description=z.description.replace("away supporters", f"{away} supporters"),
                             capacity=0, available=0)
                for n, z in enumerate(ZONES)
            ],
        )
        db.add(m)
        db.flush()
        restock(db, m, rng)
        created += 1
    db.commit()
    return {"created": created, "updated": updated}


__all__ = ["COMPETITIONS", "ImportError_", "import_league", "ZoneInfo"]
