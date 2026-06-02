"""Reference data and demo sale schedule."""

import random
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import League, Match, Order, SeatBlock, SeatCategory, Watch, now_ms
from .services.seating import LAYOUT
from .schemas import MockCardIn, PaymentMethodIn
from .services.payments import get_gateway
from .services.purchase import get_profile

LEAGUES = [
    ("EPL", "Premier League", "England", "🏴"),
    ("LIGA", "La Liga", "Spain", "🇪🇸"),
    ("SA", "Serie A", "Italy", "🇮🇹"),
    ("BUN", "Bundesliga", "Germany", "🇩🇪"),
    ("L1", "Ligue 1", "France", "🇫🇷"),
    ("ERE", "Eredivisie", "Netherlands", "🇳🇱"),
    ("POR", "Primeira Liga", "Portugal", "🇵🇹"),
    ("ELC", "Championship", "England", "🏴"),
    ("SCO", "Scottish Premiership", "Scotland", "🏴"),
    ("TUR", "Süper Lig", "Turkey", "🇹🇷"),
    ("BEL", "Pro League", "Belgium", "🇧🇪"),
    ("BRA", "Brasileirão Série A", "Brazil", "🇧🇷"),
    ("UCL", "Champions League", "Europe", "⭐"),
    ("UEL", "Europa League", "Europe", "🟠"),
    ("UECL", "Conference League", "Europe", "🟢"),
]

