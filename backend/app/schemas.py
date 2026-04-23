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

    opens_in_seconds: int = Field(60, ge=5, le=30 * 86400)


class ProfileOut(ORM):
    full_name: str
    email: str
    fan_id: str
    gateway: str | None
    card_brand: str | None
    card_last4: str | None
    card_exp: str | None
    has_payment_method: bool
    favorite_leagues: list[str]
    fixture_alerts: Literal["all", "favorites", "off"]
    auto_preorder_favorites: bool
    auto_preorder_quantity: int


class PreferencesIn(BaseModel):
    fixture_alerts: Literal["all", "favorites", "off"] = "all"
    auto_preorder_favorites: bool = False
    auto_preorder_quantity: int = Field(2, ge=1)

    @field_validator("auto_preorder_quantity")
    @classmethod
    def _qty(cls, v: int) -> int:
        if v > settings.max_tickets_per_order:
            raise ValueError(f"max {settings.max_tickets_per_order} tickets per order")
        return v


class ScheduleOut(BaseModel):
    pending: int  # fixtures not announced yet
    next_publish_at_ms: int | None
    interval_s: float


class FavoritesIn(BaseModel):
    leagues: list[str] = Field(max_length=50)


class ProfileUpdate(BaseModel):
    full_name: str = Field("", max_length=120)
    email: str = Field("", max_length=254, pattern=r"^$|^[^@\s]+@[^@\s]+\.[^@\s]+$")
    fan_id: str = Field("", max_length=64)


class MockCardIn(BaseModel):
    number: str = Field(min_length=12, max_length=23)
    exp_month: int = Field(ge=1, le=12)
    exp_year: int = Field(ge=2000, le=2100)
    cvc: str = Field(pattern=r"^\d{3,4}$")
    name: str = Field("", max_length=120)


class PaymentMethodIn(BaseModel):
    """Exactly one of the two, depending on the active gateway."""

    mock_card: MockCardIn | None = None
    setup_intent_id: str | None = None


class SetupOut(BaseModel):
    gateway: str
    client_secret: str | None


class WatchCreate(BaseModel):
    match_ids: list[int] = Field(min_length=1, max_length=100)
    mode: WatchMode = "auto"
    strategy: Strategy = "best"
    quantity: int = Field(2, ge=1)
    max_price_cents: int | None = Field(None, gt=0)
    category_codes: list[str] | None = None

    @field_validator("quantity")
    @classmethod
    def _qty(cls, v: int) -> int:
        if v > settings.max_tickets_per_order:
            raise ValueError(f"max {settings.max_tickets_per_order} tickets per order")
        return v


class AttendeeIn(BaseModel):
    row: int = Field(ge=1)
    seat: int = Field(ge=1)
    name: str = Field("", max_length=80)


class AttendeesIn(BaseModel):
    attendees: list[AttendeeIn] = Field(max_length=6)


class WatchUpdate(BaseModel):
    mode: WatchMode | None = None
    strategy: Strategy | None = None
    exact_fallback: bool | None = None
    quantity: int | None = Field(None, ge=1)
    max_price_cents: int | None = Field(None, gt=0)
    category_codes: list[str] | None = None

    @field_validator("quantity")
    @classmethod
    def _qty(cls, v: int | None) -> int | None:
        if v is not None and v > settings.max_tickets_per_order:
            raise ValueError(f"max {settings.max_tickets_per_order} tickets per order")
        return v

