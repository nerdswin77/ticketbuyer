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