# league, home, away, stadium, famous fixture name, demand (1-10)
FIXTURES = [
    ("LIGA", "Real Madrid", "Barcelona", "Santiago Bernabéu", "El Clásico", 10),
    ("LIGA", "Atlético Madrid", "Real Madrid", "Metropolitano", "Madrid Derby", 9),
    ("LIGA", "Sevilla", "Real Betis", "Ramón Sánchez-Pizjuán", "Seville Derby", 8),
    ("LIGA", "Barcelona", "Athletic Club", "Spotify Camp Nou", None, 7),
    ("EPL", "Manchester United", "Liverpool", "Old Trafford", "North-West Derby", 10),
    ("EPL", "Arsenal", "Tottenham", "Emirates Stadium", "North London Derby", 10),
    ("EPL", "Manchester City", "Manchester United", "Etihad Stadium", "Manchester Derby", 9),
    ("EPL", "Liverpool", "Everton", "Anfield", "Merseyside Derby", 9),
    ("EPL", "Chelsea", "Arsenal", "Stamford Bridge", None, 8),
    ("EPL", "Newcastle", "Sunderland", "St James' Park", "Tyne-Wear Derby", 8),
    ("SA", "Inter", "AC Milan", "San Siro", "Derby della Madonnina", 10),
    ("SA", "Juventus", "Inter", "Allianz Stadium", "Derby d'Italia", 9),
    ("SA", "Roma", "Lazio", "Stadio Olimpico", "Derby della Capitale", 9),
    ("SA", "Napoli", "Juventus", "Diego Armando Maradona", None, 8),
    ("BUN", "Bayern Munich", "Borussia Dortmund", "Allianz Arena", "Der Klassiker", 10),
    ("BUN", "Borussia Dortmund", "Schalke 04", "Signal Iduna Park", "Revierderby", 9),
    ("BUN", "Bayer Leverkusen", "Bayern Munich", "BayArena", None, 7),
    ("L1", "Paris Saint-Germain", "Marseille", "Parc des Princes", "Le Classique", 10),
    ("L1", "Lyon", "Saint-Étienne", "Groupama Stadium", "Derby du Rhône", 7),
    ("ERE", "Ajax", "Feyenoord", "Johan Cruijff ArenA", "De Klassieker", 8),
    ("POR", "Benfica", "Porto", "Estádio da Luz", "O Clássico", 8),
    ("UCL", "Real Madrid", "Manchester City", "Santiago Bernabéu", None, 10),
    ("UCL", "Bayern Munich", "Paris Saint-Germain", "Allianz Arena", None, 9),
    ("UCL", "Liverpool", "Barcelona", "Anfield", None, 9),
    ("UCL", "Arsenal", "Inter", "Emirates Stadium", None, 8),
    ("UEL", "Tottenham", "Roma", "Tottenham Hotspur Stadium", None, 6),
    ("UEL", "AC Milan", "Lyon", "San Siro", None, 6),
    # added so every competition has several upcoming fixtures
    ("LIGA", "Valencia", "Villarreal", "Mestalla", None, 6),
    ("EPL", "Aston Villa", "Newcastle", "Villa Park", None, 7),
    ("SA", "Atalanta", "AC Milan", "Gewiss Stadium", None, 7),
    ("BUN", "RB Leipzig", "Borussia Dortmund", "Red Bull Arena", None, 7),
    ("BUN", "Eintracht Frankfurt", "Bayern Munich", "Deutsche Bank Park", None, 8),
    ("L1", "Monaco", "Paris Saint-Germain", "Stade Louis II", None, 7),
    ("L1", "Lille", "Lens", "Stade Pierre-Mauroy", "Derby du Nord", 8),
    ("L1", "Marseille", "Lyon", "Orange Vélodrome", "Choc des Olympiques", 8),
    ("ERE", "PSV", "Ajax", "Philips Stadion", None, 8),
    ("ERE", "Feyenoord", "PSV", "De Kuip", None, 7),
    ("ERE", "AZ", "Twente", "AFAS Stadion", None, 5),
    ("POR", "Sporting CP", "Benfica", "Estádio José Alvalade", "Derby de Lisboa", 9),
    ("POR", "Porto", "Sporting CP", "Estádio do Dragão", None, 8),
    ("POR", "Braga", "Porto", "Estádio Municipal de Braga", None, 6),
    ("UCL", "Inter", "Borussia Dortmund", "San Siro", None, 8),
    ("UEL", "Manchester United", "Porto", "Old Trafford", None, 8),
    ("UEL", "Lazio", "Ajax", "Stadio Olimpico", None, 6),
    # Championship
    ("ELC", "Sheffield Wednesday", "Sheffield United", "Hillsborough", "Steel City Derby", 9),
    ("ELC", "Norwich", "Ipswich", "Carrow Road", "East Anglian Derby", 8),
    ("ELC", "Leicester", "Southampton", "King Power Stadium", None, 6),
    ("ELC", "Middlesbrough", "West Brom", "Riverside Stadium", None, 5),
    ("ELC", "Sheffield United", "Leicester", "Bramall Lane", None, 6),
    # Scottish Premiership
    ("SCO", "Celtic", "Rangers", "Celtic Park", "Old Firm Derby", 10),
    ("SCO", "Rangers", "Celtic", "Ibrox Stadium", "Old Firm Derby", 10),
    ("SCO", "Hearts", "Hibernian", "Tynecastle Park", "Edinburgh Derby", 8),
    ("SCO", "Aberdeen", "Celtic", "Pittodrie Stadium", None, 6),
    # Süper Lig
    ("TUR", "Galatasaray", "Fenerbahçe", "RAMS Park", "Kıtalararası Derbi", 10),
    ("TUR", "Fenerbahçe", "Beşiktaş", "Şükrü Saracoğlu Stadium", "Istanbul Derby", 9),
    ("TUR", "Beşiktaş", "Galatasaray", "Tüpraş Stadyumu", "Istanbul Derby", 9),
    ("TUR", "Trabzonspor", "Fenerbahçe", "Papara Park", None, 7),
    # Belgian Pro League
    ("BEL", "Club Brugge", "Anderlecht", "Jan Breydel Stadium", None, 8),
    ("BEL", "Anderlecht", "Standard Liège", "Lotto Park", "Le Clasico", 8),
    ("BEL", "Genk", "Club Brugge", "Cegeka Arena", None, 6),
    ("BEL", "Antwerp", "Club Brugge", "Bosuilstadion", None, 6),
    # Brasileirão
    ("BRA", "Flamengo", "Fluminense", "Maracanã", "Fla-Flu", 10),
    ("BRA", "Palmeiras", "Corinthians", "Allianz Parque", "Derby Paulista", 10),
    ("BRA", "São Paulo", "Santos", "MorumBIS", "San-São", 8),
    ("BRA", "Corinthians", "São Paulo", "Neo Química Arena", "Majestoso", 8),
    # Conference League
    ("UECL", "Fiorentina", "Real Betis", "Stadio Artemio Franchi", None, 7),
    ("UECL", "Crystal Palace", "Fiorentina", "Selhurst Park", None, 7),
    ("UECL", "AZ", "Crystal Palace", "AFAS Stadion", None, 5),
]

