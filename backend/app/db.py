from collections.abc import Iterator

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

_is_sqlite = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record) -> None:  # pragma: no cover - driver hook
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


REQUIRED_COLUMNS = {
    "matches": {"city", "round_label", "timezone", "published_at_ms", "sale_date_tba", "kickoff_tbc", "source", "external_id"},
    "seat_categories": {"stand", "description", "sort_order"},
    "watches": {"strategy", "exact_block", "exact_fallback"},
    "orders": {"block", "seats_csv", "gate", "block_index"},
    "buyer_profile": {"favorite_leagues_json", "fixture_alerts", "auto_preorder_favorites"},
}


# Additive changes applied in place (no data loss): table -> [(column, SQL type + default)]
ADDITIVE_COLUMNS = {
    "orders": [("attendees_json", "TEXT NOT NULL DEFAULT '[]'"), ("paid_at_ms", "INTEGER")],
}


def migrate_additive() -> list[str]:
    """Add new nullable/defaulted columns to existing tables so user data survives upgrades."""
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    added: list[str] = []
    with engine.begin() as conn:
        for table, cols in ADDITIVE_COLUMNS.items():
            if table not in tables:
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols:
                if name not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
                    added.append(f"{table}.{name}")
    return added


def schema_is_outdated() -> bool:
    """True when an existing database predates the current models (demo DB: rebuilt, not migrated)."""
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    for table, cols in REQUIRED_COLUMNS.items():
        if table in tables and not cols <= {c["name"] for c in insp.get_columns(table)}:
            return True
    return False


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
