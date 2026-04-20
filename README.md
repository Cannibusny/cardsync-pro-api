# CardSync Pro API

Backend REST API for CardSync Pro — a TCG (trading card game) inventory management app. Built with Node.js + Express and backed by Supabase (Postgres).

## Stack

- Node.js 18+
- Express 4
- `@supabase/supabase-js` (service role) for DB access
- Deployed on [Railway.app](https://railway.app)

## Database Schema

Two tables: `cards` and `sales`. See [`schema.sql`](./schema.sql).

### `cards`

| column           | type          |
| ---------------- | ------------- |
| id               | uuid (pk)     |
| name             | text          |
| game             | text          |
| set              | text          |
| condition        | text          |
| quantity         | integer       |
| purchase_price   | numeric(12,2) |
| current_value    | numeric(12,2) |
| platform         | text          |
| date_purchased   | date          |

### `sales`

| column      | type                            |
| ----------- | ------------------------------- |
| id          | uuid (pk)                       |
| card_id     | uuid (fk → cards.id, cascade)   |
| sale_price  | numeric(12,2)                   |
| platform    | text                            |
| sale_date   | date                            |
| profit      | numeric(12,2)                   |

## Setup

1. Create a Supabase project (or use an existing one).
2. Open the SQL Editor and run the contents of `schema.sql`.
3. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL` — your project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — service role key (Project Settings → API)
4. Install dependencies and start:

   ```bash
   npm install
   npm start
   ```

   The server listens on `PORT` (default `3000`).

## Endpoints

All endpoints return JSON. List endpoints support `?limit=`, `?offset=`, and a handful of filter params.

### Cards

| Method | Path              | Description                                                     |
| ------ | ----------------- | --------------------------------------------------------------- |
| GET    | `/api/cards`      | List cards. Filters: `game`, `platform`, `name` (ILIKE).        |
| GET    | `/api/cards/:id`  | Get one card.                                                   |
| POST   | `/api/cards`      | Create card. Required: `name`, `game`.                          |
| PATCH  | `/api/cards/:id`  | Partial update. Any card field.                                 |
| DELETE | `/api/cards/:id`  | Delete card (cascades to related sales).                        |

### Sales

| Method | Path              | Description                                                                  |
| ------ | ----------------- | ---------------------------------------------------------------------------- |
| GET    | `/api/sales`      | List sales. Filters: `card_id`, `platform`.                                  |
| GET    | `/api/sales/:id`  | Get one sale.                                                                |
| POST   | `/api/sales`      | Create sale. Required: `card_id`, `sale_price`. `profit` auto-computed.      |
| PATCH  | `/api/sales/:id`  | Partial update.                                                              |
| DELETE | `/api/sales/:id`  | Delete sale.                                                                 |

### Example

```bash
# Add a card
curl -X POST "$API/api/cards" -H 'content-type: application/json' -d '{
  "name": "Charizard",
  "game": "Pokemon",
  "set": "Base Set",
  "condition": "NM",
  "quantity": 1,
  "purchase_price": 250.00,
  "current_value": 400.00,
  "platform": "TCGplayer",
  "date_purchased": "2026-01-15"
}'

# Record a sale of it (profit auto-computed from purchase_price)
curl -X POST "$API/api/sales" -H 'content-type: application/json' -d '{
  "card_id": "<uuid>",
  "sale_price": 420.00,
  "platform": "eBay",
  "sale_date": "2026-04-10"
}'
```

## Deployment (Railway)

This repo includes a `railway.json` so Railway auto-detects the start command. After connecting the repo, set these env vars in the Railway service:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PORT` is provided by Railway automatically.
