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


def test_unannounced_fixtures_are_hidden_until_published(client):
    from app.models import Match
    from app.seed import UPCOMING_POOL

    visible = client.get("/api/matches").json()
    assert len(visible) == len(FIXTURES)  # pool is hidden
    sched = client.get("/api/schedule").json()
    assert sched["pending"] == len(UPCOMING_POOL)

    with SessionLocal() as db:  # peek at the next pending fixture (tests only)
        pending = db.query(Match).filter(Match.published_at_ms.is_(None)).order_by(Match.id).first()
        pending_id = pending.id
    assert client.post("/api/watches/quick-buy", json={"match_id": pending_id}).status_code == 404

    t0 = client.get("/api/config").json()["server_time_ms"]
    assert client.post("/api/demo/publish-next").json()["match_id"] == pending_id
    m = next(m for m in client.get("/api/matches").json() if m["id"] == pending_id)
    assert m["published_at_ms"] >= t0
    assert 60_000 <= m["sale_opens_at_ms"] - m["published_at_ms"] <= 180_000  # sale opens a few minutes later
    assert client.get("/api/schedule").json()["pending"] == len(UPCOMING_POOL) - 1

    # Pre-ordering right after announcement arms auto-buy for the sale opening.
    add_card(client)
    w = client.post("/api/watches/quick-buy", json={"match_id": pending_id}).json()
    assert w["mode"] == "auto" and "Pre-ordered" in w["message"]


def test_auto_preorder_for_favourite_leagues(client):
    from app.models import Match

    add_card(client)
    with SessionLocal() as db:
        nxt = db.query(Match).filter(Match.published_at_ms.is_(None)).order_by(Match.id).first()
        league, mid = nxt.league_id, nxt.id
    client.put("/api/profile/favorites", json={"leagues": [league]})
    r = client.put("/api/profile/preferences", json={"fixture_alerts": "favorites", "auto_preorder_favorites": True, "auto_preorder_quantity": 3})
    assert r.status_code == 200 and r.json()["auto_preorder_favorites"] is True
    assert client.put("/api/profile/preferences", json={"auto_preorder_quantity": 9}).status_code == 422

    client.post("/api/demo/publish-next")
    w = next(w for w in client.get("/api/watches").json() if w["match_id"] == mid)
    assert w["mode"] == "auto" and w["quantity"] == 3 and w["status"] in ("watching", "armed")
    client.put("/api/profile/preferences", json={"fixture_alerts": "all", "auto_preorder_favorites": False})
    client.put("/api/profile/favorites", json={"leagues": []})


def test_new_leagues_present(client):
    ids = {l["id"] for l in client.get("/api/leagues").json()}
    assert {"ELC", "SCO", "TUR", "BEL", "BRA", "UECL"} <= ids
    fla = client.get("/api/matches", params={"q": "Fla-Flu"}).json()[0]
    assert (fla["city"], fla["timezone"]) == ("Rio de Janeiro", "America/Sao_Paulo")


def test_purchase_assigns_seat_position(client):
    add_card(client)
    m = open_match(client)
    r = client.post("/api/watches/quick-buy", json={"match_id": m["id"], "quantity": 3, "category_codes": ["MW"]})
    o = _order(client, _wait(client, r.json()["id"])["order_id"])
    assert o["status"] == "paid" and o["category_code"] == "MW" and o["stand"] == "main"
    assert o["block"].startswith("1") and 1 <= o["row"] <= 30
    assert len(o["seats"]) == 3 and o["seats"] == list(range(o["seats"][0], o["seats"][0] + 3))  # adjacent
    assert o["gate"].startswith("Gate") and o["block_index"] in (0, 1)  # left or right wing


def _free_run(block, n):
    """First row with n adjacent free seats in a block detail payload."""
    spr = block["seats_per_row"]
    for r in range(block["rows"]):
        line = block["state"][r * spr:(r + 1) * spr]
        i = line.find("0" * n)
        if i >= 0:
            return r + 1, list(range(i + 1, i + 1 + n))
    raise AssertionError("no free run")


def test_buy_exact_seats(client):
    add_card(client)
    m = open_match(client)
    blocks = client.get(f"/api/matches/{m['id']}/seatmap").json()
    assert {b["zone_code"] for b in blocks} == {"VIP", "MC", "OC", "MW", "OW", "HE", "AE", "CU"}
    oc = next(b for b in blocks if b["zone_code"] == "OC" and b["free"] > 10)
    detail = client.get(f"/api/matches/{m['id']}/blocks/{oc['block']}").json()
    assert len(detail["state"]) == detail["rows"] * detail["seats_per_row"]
    row, seats = _free_run(detail, 2)

    r = client.post("/api/watches/quick-buy", json={"match_id": m["id"], "seats": {"block": oc["block"], "positions": [[row, s] for s in seats]}})
    assert r.status_code == 202, r.text
    w = _wait(client, r.json()["id"])
    o = _order(client, w["order_id"])
    assert (o["status"], o["block"], o["row"], o["seats"], o["category_code"]) == ("paid", oc["block"], row, seats, "OC")

    # The exact seats are now sold in the seat map...
    after = client.get(f"/api/matches/{m['id']}/blocks/{oc['block']}").json()
    spr = after["seats_per_row"]
    assert all(after["state"][(row - 1) * spr + s - 1] == "1" for s in seats)
    # ...so nobody (including a second order) can buy them again.
    m2 = client.post("/api/watches/quick-buy", json={"match_id": m["id"], "seats": {"block": oc["block"], "positions": [[row, s] for s in seats]}})
    assert m2.status_code in (409, 409)