# Fixtures that have NOT been announced yet. The fixture feed publishes them one by one
# (simulating leagues releasing their schedules), each with a ticket sale shortly after.
UPCOMING_POOL = [
    ("LIGA", "Barcelona", "Real Madrid", "Spotify Camp Nou", "El Clásico", 10),
    ("EPL", "Liverpool", "Manchester United", "Anfield", "North-West Derby", 10),
    ("SA", "AC Milan", "Inter", "San Siro", "Derby della Madonnina", 10),
    ("BUN", "Borussia Dortmund", "Bayern Munich", "Signal Iduna Park", "Der Klassiker", 10),
    ("BRA", "Fluminense", "Flamengo", "Maracanã", "Fla-Flu", 10),
    ("L1", "Marseille", "Paris Saint-Germain", "Orange Vélodrome", "Le Classique", 10),
    ("TUR", "Fenerbahçe", "Galatasaray", "Şükrü Saracoğlu Stadium", "Kıtalararası Derbi", 10),
    ("UCL", "Barcelona", "Bayern Munich", "Spotify Camp Nou", None, 10),
    ("EPL", "Tottenham", "Arsenal", "Tottenham Hotspur Stadium", "North London Derby", 10),
    ("POR", "Porto", "Benfica", "Estádio do Dragão", "O Clássico", 9),
    ("LIGA", "Real Madrid", "Atlético Madrid", "Santiago Bernabéu", "Madrid Derby", 9),
    ("ERE", "Feyenoord", "Ajax", "De Kuip", "De Klassieker", 9),
    ("SA", "Lazio", "Roma", "Stadio Olimpico", "Derby della Capitale", 9),
    ("ELC", "Sheffield United", "Sheffield Wednesday", "Bramall Lane", "Steel City Derby", 9),
    ("BRA", "Corinthians", "Palmeiras", "Neo Química Arena", "Derby Paulista", 10),
    ("EPL", "Manchester United", "Manchester City", "Old Trafford", "Manchester Derby", 9),
    ("UCL", "Manchester City", "Inter", "Etihad Stadium", None, 9),
    ("BEL", "Anderlecht", "Club Brugge", "Lotto Park", None, 8),
    ("SA", "Inter", "Juventus", "San Siro", "Derby d'Italia", 9),
    ("SCO", "Celtic", "Hearts", "Celtic Park", None, 7),
    ("BUN", "Bayern Munich", "Bayer Leverkusen", "Allianz Arena", None, 8),
    ("UEL", "Roma", "Tottenham", "Stadio Olimpico", None, 7),
    ("LIGA", "Valencia", "Barcelona", "Mestalla", None, 8),
    ("EPL", "Chelsea", "Liverpool", "Stamford Bridge", None, 9),
]
POOL_KEYS = {(lid, home, away) for lid, home, away, *_ in UPCOMING_POOL}
UNPUBLISHED_SALE_MS = 10 * 365 * 86_400_000  # placeholder sale time far in the future

# Seconds from "now" at which each fixture's sale opens (cycled). Negative = already on sale.
SALE_OFFSETS_S = [-90, 20, 35, 50, 70, 90, 120, 150, 180, 240, 300, 420, 600, 900]


