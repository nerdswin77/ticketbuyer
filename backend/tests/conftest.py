import os
import tempfile
from pathlib import Path

import pytest

_tmp = Path(tempfile.mkdtemp()) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}"
os.environ["SIMULATE_RIVALS"] = "false"
os.environ["DEMO_RESET_ON_START"] = "false"  # the client fixture resets explicitly
os.environ["STRIPE_SECRET_KEY"] = ""
os.environ["FIXTURE_FEED_ENABLED"] = "false"  # tests publish fixtures explicitly

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as c:
        c.post("/api/demo/reset")
        for w in c.get("/api/watches").json():
            c.delete(f"/api/watches/{w['id']}")
        c.delete("/api/payment-methods")
        yield c


def add_card(c: TestClient, number: str = "4242424242424242") -> dict:
    assert c.post("/api/payment-methods/setup").status_code == 200
    r = c.post(
        "/api/payment-methods",
        json={"mock_card": {"number": number, "exp_month": 12, "exp_year": 2035, "cvc": "123", "name": "Test"}},
    )
    assert r.status_code == 200, r.text
    return r.json()


def open_match(c: TestClient) -> dict:
    cfg = c.get("/api/config").json()
    return next(m for m in c.get("/api/matches").json() if m["sale_opens_at_ms"] <= cfg["server_time_ms"])


def future_match(c: TestClient) -> dict:
    cfg = c.get("/api/config").json()
    return next(m for m in c.get("/api/matches").json() if m["sale_opens_at_ms"] > cfg["server_time_ms"] + 60_000)
