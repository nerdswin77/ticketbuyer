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