# stadium -> (city, country, capacity, IANA time zone)
STADIUMS: dict[str, tuple[str, str, int, str]] = {
    "Santiago Bernabéu": ("Madrid", "Spain", 83186, "Europe/Madrid"),
    "Metropolitano": ("Madrid", "Spain", 70460, "Europe/Madrid"),
    "Ramón Sánchez-Pizjuán": ("Seville", "Spain", 43883, "Europe/Madrid"),
    "Spotify Camp Nou": ("Barcelona", "Spain", 99354, "Europe/Madrid"),
    "Mestalla": ("Valencia", "Spain", 49430, "Europe/Madrid"),
    "Old Trafford": ("Manchester", "England", 74310, "Europe/London"),
    "Emirates Stadium": ("London", "England", 60704, "Europe/London"),
    "Etihad Stadium": ("Manchester", "England", 53400, "Europe/London"),
    "Anfield": ("Liverpool", "England", 61276, "Europe/London"),
    "Stamford Bridge": ("London", "England", 40343, "Europe/London"),
    "St James' Park": ("Newcastle upon Tyne", "England", 52305, "Europe/London"),
    "Villa Park": ("Birmingham", "England", 42640, "Europe/London"),
    "Tottenham Hotspur Stadium": ("London", "England", 62850, "Europe/London"),
    "San Siro": ("Milan", "Italy", 75817, "Europe/Rome"),
    "Allianz Stadium": ("Turin", "Italy", 41507, "Europe/Rome"),
    "Stadio Olimpico": ("Rome", "Italy", 70634, "Europe/Rome"),
    "Diego Armando Maradona": ("Naples", "Italy", 54726, "Europe/Rome"),
    "Gewiss Stadium": ("Bergamo", "Italy", 24950, "Europe/Rome"),
    "Allianz Arena": ("Munich", "Germany", 75024, "Europe/Berlin"),
    "Signal Iduna Park": ("Dortmund", "Germany", 81365, "Europe/Berlin"),
    "BayArena": ("Leverkusen", "Germany", 30210, "Europe/Berlin"),
    "Red Bull Arena": ("Leipzig", "Germany", 47069, "Europe/Berlin"),
    "Deutsche Bank Park": ("Frankfurt", "Germany", 58000, "Europe/Berlin"),
    "Parc des Princes": ("Paris", "France", 47929, "Europe/Paris"),
    "Groupama Stadium": ("Lyon", "France", 59186, "Europe/Paris"),
    "Stade Louis II": ("Monaco", "Monaco", 18523, "Europe/Monaco"),
    "Stade Pierre-Mauroy": ("Lille", "France", 50186, "Europe/Paris"),
    "Orange Vélodrome": ("Marseille", "France", 67394, "Europe/Paris"),
    "Johan Cruijff ArenA": ("Amsterdam", "Netherlands", 55865, "Europe/Amsterdam"),
    "Philips Stadion": ("Eindhoven", "Netherlands", 35000, "Europe/Amsterdam"),
    "De Kuip": ("Rotterdam", "Netherlands", 47500, "Europe/Amsterdam"),
    "AFAS Stadion": ("Alkmaar", "Netherlands", 19478, "Europe/Amsterdam"),
    "Estádio da Luz": ("Lisbon", "Portugal", 64642, "Europe/Lisbon"),
    "Estádio José Alvalade": ("Lisbon", "Portugal", 50095, "Europe/Lisbon"),
    "Estádio do Dragão": ("Porto", "Portugal", 50033, "Europe/Lisbon"),
    "Estádio Municipal de Braga": ("Braga", "Portugal", 30286, "Europe/Lisbon"),
    "Hillsborough": ("Sheffield", "England", 39732, "Europe/London"),
    "Bramall Lane": ("Sheffield", "England", 32050, "Europe/London"),
    "Carrow Road": ("Norwich", "England", 27359, "Europe/London"),
    "King Power Stadium": ("Leicester", "England", 32259, "Europe/London"),
    "Riverside Stadium": ("Middlesbrough", "England", 34742, "Europe/London"),
    "Selhurst Park": ("London", "England", 25486, "Europe/London"),
    "Celtic Park": ("Glasgow", "Scotland", 60411, "Europe/London"),
    "Ibrox Stadium": ("Glasgow", "Scotland", 50817, "Europe/London"),
    "Tynecastle Park": ("Edinburgh", "Scotland", 19852, "Europe/London"),
    "Pittodrie Stadium": ("Aberdeen", "Scotland", 20866, "Europe/London"),
    "RAMS Park": ("Istanbul", "Turkey", 52223, "Europe/Istanbul"),
    "Şükrü Saracoğlu Stadium": ("Istanbul", "Turkey", 47430, "Europe/Istanbul"),
    "Tüpraş Stadyumu": ("Istanbul", "Turkey", 42590, "Europe/Istanbul"),
    "Papara Park": ("Trabzon", "Turkey", 40782, "Europe/Istanbul"),
    "Jan Breydel Stadium": ("Bruges", "Belgium", 29062, "Europe/Brussels"),
    "Lotto Park": ("Brussels", "Belgium", 22500, "Europe/Brussels"),
    "Cegeka Arena": ("Genk", "Belgium", 23718, "Europe/Brussels"),
    "Bosuilstadion": ("Antwerp", "Belgium", 16144, "Europe/Brussels"),
    "Maracanã": ("Rio de Janeiro", "Brazil", 78838, "America/Sao_Paulo"),
    "Allianz Parque": ("São Paulo", "Brazil", 43713, "America/Sao_Paulo"),
    "MorumBIS": ("São Paulo", "Brazil", 66795, "America/Sao_Paulo"),
    "Neo Química Arena": ("São Paulo", "Brazil", 49205, "America/Sao_Paulo"),
    "Stadio Artemio Franchi": ("Florence", "Italy", 43147, "Europe/Rome"),
    # Home grounds of clubs that only appear as visitors in the catalogue (used for user-added fixtures)
    "Estadio Benito Villamarín": ("Seville", "Spain", 60721, "Europe/Madrid"),
    "San Mamés": ("Bilbao", "Spain", 53289, "Europe/Madrid"),
    "Estadio de la Cerámica": ("Villarreal", "Spain", 23500, "Europe/Madrid"),
    "Hill Dickinson Stadium": ("Liverpool", "England", 52888, "Europe/London"),
    "Stadium of Light": ("Sunderland", "England", 48707, "Europe/London"),
    "Portman Road": ("Ipswich", "England", 29673, "Europe/London"),
    "The Hawthorns": ("West Bromwich", "England", 26850, "Europe/London"),
    "St Mary's Stadium": ("Southampton", "England", 32384, "Europe/London"),
    "Easter Road": ("Edinburgh", "Scotland", 20421, "Europe/London"),
    "Veltins-Arena": ("Gelsenkirchen", "Germany", 62271, "Europe/Berlin"),
    "Stade Geoffroy-Guichard": ("Saint-Étienne", "France", 41965, "Europe/Paris"),
    "Stade Bollaert-Delelis": ("Lens", "France", 38223, "Europe/Paris"),
    "De Grolsch Veste": ("Enschede", "Netherlands", 30205, "Europe/Amsterdam"),
    "Stade Maurice Dufrasne": ("Liège", "Belgium", 27670, "Europe/Brussels"),
    "Vila Belmiro": ("Santos", "Brazil", 16068, "America/Sao_Paulo"),
}

