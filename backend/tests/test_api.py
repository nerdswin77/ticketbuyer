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


def test_exact_seats_validation(client):
    m = future_match(client)
    blocks = client.get(f"/api/matches/{m['id']}/seatmap").json()
    b = blocks[0]
    bad = client.post("/api/watches/quick-buy", json={"match_id": m["id"], "seats": {"block": "ZZZ", "positions": [[1, 1]]}})
    assert bad.status_code == 422
    bad = client.post("/api/watches/quick-buy", json={"match_id": m["id"], "seats": {"block": b["block"], "positions": [[999, 1]]}})
    assert bad.status_code == 422
    detail = client.get(f"/api/matches/{m['id']}/blocks/{b['block']}").json()
    row, seats = _free_run(detail, 1)
    ok = client.post("/api/watches/quick-buy", json={"match_id": m["id"], "seats": {"block": b["block"], "positions": [[row, s] for s in seats]}, "exact_fallback": True})
    w = ok.json()
    assert ok.status_code == 202 and w["exact_block"] == b["block"] and w["exact_positions"] == [[row, s] for s in seats]
    assert w["exact_fallback"] is True and w["quantity"] == 1 and w["mode"] == "auto"


def test_add_match_preorder_exact_seats_then_sale_announced(client):
    """The core flow: a fixture not on sale (sale date TBA) → pick exact seats → pre-order → sale announced → bought."""
    add_card(client)
    teams = {t["name"]: t for t in client.get("/api/teams").json()}
    assert teams["Real Madrid"]["stadium"] == "Santiago Bernabéu"

    body = {"league_id": "LIGA", "home_team": "Real Madrid", "away_team": "Barcelona", "date": "2027-05-09", "time": "21:00"}
    r = client.post("/api/matches", json=body)
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["sale_date_tba"] and m["source"] == "user" and m["famous_name"] == "El Clásico"
    assert m["stadium"] == "Santiago Bernabéu" and m["timezone"] == "Europe/Madrid"
    assert client.post("/api/matches", json=body).status_code == 200  # duplicate returns the existing fixture
    assert any(x["id"] == m["id"] for x in client.get("/api/matches").json())

    # Pick exact seats now, months before the sale.
    blk = next(b for b in client.get(f"/api/matches/{m['id']}/seatmap").json() if b["zone_code"] == "MC")
    row, seats = _free_run(client.get(f"/api/matches/{m['id']}/blocks/{blk['block']}").json(), 3)
    w = client.post("/api/watches/quick-buy", json={"match_id": m["id"], "seats": {"block": blk["block"], "positions": [[row, s] for s in seats]}}).json()
    assert w["mode"] == "auto" and w["status"] == "watching" and "sale date" in w["message"] and w["quantity"] == 3

    # Club announces the sale; the engine fires at T+0 and buys exactly those seats.
    a = client.post(f"/api/matches/{m['id']}/announce-sale", json={"opens_in_seconds": 5}).json()
    assert a["sale_date_tba"] is False
    o = _order(client, _wait(client, w["id"], timeout=15)["order_id"])
    assert (o["status"], o["block"], o["row"], o["seats"]) == ("paid", blk["block"], row, seats)
    assert o["latency_ms"] < 1000


def test_add_match_validation(client):
    bad = {"league_id": "LIGA", "home_team": "Real Madrid", "away_team": "Real Madrid", "date": "2027-05-09"}
    assert client.post("/api/matches", json=bad).status_code == 422
    assert client.post("/api/matches", json={**bad, "away_team": "Nobody FC"}).status_code == 422
    assert client.post("/api/matches", json={**bad, "away_team": "Barcelona", "date": "2020-01-01"}).status_code == 422
    tbc = client.post("/api/matches", json={**bad, "away_team": "Sevilla", "date": "2027-03-14"}).json()
    assert tbc["kickoff_tbc"] is True


