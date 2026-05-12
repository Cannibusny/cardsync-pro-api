# CardSync Pro

Complete TCG retail platform for Electronic Valet Inc. — inventory, POS, customer database, reporting, and multi-user access for trading card game shops.

This repo is a monorepo:

- **Backend** at the repo root — Node.js + Express, Supabase (Postgres) via the service role.
- **Frontend** in [`web/`](./web) — React 18 + Vite + Tailwind + React Query + React Router + React Hook Form + Recharts.

A single Railway service runs the API and serves the built React bundle at `/`.

---

## Phase 1 features

| Area | Status | Notes |
| --- | --- | --- |
| Inventory CRUD with grading, conditions, locations | ✅ | PSA / BGS / CGC / SGC, NM→DMG + SEALED, multipliers per condition |
| Bulk CSV import | ✅ | Up to 5,000 rows / 10 MB. Tolerant column names. |
| TCGCSV nightly pricing refresh | ✅ | Free daily dumps from [tcgcsv.com](https://tcgcsv.com). 03:00 UTC by default. |
| Point of Sale (POS) | ✅ | Search-as-you-type, cart, tax, discounts, loyalty + store-credit redemption, void with inventory restore |
| Customer database (CRM) | ✅ | Profiles, store credit, loyalty points (1 pt / $; 100 pts = $5), transaction history |
| Reporting | ✅ | Daily / 7-day / 30-day / all-time sales; inventory value at cost/list/market; profit; top customers |
| Multi-user auth + RBAC | ✅ | Owner > Manager > Employee > View-Only. JWT in HttpOnly cookie + bcrypt. |
| Activity audit log | ✅ | Every mutation writes an `activity_logs` row (fire-and-forget) |

Phase 2 (trade-ins / buylist, e-commerce integrations, grading concierge, events, advanced analytics) is scheduled for after Phase 1 is live with real data.

---

## Local development

### One-time setup

```bash
# Backend
npm install

# Frontend
npm --prefix web install
```

### Environment

Copy `.env.example` to `.env` and fill in your Supabase URL + service role key:

```bash
cp .env.example .env
```

Then run the schema in Supabase: paste [`schema.sql`](./schema.sql) into the Supabase SQL editor (or `psql -f schema.sql`). The schema is idempotent (uses `CREATE TABLE IF NOT EXISTS`) and seeds a default owner row + sensible settings.

### Seed the first owner account

```bash
curl -X POST http://localhost:3000/api/auth/init \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@electronicvalet.com","name":"Owner","password":"strong-password"}'
```

The `init` endpoint is idempotent: it creates the first owner, or promotes the seeded `owner@cardsync.local` row.

### Run

Two terminals during development:

```bash
# Terminal 1 — API on :3000
npm run dev

# Terminal 2 — Vite dev server on :5173 (proxies /api → :3000)
npm --prefix web run dev
```

Open <http://localhost:5173>. The Vite dev server hot-reloads the frontend and forwards `/api/*` to the API.

### Production-mode local run

```bash
npm --prefix web run build
npm run start
# → http://localhost:3000 serves both the API and the built SPA
```

---

## API reference

All endpoints under `/api/*`. Auth is a JWT in the HttpOnly cookie `cardsync_session` (also accepted as `Authorization: Bearer …` for headless callers).

| Group | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/init` |
| Cards | `GET /api/cards`, `GET /api/cards/:id`, `POST /api/cards`, `PATCH /api/cards/:id`, `DELETE /api/cards/:id`, `POST /api/cards/:id/reprice`, `POST /api/cards/bulk-reprice` |
| Customers | `GET /api/customers`, `GET /api/customers/:id`, `POST /api/customers`, `PATCH /api/customers/:id`, `DELETE /api/customers/:id`, `POST /api/customers/:id/adjust-credit` |
| Transactions (POS) | `GET /api/transactions`, `GET /api/transactions/:id`, `POST /api/transactions`, `POST /api/transactions/:id/void` |
| Users (admin) | `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id`, `DELETE /api/users/:id` |
| Prices (TCGCSV) | `GET /api/prices?q=…`, `GET /api/prices/:tcgplayer_id`, `POST /api/prices/refresh`, `POST /api/prices/apply-to-card/:card_id` |
| Reports | `GET /api/reports/sales/daily?days=N`, `GET /api/reports/sales/summary`, `GET /api/reports/inventory/summary`, `GET /api/reports/inventory/low-stock`, `GET /api/reports/profit?days=N`, `GET /api/reports/customers/top` |
| Bulk upload | `POST /api/upload/cards` (multipart, field `file`) |

Roles required:

- **view_only** — read-only access to inventory and customers.
- **employee** — can ring up sales and edit inventory (cannot see cost/profit, cannot reprice).
- **manager** — full operational access; can void sales, adjust credit, delete records, and reprice.
- **owner** — manager + user administration.

---

## Pricing source

CardSync Pro reads market prices from [tcgcsv.com](https://tcgcsv.com) — free daily CSV dumps mirroring TCGplayer pricing. TCGplayer's own pricing API is deprecated to new clients, so this is the recommended public source for shops without an existing TCGplayer partnership.

Configure which categories to import via `TCGCSV_CATEGORIES` (comma-separated IDs):

| Category ID | Game |
| --- | --- |
| 3 | Pokémon |
| 1 | Magic: The Gathering |
| 2 | Yu-Gi-Oh! |
| 23 | One Piece |

The nightly refresh is controlled by `TCGCSV_REFRESH_CRON` (default `0 3 * * *` — 03:00 UTC daily).

Cached prices live in the `card_prices` table keyed by `tcgplayer_id`. Cards can be matched to a price record either by storing `cards.tcgplayer_id` or by manually copying market price via `POST /api/prices/apply-to-card/:card_id`.

---

## Deploying to Railway

1. **Connect** the GitHub repo to a Railway service.
2. Railway runs `npm install` (which also runs `npm --prefix web install --omit=dev`), then `npm run build` (which builds the React bundle to `web/dist`), then `npm run start`.
3. Set **Variables**:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET` (random 32+ chars)
   - `CORS_ORIGINS` (optional — only needed if you serve the frontend from a different origin)
   - `TCGCSV_CATEGORIES` (optional, defaults to `3,1,2,23`)
   - `TCGCSV_REFRESH_CRON` (optional, defaults to `0 3 * * *`)
4. Point a custom domain (e.g. `cardsync.electronicvalet.com`) at the Railway service. Railway provisions the SSL cert automatically.

---

## Repo layout

```
.
├── src/
│   ├── index.js              # Express bootstrap + scheduled jobs + static frontend
│   ├── supabase.js           # service-role client
│   ├── lib/                  # jwt, password, validate, errors
│   ├── middleware/           # auth (RBAC), activity-log
│   ├── routes/               # 8 route modules
│   └── services/
│       └── tcgcsv.js         # TCGCSV importer
├── web/                      # React frontend (Vite)
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── auth.jsx          # AuthProvider + role helpers
│       ├── api.js            # fetch helper
│       ├── components/Layout.jsx
│       └── pages/            # Login, Dashboard, Inventory, POS, Customers, Reports, Users, Settings
├── schema.sql                # full Phase 1 + Phase 2 schema
├── .env.example
└── package.json
```