EXTRA_HOME_GROUNDS = {
    "Real Betis": "Estadio Benito Villamarín", "Athletic Club": "San Mamés", "Villarreal": "Estadio de la Cerámica",
    "Everton": "Hill Dickinson Stadium", "Sunderland": "Stadium of Light", "Ipswich": "Portman Road",
    "West Brom": "The Hawthorns", "Southampton": "St Mary's Stadium", "Hibernian": "Easter Road",
    "Schalke 04": "Veltins-Arena", "Saint-Étienne": "Stade Geoffroy-Guichard", "Lens": "Stade Bollaert-Delelis",
    "Twente": "De Grolsch Veste", "Standard Liège": "Stade Maurice Dufrasne", "Santos": "Vila Belmiro",
}


def team_directory() -> dict[str, dict]:
    """Every club in the catalogue with its home ground and competitions."""
    teams: dict[str, dict] = {}
    for lid, home, away, stadium, *_ in FIXTURES + UPCOMING_POOL:
        for name in (home, away):
            t = teams.setdefault(name, {"name": name, "stadium": "", "leagues": set()})
            t["leagues"].add(lid)
        if lid not in ("UCL", "UEL", "UECL") and not teams[home]["stadium"]:
            teams[home]["stadium"] = stadium
    for name, t in teams.items():
        t["stadium"] = t["stadium"] or EXTRA_HOME_GROUNDS.get(name, "")
        t["city"] = STADIUMS.get(t["stadium"], ("",))[0]
        t["leagues"] = sorted(t["leagues"])
    return teams


