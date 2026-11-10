from __future__ import annotations

import json
import time

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now_ms() -> int:
    return int(time.time() * 1000)


class League(Base):
    __tablename__ = "leagues"

    id: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    country: Mapped[str] = mapped_column(String(64))
    flag: Mapped[str] = mapped_column(String(16))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[str] = mapped_column(ForeignKey("leagues.id"), index=True)
    home_team: Mapped[str] = mapped_column(String(64))
    away_team: Mapped[str] = mapped_column(String(64))
    stadium: Mapped[str] = mapped_column(String(96))
    kickoff_ms: Mapped[int] = mapped_column(Integer)
    sale_opens_at_ms: Mapped[int] = mapped_column(Integer, index=True)
    famous_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    demand: Mapped[int] = mapped_column(Integer, default=5)
    city: Mapped[str] = mapped_column(String(64), default="")
    country: Mapped[str] = mapped_column(String(64), default="")
    capacity: Mapped[int] = mapped_column(Integer, default=0)
    timezone: Mapped[str] = mapped_column(String(48), default="UTC")
    round_label: Mapped[str] = mapped_column(String(48), default="")
    # When the fixture was announced. NULL = not published yet (hidden from buyers).
    published_at_ms: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # Ticket sale date not announced yet: buyers can still pre-order; sale_opens_at_ms is a far-future placeholder.
    sale_date_tba: Mapped[bool] = mapped_column(default=False)
    kickoff_tbc: Mapped[bool] = mapped_column(default=False)  # date known, kick-off time to be confirmed
    source: Mapped[str] = mapped_column(String(10), default="catalog")  # catalog | feed | user | import
    external_id: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True)  # e.g. "fd:498765"
    home_crest_url: Mapped[str | None] = mapped_column(String(256), nullable=True)
    away_crest_url: Mapped[str | None] = mapped_column(String(256), nullable=True)

    league: Mapped[League] = relationship()
    categories: Mapped[list[SeatCategory]] = relationship(
        back_populates="match", order_by="SeatCategory.sort_order", cascade="all, delete-orphan"
    )

    @property
    def label(self) -> str:
        return f"{self.home_team} v {self.away_team}"