def test_all_seats_free_before_sale_and_pick_any_seats(client):
    add_card(client)
    body = {"league_id": "UCL", "home_team": "Real Madrid", "away_team": "Liverpool", "date": "2027-03-10", "time": "21:00"}
    r = client.post("/api/matches", json=body)
    assert r.status_code == 201
    m = r.json()
    blocks = client.get(f"/api/matches/{m['id']}/seatmap").json()
    assert all(b["free"] == b["rows"] * b["seats_per_row"] for b in blocks), "no seat may be sold before the sale"
    assert all(c["available"] == c["capacity"] > 0 for c in m["categories"])

    # Seats chosen one by one: not adjacent, different rows, same block.
    picks = [[1, 3], [1, 9], [4, 15], [7, 2]]
    w = client.post("/api/watches/quick-buy", json={"match_id": m["id"], "seats": {"block": "112", "positions": picks}}).json()
    assert w["quantity"] == 4 and w["exact_positions"] == picks
    client.post(f"/api/matches/{m['id']}/announce-sale", json={"opens_in_seconds": 5})
    o = _order(client, _wait(client, w["id"], timeout=15)["order_id"])
    assert o["status"] == "paid" and o["block"] == "112" and o["positions"] == picks and o["quantity"] == 4
    state = client.get(f"/api/matches/{m['id']}/blocks/112").json()
    spr = state["seats_per_row"]
    assert all(state["state"][(r - 1) * spr + s - 1] == "1" for r, s in picks)
    assert state["state"].count("1") >= 4