def _pair_info(home: str, away: str) -> tuple[str | None, int]:
    """Known rivalry name and demand for a pairing (either way round); otherwise team-based demand."""
    team_demand: dict[str, int] = {}
    for _lid, h, a, _st, famous, demand in FIXTURES + UPCOMING_POOL:
        if {h, a} == {home, away} and famous:
            return famous, demand
        for t in (h, a):
            team_demand[t] = max(team_demand.get(t, 0), demand)
    return None, max(5, round((team_demand.get(home, 6) + team_demand.get(away, 6)) / 2))


def create_user_match(db: Session, league_id: str, home: str, away: str, day: date, hhmm: str | None) -> tuple[Match, bool]:
    """Add a fixture the buyer knows about (e.g. announced by the club) with ticket sale date TBA.
    Returns (match, created)."""
    teams = team_directory()
    stadium = teams.get(home, {}).get("stadium") or EXTRA_HOME_GROUNDS.get(home, "")
    if not stadium or stadium not in STADIUMS:
        raise ValueError(f"Home ground of {home} is unknown")
    city, country, capacity, tz = STADIUMS[stadium]
    hour, minute = (int(hhmm[:2]), int(hhmm[3:])) if hhmm else (21, 0)
    kickoff = datetime.combine(day, time(hour, minute), tzinfo=ZoneInfo(tz))
    kickoff_ms = int(kickoff.timestamp() * 1000)

    same_day = db.scalars(select(Match).where(Match.league_id == league_id, Match.home_team == home, Match.away_team == away)).all()
    for m in same_day:
        if datetime.fromtimestamp(m.kickoff_ms / 1000, ZoneInfo(tz)).date() == day:
            return m, False

    famous, demand = _pair_info(home, away)
    now = now_ms()
    m = Match(
        league_id=league_id, home_team=home, away_team=away, stadium=stadium, famous_name=famous, demand=demand,
        city=city, country=country, capacity=capacity, timezone=tz, round_label="Added by you",
        kickoff_ms=kickoff_ms, kickoff_tbc=hhmm is None,
        published_at_ms=now, sale_date_tba=True, sale_opens_at_ms=now + UNPUBLISHED_SALE_MS, source="user",
        categories=[
            SeatCategory(code=z.code, name=z.name, stand=z.stand, sort_order=n, price_cents=_zone_price(z, demand),
                         description=z.description.replace("away supporters", f"{away} supporters"), capacity=0, available=0)
            for n, z in enumerate(ZONES)
        ],
    )
    db.add(m)
    db.flush()
    restock(db, m, random.Random())
    db.commit()
    return m, True


@dataclass(frozen=True)
class Zone:
    code: str
    name: str
    stand: str
    description: str
    price_multiplier: float
    capacity: tuple[int, int]


