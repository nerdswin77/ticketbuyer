import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import settings
from .models import Order

WatchMode = Literal["auto", "alert"]
Strategy = Literal["best", "cheapest"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ConfigOut(BaseModel):
    gateway: Literal["mock", "stripe"]
    schedule_import_enabled: bool = False
    stripe_publishable_key: str | None
    currency: str
    max_tickets_per_order: int
    server_time_ms: int


class LeagueOut(ORM):
    id: str
    name: str
    country: str
    flag: str


class CategoryOut(ORM):
    id: int
    code: str
    name: str
    stand: str
    description: str
    sort_order: int
    price_cents: int
    capacity: int
    available: int


class MatchOut(ORM):
    id: int
    league_id: str
    home_team: str
    away_team: str
    stadium: str
    kickoff_ms: int
    sale_opens_at_ms: int
    famous_name: str | None
    demand: int
    city: str
    country: str
    capacity: int
    timezone: str
    round_label: str
    published_at_ms: int | None
    sale_date_tba: bool
    kickoff_tbc: bool
    source: str
    home_crest_url: str | None
    away_crest_url: str | None
    categories: list[CategoryOut]


class TeamOut(BaseModel):
    name: str
    stadium: str
    city: str
    leagues: list[str]


class MatchCreate(BaseModel):
    """A fixture the buyer knows about but the catalogue doesn't list yet."""

    league_id: str
    home_team: str = Field(min_length=2, max_length=64)
    away_team: str = Field(min_length=2, max_length=64)
    date: dt.date
    time: str | None = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")  # local stadium time; None = TBC


class SaleDateIn(BaseModel):
    """Demo: the club announces when the ticket sale opens."""