def test_schedule_import_from_football_data(client, monkeypatch):
    import httpx

    from app.config import settings
    from app.db import SessionLocal
    from app.services import fixture_import

    payload = {"matches": [
        {"id": 900001, "utcDate": "2027-05-09T19:00:00Z", "status": "TIMED", "matchday": 35,
         "homeTeam": {"id": 86, "shortName": "Real Madrid", "crest": "x"}, "awayTeam": {"id": 81, "shortName": "Barça", "crest": "y"}},
        {"id": 900002, "utcDate": "2027-05-16T17:00:00Z", "status": "SCHEDULED", "matchday": 36,
         "homeTeam": {"id": 4242, "shortName": "Elche", "crest": "https://crests.football-data.org/285.png"},
         "awayTeam": {"id": 81, "shortName": "Barça", "crest": "y"}},
    ]}
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"], seen["token"] = str(request.url), request.headers.get("X-Auth-Token")
        return httpx.Response(200, json=payload)

    monkeypatch.setattr(settings, "football_data_api_key", "test-key")
    with SessionLocal() as db:
        res = fixture_import.import_league(db, "LIGA", client=httpx.Client(transport=httpx.MockTransport(handler)))
        again = fixture_import.import_league(db, "LIGA", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert res == {"created": 2, "updated": 0} and again["created"] == 0
    assert "/competitions/PD/matches" in seen["url"] and seen["token"] == "test-key"

    ms = {(m["home_team"], m["away_team"]): m for m in client.get("/api/matches").json() if m["source"] == "import"}
    clasico = ms[("Real Madrid", "Barcelona")]  # mapped to our names (crests, stadium)
    assert clasico["stadium"] == "Santiago Bernabéu" and clasico["sale_date_tba"] and not clasico["kickoff_tbc"]
    assert clasico["famous_name"] == "El Clásico" and clasico["round_label"] == "Matchday 35"
    elche = ms[("Elche", "Barcelona")]  # unknown club keeps the API's name and crest
    assert elche["home_crest_url"].endswith("285.png") and elche["kickoff_tbc"]


def test_manage_paid_ticket_attendees_calendar_and_preorder(client):
    add_card(client)
    m = open_match(client)
    r = client.post("/api/watches/quick-buy", json={"match_id": m["id"], "quantity": 2, "category_codes": ["HE"]})
    o = _order(client, _wait(client, r.json()["id"])["order_id"])
    assert o["status"] == "paid" and o["paid_at_ms"] and o["attendees"] == []
    (r1, s1), (r2, s2) = o["positions"]

    upd = client.put(f"/api/orders/{o['id']}/attendees", json={"attendees": [{"row": r1, "seat": s1, "name": "  Ana García "}]})
    assert upd.status_code == 200
    assert upd.json()["attendees"] == [{"row": r1, "seat": s1, "name": "Ana García"}, {"row": r2, "seat": s2, "name": ""}]
    bad = client.put(f"/api/orders/{o['id']}/attendees", json={"attendees": [{"row": 99, "seat": 99, "name": "X"}]})
    assert bad.status_code == 422

    ics = client.get(f"/api/orders/{o['id']}/calendar.ics")
    assert ics.status_code == 200 and ics.headers["content-type"].startswith("text/calendar")
    assert "BEGIN:VEVENT" in ics.text and f"Block {o['block']}" in ics.text and m["stadium"].split()[0] in ics.text

    # Pre-order management: toggle fallback, then cancel.
    fut = future_match(client)
    blk = client.get(f"/api/matches/{fut['id']}/seatmap").json()[3]
    w = client.post("/api/watches/quick-buy", json={"match_id": fut["id"], "seats": {"block": blk["block"], "positions": [[2, 5]]}}).json()
    assert client.patch(f"/api/watches/{w['id']}", json={"exact_fallback": True}).json()["exact_fallback"] is True
    assert client.delete(f"/api/watches/{w['id']}").status_code == 204
    assert all(x["id"] != w["id"] for x in client.get("/api/watches").json())


def test_demo_reset_keeps_seats_of_paid_orders(client):
    add_card(client)
    m = open_match(client)
    r = client.post("/api/watches/quick-buy", json={"match_id": m["id"], "quantity": 2, "category_codes": ["OC"]})
    o = _order(client, _wait(client, r.json()["id"])["order_id"])
    assert o["status"] == "paid"

    client.post("/api/demo/reset")  # regenerates every seat map

    blk = client.get(f"/api/matches/{m['id']}/blocks/{o['block']}").json()
    spr = blk["seats_per_row"]
    assert all(blk["state"][(r - 1) * spr + s - 1] == "1" for r, s in o["positions"]), "paid seats must stay sold"
    again = client.post("/api/watches/quick-buy", json={"match_id": m["id"], "seats": {"block": o["block"], "positions": o["positions"]}})
    assert again.status_code == 409  # nobody can buy them a second time


def test_favorite_leagues(client):
    r = client.put("/api/profile/favorites", json={"leagues": ["LIGA", "BRA", "LIGA"]})
    assert r.status_code == 200 and r.json()["favorite_leagues"] == ["LIGA", "BRA"]
    assert client.get("/api/profile").json()["favorite_leagues"] == ["LIGA", "BRA"]
    assert client.put("/api/profile/favorites", json={"leagues": ["NOPE"]}).status_code == 422
    assert client.put("/api/profile/favorites", json={"leagues": []}).json()["favorite_leagues"] == []


def test_cheapest_strategy(client):
    add_card(client)
    m = open_match(client)
    r = client.post(
        "/api/watches/quick-buy",
        json={"match_id": m["id"], "quantity": 1, "strategy": "cheapest", "category_codes": ["MC", "HE", "CU"]},
    )
    assert r.status_code == 202
    w = _wait(client, r.json()["id"])
    assert w["strategy"] == "cheapest"
    assert _order(client, w["order_id"])["category_code"] == "CU"


def test_default_zones_exclude_hospitality(client):
    m = future_match(client)
    w = _watch(client, m["id"])
    assert "VIP" not in w["category_codes"] and len(w["category_codes"]) == 7
    assert w["max_price_cents"] == next(z["price_cents"] for z in m["categories"] if z["code"] == "MC")


def test_test_card_is_seeded(client):
    assert not client.get("/api/profile").json()["has_payment_method"]
    with SessionLocal() as db:
        assert ensure_test_payment_method(db) is True
        assert ensure_test_payment_method(db) is False  # idempotent
    p = client.get("/api/profile").json()
    assert p["has_payment_method"] and p["card_last4"] == "4242" and p["card_brand"] == "visa"


def test_buy_requires_payment_method(client):
    m = open_match(client)
    w, order = _buy(client, _watch(client, m["id"])["id"])
    assert order is None
    assert w["status"] == "failed"
    assert "payment method" in w["message"]


def test_successful_purchase_and_refund(client):
    add_card(client)
    m = open_match(client)
    wid = _watch(client, m["id"], category_codes=["MW", "MC"])["id"]
    before = _available(client, m["id"], "MC")

    w, order = _buy(client, wid)
    assert order["status"] == "paid"
    assert order["category_code"] == "MC"  # strategy "best": the better-positioned zone wins
    assert order["total_cents"] == order["unit_price_cents"] * 2
    assert w["status"] == "purchased"
    assert _available(client, m["id"], "MC") == before - 2

    assert client.post(f"/api/watches/{wid}/buy").status_code == 409  # cannot buy twice

    refunded = client.post(f"/api/orders/{order['id']}/refund").json()
    assert refunded["status"] == "refunded"
    assert _available(client, m["id"], "MC") == before


def test_quick_buy_from_match_card(client):
    add_card(client)
    m = open_match(client)
    r = client.post("/api/watches/quick-buy", json={"match_id": m["id"], "quantity": 3})
    assert r.status_code == 202, r.text
    w = _wait(client, r.json()["id"])
    order = _order(client, w["order_id"])
    assert order["status"] == "paid" and order["quantity"] == 3 and order["trigger"] == "manual"


def test_order_before_opening_becomes_preorder(client):
    add_card(client)
    m = future_match(client)
    r = client.post("/api/watches/quick-buy", json={"match_id": m["id"]})
    assert r.status_code == 202
    w = r.json()
    assert w["mode"] == "auto" and w["status"] == "watching"
    assert "Pre-ordered" in w["message"]


def test_declined_card_releases_seats(client):
    add_card(client, "4000000000000002")
    m = open_match(client)
    wid = _watch(client, m["id"], category_codes=["HE"])["id"]
    before = _available(client, m["id"], "HE")
    w, order = _buy(client, wid)
    assert order["status"] == "failed"
    assert "declined" in order["failure_reason"]
    assert w["status"] == "failed"
    assert _available(client, m["id"], "HE") == before


def test_3ds_then_confirm(client):
    add_card(client, "4000002500003155")
    m = open_match(client)
    w, order = _buy(client, _watch(client, m["id"])["id"])
    assert w["status"] == "requires_action"
    assert order["status"] == "requires_action" and order["client_secret"]
    assert client.post(f"/api/orders/{order['id']}/confirm").json()["status"] == "paid"
    assert client.get("/api/watches").json()[0]["status"] == "purchased"


def test_price_limit(client):
    add_card(client)
    m = open_match(client)
    w, order = _buy(client, _watch(client, m["id"], max_price_cents=100)["id"])
    assert order is None
    assert "price limit" in w["message"]


def test_validation_and_guards(client):
    m = future_match(client)
    assert client.post("/api/watches", json={"match_ids": [m["id"]], "quantity": 7}).status_code == 422
    assert client.post("/api/watches", json={"match_ids": [m["id"]], "category_codes": ["X9"]}).status_code == 422
    assert client.post("/api/watches/quick-buy", json={"match_id": 99999}).status_code == 404
    w = _watch(client, m["id"])
    assert client.post("/api/watches", json={"match_ids": [m["id"]]}).json() == []  # duplicate ignored
    upd = client.patch(f"/api/watches/{w['id']}", json={"mode": "auto", "quantity": 4}).json()
    assert upd["mode"] == "auto" and upd["quantity"] == 4
    bad_card = client.post(
        "/api/payment-methods",
        json={"mock_card": {"number": "4242424242424241", "exp_month": 1, "exp_year": 2035, "cvc": "123"}},
    )
    assert bad_card.status_code in (400, 409)
    assert client.delete(f"/api/watches/{w['id']}").status_code == 204