# Ordered best -> cheapest. Price depends on position: halfway line > wings > behind goal > upper corners.
ZONES = [
    Zone("VIP", "Hospitality · VIP Lounge", "vip",
         "Padded seat on the halfway line with lounge access, a three-course meal and drinks.", 5.0, (8, 25)),
    Zone("MC", "Main Stand · Centre", "main",
         "Halfway line, lower tier, beside the dugouts. The best overall view, and covered.", 2.4, (40, 90)),
    Zone("OC", "Opposite Stand · Centre", "opposite",
         "Halfway line facing the dugouts, at TV camera height. Excellent tactical view.", 2.0, (40, 90)),
    Zone("MW", "Main Stand · Wings", "main",
         "Between the halfway line and the corner flags. Covered, with a good angle on both boxes.", 1.6, (50, 110)),
    Zone("OW", "Opposite Stand · Wings", "opposite",
         "Side view towards each penalty area. Good value for a side-on view.", 1.35, (50, 110)),
    Zone("HE", "Home End · Behind Goal", "home_end",
         "Among the home supporters' groups. Standing atmosphere, flags and chants; limited view of the far goal.", 1.0, (60, 130)),
    Zone("AE", "Away End · Visitors", "away_end",
         "Reserved for away supporters. Segregated section; ID and club membership may be checked.", 0.95, (20, 60)),
    Zone("CU", "Corners · Upper Tier", "corner",
         "High, angled view of the whole pitch. The cheapest seats in the stadium.", 0.8, (60, 140)),
]
ZONE_CODES = {z.code for z in ZONES}
# By default, target every zone except hospitality (it costs ~5x a normal seat).
DEFAULT_ZONE_CODES = sorted(ZONE_CODES - {"VIP"})


def default_max_price(m: Match, codes: list[str]) -> int:
    prices = [c.price_cents for c in m.categories if c.code in codes]
    return max(prices) if prices else max(c.price_cents for c in m.categories)
BASE_PRICE_CENTS = 50_00

KICKOFF_SLOTS = [(15, 0), (17, 30), (18, 30), (20, 0), (21, 0)]


def _round_label(league_id: str, i: int) -> str:
    if league_id in ("UCL", "UEL", "UECL"):
        return f"League phase · Matchday {5 + i % 4}"
    return f"Matchday {12 + i % 22}"


def _zone_price(z: Zone, demand: int) -> int:
    return int(round(BASE_PRICE_CENTS * (1 + demand / 10) * z.price_multiplier / 500) * 500)  # nearest €5


def seed_if_empty(db: Session) -> None:
    """Idempotent: inserts any leagues/fixtures that are missing (safe on existing databases)."""
    known_leagues = set(db.scalars(select(League.id)))
    for i, (lid, name, country, flag) in enumerate(LEAGUES):
        if lid not in known_leagues:
            db.add(League(id=lid, name=name, country=country, flag=flag, sort_order=i))
    db.flush()
    known = {(m.league_id, m.home_team, m.away_team) for m in db.scalars(select(Match))}
    today = date.today()
    added = False
    for i, (lid, home, away, stadium, famous, demand) in enumerate(FIXTURES + UPCOMING_POOL):
        if (lid, home, away) in known:
            continue
        added = True
        published = (lid, home, away) not in POOL_KEYS
        city, country, capacity, tz = STADIUMS.get(stadium, ("", "", 0, "UTC"))
        hour, minute = KICKOFF_SLOTS[i % len(KICKOFF_SLOTS)]
        local = datetime.combine(today + timedelta(days=5 + (i * 7) % 60), time(hour, minute), tzinfo=ZoneInfo(tz))
        m = Match(
            league_id=lid,
            home_team=home,
            away_team=away,
            stadium=stadium,
            famous_name=famous,
            demand=demand,
            city=city,
            country=country,
            capacity=capacity,
            timezone=tz,
            round_label=_round_label(lid, i),
            kickoff_ms=int(local.timestamp() * 1000),
            sale_opens_at_ms=0,
            # The base catalogue was announced last week; feed fixtures are announced live.
            published_at_ms=now_ms() - 7 * 86_400_000 if published else None,
            categories=[
                SeatCategory(
                    code=z.code,
                    name=z.name,
                    stand=z.stand,
                    description=z.description.replace("away supporters", f"{away} supporters"),
                    sort_order=n,
                    price_cents=_zone_price(z, demand),
                    capacity=0,
                    available=0,
                )
                for n, z in enumerate(ZONES)
            ],
        )
        db.add(m)
    db.commit()
    if added:
        reset_schedule(db)


TEST_CARD = MockCardIn(number="4242424242424242", exp_month=12, exp_year=2030, cvc="123", name="Test Buyer")


