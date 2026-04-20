-- CardSync Pro — Supabase schema
-- Run this in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/<project-ref>/sql/new

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Cards: one row per distinct card inventory entry
create table if not exists public.cards (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  game            text not null,
  "set"           text,
  condition       text,
  quantity        integer not null default 1 check (quantity >= 0),
  purchase_price  numeric(12, 2) not null default 0,
  current_value   numeric(12, 2) not null default 0,
  platform        text,
  date_purchased  date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists cards_game_idx       on public.cards (game);
create index if not exists cards_name_idx       on public.cards (name);
create index if not exists cards_platform_idx   on public.cards (platform);

-- Sales: one row per sale of a card
create table if not exists public.sales (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references public.cards(id) on delete cascade,
  sale_price  numeric(12, 2) not null,
  platform    text,
  sale_date   date not null default current_date,
  profit      numeric(12, 2) not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists sales_card_id_idx    on public.sales (card_id);
create index if not exists sales_sale_date_idx  on public.sales (sale_date);
create index if not exists sales_platform_idx   on public.sales (platform);

-- Keep updated_at fresh on cards
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();
