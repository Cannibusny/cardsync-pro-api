-- CardSync Pro — Masterpiece Schema (Phase 1)
-- Run this in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/<project-ref>/sql/new
--
-- This schema is the Phase-1 foundation for a full TCG retail platform:
-- inventory, POS, customers, multi-user RBAC, activity logging, scheduled
-- TCGCSV price cache. Phase-2 tables (trade-ins, special orders, events,
-- grading submissions) are also created up-front so the data model is
-- forward-compatible.

create extension if not exists "pgcrypto";

-- =========================================================================
--   USERS (operators of the system: owner / manager / employee / view-only)
-- =========================================================================
create table if not exists public.users (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text not null unique,
  password_hash   text not null,
  role            text not null check (role in ('owner','manager','employee','view_only')),
  active          boolean not null default true,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists users_role_idx on public.users (role);

-- =========================================================================
--   CARDS / INVENTORY
-- =========================================================================
-- One row per distinct inventory entry (each grading/condition variant is its
-- own row so quantity, sell_price, and location can differ).
create table if not exists public.cards (
  id              uuid primary key default gen_random_uuid(),

  -- Identification
  name            text not null,
  game            text not null,           -- pokemon | magic | yugioh | onepiece | other
  card_set        text,
  number          text,                    -- collector number within set
  rarity          text,
  tcgplayer_id    bigint,                  -- key for joining to price cache (TCGCSV product id)

  -- Category / sub-product
  product_type    text not null default 'single' check (product_type in (
    'single','sealed','graded','supply','other'
  )),

  -- Condition & grading
  condition       text not null default 'NM' check (condition in (
    'NM','LP','MP','HP','DMG','SEALED'
  )),
  graded          boolean not null default false,
  grade_service   text,                    -- PSA | BGS | CGC | null
  grade           text,                    -- '10' | '9.5' | '9' | 'BGS 9.5 / 10-9-10-9' (freeform)
  cert_number     text,

  -- Quantity tracking
  quantity        integer not null default 1 check (quantity >= 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0),

  -- Money
  cost_basis      numeric(12, 2) not null default 0 check (cost_basis >= 0),
  sell_price      numeric(12, 2) not null default 0 check (sell_price >= 0),
  market_price    numeric(12, 2),          -- last TCGCSV market snapshot (set by /api/prices/refresh)

  -- Locations / metadata
  location        text,                    -- e.g. 'Showcase A / Bin 3'
  image_url       text,
  notes           text,

  -- Provenance
  source          text,                    -- distributor | buylist | manual | csv-import
  date_acquired   date,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists cards_game_idx          on public.cards (game);
create index if not exists cards_name_idx          on public.cards (lower(name));
create index if not exists cards_card_set_idx      on public.cards (card_set);
create index if not exists cards_product_type_idx  on public.cards (product_type);
create index if not exists cards_tcgplayer_id_idx  on public.cards (tcgplayer_id);
create index if not exists cards_location_idx      on public.cards (location);

-- =========================================================================
--   PRICE CACHE  (populated from TCGCSV nightly imports)
-- =========================================================================
create table if not exists public.card_prices (
  tcgplayer_id    bigint primary key,
  name            text,
  game            text,
  card_set        text,
  market_price    numeric(12, 2),
  low_price       numeric(12, 2),
  mid_price       numeric(12, 2),
  high_price      numeric(12, 2),
  direct_low_price numeric(12, 2),
  refreshed_at    timestamptz not null default now()
);

create index if not exists card_prices_name_idx     on public.card_prices (lower(name));
create index if not exists card_prices_game_idx     on public.card_prices (game);

-- =========================================================================
--   CUSTOMERS  (CRM)
-- =========================================================================
create table if not exists public.customers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text,
  phone           text,
  birthday        date,
  store_credit    numeric(12, 2) not null default 0 check (store_credit >= 0),
  loyalty_points  integer not null default 0 check (loyalty_points >= 0),
  preferences     jsonb,                   -- e.g. {"contact":"email","games":["pokemon"]}
  wishlist        jsonb,                   -- array of card identifiers
  notes           text,
  total_spent     numeric(12, 2) not null default 0,
  last_visit_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists customers_email_idx  on public.customers (lower(email));
create index if not exists customers_phone_idx  on public.customers (phone);

-- =========================================================================
--   TRANSACTIONS  (POS sales — replaces the legacy `sales` table)
-- =========================================================================
create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid references public.customers(id) on delete set null,
  user_id         uuid references public.users(id) on delete set null,  -- which operator rang it up

  -- Cart snapshot: array of {card_id, name, qty, unit_price, subtotal, discount}
  items           jsonb not null,

  subtotal        numeric(12, 2) not null check (subtotal >= 0),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  tax_rate        numeric(5, 4) not null default 0.0800,   -- NY 8 %
  tax_amount      numeric(12, 2) not null default 0,
  total           numeric(12, 2) not null check (total >= 0),

  payment_method  text not null check (payment_method in (
    'cash','credit','debit','store_credit','split','stripe','other'
  )),
  payment_details jsonb,                   -- e.g. {"cash_tendered":100,"change":3.42}
  stripe_payment_intent text,

  loyalty_points_earned integer not null default 0,
  loyalty_points_redeemed integer not null default 0,

  notes           text,
  voided          boolean not null default false,
  voided_at       timestamptz,
  voided_reason   text,

  created_at      timestamptz not null default now()
);

create index if not exists transactions_customer_idx     on public.transactions (customer_id);
create index if not exists transactions_user_idx         on public.transactions (user_id);
create index if not exists transactions_created_at_idx   on public.transactions (created_at);
create index if not exists transactions_payment_idx      on public.transactions (payment_method);

-- =========================================================================
--   TRADE-INS / BUYLIST  (Phase 2 wired up)
-- =========================================================================
create table if not exists public.trade_ins (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete restrict,
  user_id         uuid references public.users(id) on delete set null,
  cards           jsonb not null,          -- array of {name, set, condition, qty, market_price, buy_price}
  total_offer     numeric(12, 2) not null check (total_offer >= 0),
  payment_method  text not null check (payment_method in ('cash','store_credit')),
  store_credit_bonus numeric(12, 2) not null default 0,
  status          text not null default 'completed' check (status in (
    'pending','completed','declined'
  )),
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists trade_ins_customer_idx on public.trade_ins (customer_id);
create index if not exists trade_ins_created_idx  on public.trade_ins (created_at);

-- =========================================================================
--   SPECIAL ORDERS  (Phase 2 wired up)
-- =========================================================================
create table if not exists public.special_orders (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete restrict,
  card_name       text not null,
  card_set        text,
  game            text,
  quantity        integer not null default 1 check (quantity > 0),
  estimated_price numeric(12, 2),
  status          text not null default 'pending' check (status in (
    'pending','ordered','arrived','picked_up','cancelled'
  )),
  source          text,                    -- distributor name
  notes           text,
  created_at      timestamptz not null default now(),
  fulfilled_at    timestamptz
);

create index if not exists special_orders_customer_idx on public.special_orders (customer_id);
create index if not exists special_orders_status_idx   on public.special_orders (status);

-- =========================================================================
--   EVENTS  (Phase 2 wired up)
-- =========================================================================
create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  event_type      text not null,           -- pokemon-tournament | magic-draft | workshop | other
  event_date      timestamptz not null,
  entry_fee       numeric(10, 2) not null default 0,
  capacity        integer,
  participants    jsonb,                   -- [{name, email, paid, dropped?}]
  results         jsonb,                   -- {bracket, winners}
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists events_date_idx on public.events (event_date);

-- =========================================================================
--   GRADING SUBMISSIONS  (Phase 2 wired up — PSA / BGS / CGC concierge)
-- =========================================================================
create table if not exists public.grading_submissions (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete restrict,
  service         text not null check (service in ('PSA','BGS','CGC','SGC')),
  cards           jsonb not null,          -- array of {name, set, qty, est_grade, image_url, returned_grade?}
  status          text not null default 'received' check (status in (
    'received','submitted','grading','returned','delivered','cancelled'
  )),
  service_fee     numeric(10, 2) not null default 0,
  concierge_fee   numeric(10, 2) not null default 0,
  notes           text,
  submitted_at    timestamptz,
  returned_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists grading_submissions_customer_idx on public.grading_submissions (customer_id);
create index if not exists grading_submissions_status_idx   on public.grading_submissions (status);

-- =========================================================================
--   ACTIVITY LOG  (audit trail for every mutation by a logged-in operator)
-- =========================================================================
create table if not exists public.activity_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id) on delete set null,
  user_email      text,                    -- denormalized for forensics if user deleted
  action          text not null,           -- e.g. card.create, transaction.create, customer.update
  resource_type   text,                    -- card | customer | transaction | user | trade_in | ...
  resource_id     uuid,
  details         jsonb,
  ip_address      text,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index if not exists activity_logs_user_idx       on public.activity_logs (user_id);
create index if not exists activity_logs_resource_idx   on public.activity_logs (resource_type, resource_id);
create index if not exists activity_logs_created_idx    on public.activity_logs (created_at);

-- =========================================================================
--   SETTINGS  (key/value store for runtime configuration)
-- =========================================================================
create table if not exists public.settings (
  key             text primary key,
  value           jsonb not null,
  updated_at      timestamptz not null default now()
);

-- =========================================================================
--   TRIGGERS
-- =========================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at      on public.users;
drop trigger if exists cards_set_updated_at      on public.cards;
drop trigger if exists customers_set_updated_at  on public.customers;

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create trigger cards_set_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- =========================================================================
--   SEED  (default owner — change the password immediately after first login)
-- =========================================================================
-- Bcrypt hash below is for the password 'changeme' (cost 10).
-- The /api/auth/init endpoint will prompt to change it on first login.
insert into public.users (name, email, password_hash, role)
values (
  'CardSync Owner',
  'owner@cardsync.local',
  '$2b$10$gHTzN5lWk1HTyJYJyfvFXuQqVcsBNcQyM6KZ8tcjUVH8/8ChWnP82',
  'owner'
)
on conflict (email) do nothing;

insert into public.settings (key, value)
values
  ('default_tax_rate',      '0.0800'::jsonb),
  ('default_buy_percentage','0.60'::jsonb),     -- buylist offers 60 % of market by default
  ('store_credit_bonus',    '0.10'::jsonb),     -- +10 % when paid out as store credit
  ('loyalty_points_per_dollar', '1'::jsonb),
  ('loyalty_redemption_rate',   '0.05'::jsonb), -- 100 points = $5
  ('margin_multipliers', '{"pokemon":1.05,"magic":1.10,"yugioh":1.05,"onepiece":1.08,"graded":1.20,"sealed":1.05}'::jsonb)
on conflict (key) do nothing;
