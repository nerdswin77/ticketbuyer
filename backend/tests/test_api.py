import time

from conftest import add_card, future_match, open_match

from app.db import SessionLocal
from app.seed import FIXTURES, LEAGUES, ensure_test_payment_method

TERMINAL = {"purchased", "failed", "requires_action"}


def _watch(c, match_id, **kw):
    body = {"match_ids": [match_id], "mode": "alert", "quantity": 2, **kw}
    r = c.post("/api/watches", json=body)
    assert r.status_code == 201, r.text
    return r.json()[0]


def _wait(c, watch_id, timeout=5.0):
    """Purchases run in the background; poll until the watch reaches a terminal state."""
    end = time.time() + timeout
    while time.time() < end:
        w = next(w for w in c.get("/api/watches").json() if w["id"] == watch_id)
        if w["status"] in TERMINAL:
            return w
        time.sleep(0.02)
    raise AssertionError(f"watch {watch_id} stuck in {w['status']}")


def _order(c, order_id):
    return next(o for o in c.get("/api/orders").json() if o["id"] == order_id)


def _buy(c, watch_id):
    t0 = time.perf_counter()
    r = c.post(f"/api/watches/{watch_id}/buy")
    elapsed = time.perf_counter() - t0
    assert r.status_code == 202, r.text
    assert elapsed < 0.5, "buy endpoint must not block"
    w = _wait(c, watch_id)
    return w, (_order(c, w["order_id"]) if w["order_id"] else None)


def _available(c, match_id, code):
    m = next(m for m in c.get("/api/matches").json() if m["id"] == match_id)
    return next(cat["available"] for cat in m["categories"] if cat["code"] == code)


def test_catalog(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert len(client.get("/api/leagues").json()) == len(LEAGUES)
    all_matches = client.get("/api/matches").json()
    assert len(all_matches) == len(FIXTURES)
    for lid, *_ in LEAGUES:  # every competition has several upcoming fixtures
        assert sum(m["league_id"] == lid for m in all_matches) >= 3, lid
    famous = client.get("/api/matches", params={"famous": True}).json()
    assert 0 < len(famous) < len(all_matches)
    epl = client.get("/api/matches", params=[("league", "EPL"), ("league", "SA")]).json()
    assert {m["league_id"] for m in epl} == {"EPL", "SA"}
    assert client.get("/api/matches", params={"q": "clásico"}).json()[0]["home_team"] == "Real Madrid"
    assert client.get("/api/config").json()["gateway"] == "mock"


def test_match_details_and_zone_pricing(client):
    m = client.get("/api/matches", params={"q": "clásico"}).json()[0]
    assert (m["city"], m["country"], m["timezone"]) == ("Madrid", "Spain", "Europe/Madrid")
    assert m["capacity"] > 80_000 and m["round_label"].startswith("Matchday")
    zones = m["categories"]
    assert [z["code"] for z in zones] == ["VIP", "MC", "OC", "MW", "OW", "HE", "AE", "CU"]
    prices = [z["price_cents"] for z in zones]
    assert prices == sorted(prices, reverse=True), "better position must never be cheaper"
    assert prices[0] >= 4 * prices[-1]  # hospitality vs upper corner
    assert all(z["description"] and z["stand"] for z in zones)
    assert "Barcelona supporters" in next(z for z in zones if z["code"] == "AE")["description"]

