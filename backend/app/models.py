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

