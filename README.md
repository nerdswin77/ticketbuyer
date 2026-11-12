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

## About "buying from official sites"

Official club and league ticket sites have no public purchase API. Their terms forbid automated buying, and they actively block bots with queues, CAPTCHAs and account checks. This project does not build tools to get around those defences: doing so risks account and membership bans, and in the UK it is a criminal offence.

**Automatic purchase:** the engine buys automatically through the `TicketExchange` interface. That is where an **authorised** source plugs in, such as a ticketing partner or resale platform whose terms allow API purchases.

**Official sales:** the platform's role is to alert you the instant the sale opens, with your seat plan ready.

## Pre-order any fixture, even before the sale date is known

This is the platform's main flow.

1. **＋ Add a match** (match list toolbar): choose the competition, both teams, the date and, optionally, the kick-off time. The stadium, city, time zone, crests, rivalry name, seat map and prices are filled in automatically. The fixture starts with **sale date TBA**.
2. The match window opens on **🎯 Pick exact seats**:
   - choose the number of tickets
   - choose a zone and a block
   - click where you want to sit
   - **Pre-order these exact seats**
3. The order waits on the server. When the ticket sale is announced (`POST /api/matches/{id}/announce-sale`; in the demo, the "Opens in 1 min" buttons), every pre-order on that match is armed. At T+0 the server buys exactly your seats, without a click and even with the browser closed.

In production, step 3 would be triggered by an authorised ticketing provider's sale-date feed.

## Exact seats

Every stadium has seat-level inventory (`services/seating.py`). Each zone consists of real blocks (1xx main stand, 2xx home end, 3xx opposite stand, 4xx away end, 5xx upper corners, H* hospitality), and each block has rows × seats. Part of every block is pre-sold to members and season-ticket holders.

- **Pick exact seats** (match window → 🎯 tab, or link `#match-<id>/seats`):
  1. Choose a zone.
  2. Choose a block (each shows its free-seat count).
  3. Click seats in one row of the live seat grid (row 1 is nearest the pitch).
  4. Buy now, or pre-order for the sale opening.
- **No double selling:** the engine holds *exactly* those seats or nothing, so a seat can never be sold twice. Optionally, it can fall back to the best adjacent seats in the same zone.
- **Best available:** zone orders also receive real seats (best block, front-most row, adjacent, centred).
- **On the ticket:** the ticket view and the match window show your block highlighted on the stadium map and your seats in the block's seat grid.

API: `GET /api/matches/{id}/seatmap`, `GET /api/matches/{id}/blocks/{block}`, and `seats: {block, row, seats[]}` on `POST /api/watches/quick-buy`.

## Match details & seat pricing

Click any match card to open its details: competition and round, kickoff in the stadium's time zone and your own, venue, city and capacity, gate opening time, sale status, a directions link and ticket rules.

Each stadium has 8 zones, priced by position. Prices scale with how in-demand the match is.

| Zone | Position | Price vs. behind-goal |
|---|---|---|
| VIP | Hospitality on the halfway line | ×5 |
| MC / OC | Main / opposite stand, halfway line | ×2.4 / ×2.0 |
| MW / OW | Main / opposite stand, wings | ×1.6 / ×1.35 |
| HE | Home end, behind the goal | ×1.0 |
| AE | Away end (visiting supporters only) | ×0.95 |
| CU | Upper-tier corners | ×0.8 |

You choose zones on the interactive stadium map, along with your ticket count and a strategy: **best position first** or **cheapest first**. The engine then buys the first zone that matches, within your maximum price. New watches cover every zone except VIP by default.

Use the **All tickets / Available now / Opening soon** switch above the match list to filter by availability.

**Logos:** club and competition crests are in `frontend/public/logos`, downloaded from crests.football-data.org. They are trademarks of their owners. They're fine for a personal demo, but a public or commercial launch needs licensing.

## How the purchase pipeline works

```
sniper (asyncio task per watch)
  ├─ sleep until T-2s → status ARMED → 5 ms loop until T+0
  ├─ alert mode → status SALE_OPEN → WS "sale_open" → user clicks BUY NOW
  └─ auto mode  → execute_purchase()
        1. atomic seat hold   UPDATE … SET available = available - n WHERE available >= n
           (categories tried in your preference order, within your max price; retried until sold out or timeout)
        2. charge saved card off-session (idempotency key = order id)
        3. succeeded → PAID │ declined → seats released │ 3-D Secure → hold kept HOLD_SECONDS
        4. every state change is pushed to the UI over /ws
```

- The auto-buy runs on the **server**, so it fires even when the browser tab is closed.
- Countdowns use the **server clock**, adjusted for network round-trip time.
- A per-watch lock plus the atomic hold prevent double purchases.
- Abandoned 3-D Secure holds are released by a background sweeper.

## Stripe (test mode)

1. Put your test keys in `backend/.env` (copy `.env.example`): `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`.
2. Forward webhooks: `stripe listen --forward-to localhost:8000/api/payments/webhook`, then put the printed `whsec_…` value in `STRIPE_WEBHOOK_SECRET`.
3. Restart the API. The header shows **Stripe** and the card form switches to Stripe Elements, so card data never reaches this server.

## Project layout

```
backend/
  app/
    main.py            app, lifespan (seed, background tasks), /ws, demo reset
    config.py          env settings
    models.py          League, Match, SeatCategory, BuyerProfile, Watch, Order
    schemas.py         request/response models
    seed.py            leagues, fixtures, demo sale schedule
    api/               catalog · account (profile, cards) · watches · orders (+ Stripe webhook)
    services/
      exchange.py      TicketExchange interface + SimulatedExchange (rival buyers)
      payments.py      PaymentGateway interface + MockGateway + StripeGateway
      purchase.py      hold → charge → finalize, 3DS hold sweeper
      sniper.py        per-watch scheduler
  tests/               pytest suite
frontend/src/
  api.ts  types.ts  App.tsx
  hooks/               useTicketStore (reducer + WS events), useLiveEvents, useNow (server clock)
  components/          Header, Filters, MatchGrid, Watchlist, BuyNowBanner, OrdersTable, EventLog, PaymentModal, ProfileModal
```

## Tests

```powershell
cd backend; .venv\Scripts\python -m pytest -q
cd frontend; npm run build      # strict type-check + production build
```

## Real ticket sources

Fixtures, sale times and inventory come from `SimulatedExchange`. Official club and league sites don't offer public purchase APIs, and their terms forbid automated buying. In the UK, using software to get around ticket purchase limits is also a criminal offence. To sell real tickets, implement `TicketExchange` (`reserve`/`release`) on top of an **authorised** ticketing partner or reseller API. Nothing else needs to change.

## Production notes

The demo runs as a single local user. Before deploying for real users, add:

- authentication with per-user profiles and watches
- Postgres instead of SQLite
- a persistent job runner for the sniper if you run more than one API instance
- HTTPS
