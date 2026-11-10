# KickOff Tickets

Ticket sale sniper for European football. You pick matches across leagues, set how many seats, which categories, and the most you'll pay. When the sale opens, the server buys the tickets and charges your saved card, with no click needed. Alert mode is also available: it beeps and shows a one-click **BUY NOW** button instead.

| Layer    | Stack |
|----------|-------|
| Frontend | React 18, TypeScript (strict), Vite |
| Backend  | Python 3.12, FastAPI, SQLAlchemy 2, Pydantic v2, WebSockets |
| Payments | Stripe (SetupIntents + off-session PaymentIntents + webhooks), or a built-in mock gateway |
| Tests    | pytest (API + purchase pipeline) |

## Quick start (Windows)

```powershell
.\start.ps1          # installs deps on first run, starts API :8000 and UI :5173
```

Or manually:

```powershell
# backend
cd backend
py -3.12 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\uvicorn app.main:app --port 8000

# frontend (second terminal)
cd frontend
npm install
npm run dev          # http://localhost:5173
```

API docs: http://localhost:8000/docs

## Using it

1. **Payment method:** in mock mode, a test **VISA •••• 4242** (always succeeds) is saved automatically at startup (`SEED_TEST_CARD=true`). To try other results, use **💳** in the header and pick a test card:
   | Card | Result |
   |---|---|
   | 4242 4242 4242 4242 | succeeds |
   | 4000 0000 0000 0002 | declined |
   | 4000 0000 0000 9995 | insufficient funds |
   | 4000 0025 0000 3155 | needs 3-D Secure (approve it in Orders) |
2. Upcoming matches are grouped **by league** and sorted by kickoff. Every card has a one-click button:
   - **⚡ Buy now** (sale open): the order starts in the background and the API answers in about 40 ms, with no waiting.
   - **⏱ Pre-order** (sale not open yet): queued on the server and fired automatically at T+0.

   You can also select several cards (or **Select all** for a league) and click **+ Watch selected** to fine-tune them in the watchlist.
3. For each watched match you can set the mode (⚡ auto or 🔔 alert), the number of tickets, the maximum price per ticket, and which categories you'll accept.
4. The engine arms itself 2 s before opening and fires at T+0. Results appear in the **Engine log** and **Orders**. Orders show the latency since opening.

**↻ Reset demo** moves every sale opening back to a few seconds or minutes in the future.

## Fixture announcements → pre-order → auto-buy

Real clubs publish fixtures first and open ticket sales later. The backend simulates this with a **fixture feed** (`services/fixtures.py`):

1. A pool of unannounced fixtures (`UPCOMING_POOL` in `seed.py`) stays hidden from buyers. One is announced every `FIXTURE_PUBLISH_INTERVAL_S` (45 s in the demo), and its ticket sale opens 1–3 minutes later.
2. Each announcement is pushed instantly over `/ws` (`fixture_published`). The UI then:
   - plays a sound and shows a desktop notification
   - shows a pop-up with a **Pre-order** button
   - adds the fixture to the **Just scheduled** strip
   - shows a **NEW** tag on its match card
3. **Pre-order** arms server-side auto-buy. The server buys the tickets the moment the sale opens and assigns your seats, even if the browser is closed.
4. **🔔 Alerts** settings:
   - alert for all competitions, favourite leagues only, or off
   - **auto pre-order new fixtures in favourite leagues**, with no click needed
   - "Announce next fixture now" for demos

API: `GET /api/schedule` (pending count and next announcement time), `PUT /api/profile/preferences`, `POST /api/demo/publish-next`.

## My tickets

**🎫 My tickets** (header) manages everything you've ordered or paid for:

| Tab | What you can do |
|---|---|
| My tickets | Upcoming paid tickets with zone, block, exact seats, gate and order details. Name each seat's holder (tickets are personal). **View ticket**, **Add to calendar** (`.ics` with seats and gate, 3-hour reminder), **Refund** (asks you to confirm). |
| Pre-orders | Orders waiting for the sale (TBA, countdown or armed): exact seats or zones, estimated cost. **Change seats**, turn the fallback to best adjacent seats on/off, **Cancel pre-order**. |
| Needs attention | Bank approvals (3-D Secure) and failed orders: **Approve**, **Re-arm**, **Choose other seats**, **Remove**. |
| History | Refunded, failed and past orders. |

API: `PUT /api/orders/{id}/attendees`, `GET /api/orders/{id}/calendar.ics`, `PATCH /api/watches/{id}` (`exact_fallback`), `DELETE /api/watches/{id}` (cancel pre-order).

Database upgrades now add new columns in place (`db.migrate_additive`), so your orders survive updates.

## Schedule page

**📅 Schedule** (header) lists every upcoming fixture for each competition, grouped by month and day. Each fixture shows its sale status (sale date TBA / on sale in mm:ss / on sale / sold out) and your order status. Click a match to open it on the exact-seat picker, pick seats one by one, and pre-order.

**Complete official schedules:** put a free football-data.org key in `backend/.env` as `FOOTBALL_DATA_API_KEY=...`. **Load official schedules** then imports every scheduled fixture for the Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie, Primeira Liga, Championship, Brasileirão and Champions League (`POST /api/schedule/import`). Imported fixtures start with sale date TBA, so you can pre-order seats for the whole season. Re-importing updates kick-off times that have moved.