class SeatCategory(Base):
    __tablename__ = "seat_categories"
    __table_args__ = (UniqueConstraint("match_id", "code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    code: Mapped[str] = mapped_column(String(4))
    name: Mapped[str] = mapped_column(String(64))
    # main | opposite | home_end | away_end | corner | vip  (used to draw the stadium map)
    stand: Mapped[str] = mapped_column(String(16), default="main")
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)  # 0 = best seats
    price_cents: Mapped[int] = mapped_column(Integer)
    capacity: Mapped[int] = mapped_column(Integer)
    available: Mapped[int] = mapped_column(Integer)

    match: Mapped[Match] = relationship(back_populates="categories")


class SeatBlock(Base):
    """One physical block of seats. `state` has one char per seat: '0' free, '1' sold/held."""

    __tablename__ = "seat_blocks"
    __table_args__ = (UniqueConstraint("match_id", "block"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("seat_categories.id"), index=True)
    block: Mapped[str] = mapped_column(String(8))
    block_index: Mapped[int] = mapped_column(Integer, default=0)
    rank: Mapped[int] = mapped_column(Integer, default=0)  # 0 = best block in its zone
    gate: Mapped[str] = mapped_column(String(64), default="")
    rows: Mapped[int] = mapped_column(Integer)
    seats_per_row: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(Text)

    @property
    def free(self) -> int:
        return self.state.count("0")


class BuyerProfile(Base):
    """Single local buyer. Card data never touches this DB - only gateway tokens."""

    __tablename__ = "buyer_profile"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(254), default="")
    fan_id: Mapped[str] = mapped_column(String(64), default="")
    gateway: Mapped[str | None] = mapped_column(String(16), nullable=True)
    customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payment_method_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    card_brand: Mapped[str | None] = mapped_column(String(24), nullable=True)
    card_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    card_exp: Mapped[str | None] = mapped_column(String(7), nullable=True)
    favorite_leagues_json: Mapped[str] = mapped_column(Text, default="[]")
    # New-fixture alerts: all | favorites | off
    fixture_alerts: Mapped[str] = mapped_column(String(10), default="all")
    # Automatically pre-order (auto-buy at sale opening) new fixtures in favourite leagues
    auto_preorder_favorites: Mapped[bool] = mapped_column(default=False)
    auto_preorder_quantity: Mapped[int] = mapped_column(Integer, default=2)

    @property
    def favorite_leagues(self) -> list[str]:
        return json.loads(self.favorite_leagues_json or "[]")

    @favorite_leagues.setter
    def favorite_leagues(self, ids: list[str]) -> None:
        self.favorite_leagues_json = json.dumps(ids)


class Watch(Base):
    __tablename__ = "watches"

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), unique=True)
    mode: Mapped[str] = mapped_column(String(8), default="auto")  # auto | alert
    quantity: Mapped[int] = mapped_column(Integer, default=2)
    max_price_cents: Mapped[int] = mapped_column(Integer)
    # best = most expensive/best-positioned zone within budget first; cheapest = lowest price first
    strategy: Mapped[str] = mapped_column(String(10), default="best")
    # Exact seat choice (optional). When set, the engine tries these exact seats first.
    exact_block: Mapped[str | None] = mapped_column(String(8), nullable=True)
    exact_row: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exact_seats_csv: Mapped[str] = mapped_column(String(64), default="")
    exact_fallback: Mapped[bool] = mapped_column(default=False)  # if taken: best seats in same zone
    category_codes_json: Mapped[str] = mapped_column(Text, default="[]")
    # watching | armed | sale_open | purchasing | requires_action | purchased | failed
    status: Mapped[str] = mapped_column(String(20), default="watching")
    message: Mapped[str] = mapped_column(Text, default="")
    order_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at_ms: Mapped[int] = mapped_column(Integer, default=now_ms)

    match: Mapped[Match] = relationship()

    @property
    def category_codes(self) -> list[str]:
        return json.loads(self.category_codes_json or "[]")

    @category_codes.setter
    def category_codes(self, codes: list[str]) -> None:
        self.category_codes_json = json.dumps(codes)

    @property
    def exact_positions(self) -> list[tuple[int, int]]:
        """Chosen seats as (row, seat); stored as 'row:seat,row:seat'."""
        out = []
        for part in self.exact_seats_csv.split(","):
            if ":" in part:
                r, s = part.split(":")
                out.append((int(r), int(s)))
        return out


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    watch_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"))
    category_id: Mapped[int] = mapped_column(ForeignKey("seat_categories.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price_cents: Mapped[int] = mapped_column(Integer)
    total_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    # pending | requires_action | paid | failed | refunded
    status: Mapped[str] = mapped_column(String(20), default="pending")
    gateway: Mapped[str] = mapped_column(String(16))
    payment_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    payment_method_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    client_secret: Mapped[str | None] = mapped_column(String(128), nullable=True)
    failure_reason: Mapped[str] = mapped_column(Text, default="")
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    trigger: Mapped[str] = mapped_column(String(8), default="auto")
    # Assigned seats (set when the hold is taken)
    block: Mapped[str] = mapped_column(String(8), default="")
    row: Mapped[int] = mapped_column(Integer, default=0)
    seats_csv: Mapped[str] = mapped_column(String(64), default="")  # 'row:seat,row:seat'
    # Ticket holder per seat: [{"row": 5, "seat": 11, "name": "Ana García"}]
    attendees_json: Mapped[str] = mapped_column(Text, default="[]")
    paid_at_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    @property
    def attendees(self) -> list[dict]:
        return json.loads(self.attendees_json or "[]")

    @property
    def positions(self) -> list[tuple[int, int]]:
        out = []
        for part in self.seats_csv.split(","):
            if ":" in part:
                r, s = part.split(":")
                out.append((int(r), int(s)))
        return out
    gate: Mapped[str] = mapped_column(String(64), default="")
    block_index: Mapped[int] = mapped_column(Integer, default=0)
    hold_expires_at_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at_ms: Mapped[int] = mapped_column(Integer, default=now_ms)
    updated_at_ms: Mapped[int] = mapped_column(Integer, default=now_ms, onupdate=now_ms)

    match: Mapped[Match] = relationship()
    category: Mapped[SeatCategory] = relationship()
