-- MidWest Tees Affiliate Portal — schema
-- Run once against your Supabase project (SQL editor or `apply_migration`).

create extension if not exists "pgcrypto";

-- Affiliates roster ---------------------------------------------------
create table if not exists public.mw_affiliates (
  id               uuid primary key default gen_random_uuid(),
  tag              text unique not null,          -- goes in the link: ?utm_source=<tag>
  name             text not null,
  email            text,
  venmo            text,
  token            text unique not null,          -- private portal key
  commission_rate  numeric not null default 0.10, -- 0.10 = 10%
  status           text not null default 'active',-- active | paused
  created_at       timestamptz not null default now()
);

-- Payout ledger (one row per payment made) ----------------------------
-- "Money owed" = live Shopify commission  -  sum(payouts.amount).
-- Recording a payout here is what closes the double-pay gap.
create table if not exists public.mw_payouts (
  id            uuid primary key default gen_random_uuid(),
  affiliate_id  uuid not null references public.mw_affiliates(id) on delete cascade,
  amount        numeric not null,
  note          text,
  method        text default 'venmo',
  created_by    text,                              -- who marked it paid
  paid_at       timestamptz not null default now()
);

create index if not exists mw_payouts_affiliate_idx on public.mw_payouts(affiliate_id);

-- Optional: keep a log of helper conversations (handy for support) ----
create table if not exists public.mw_chat_logs (
  id            uuid primary key default gen_random_uuid(),
  affiliate_id  uuid references public.mw_affiliates(id) on delete set null,
  question      text,
  answer        text,
  created_at    timestamptz not null default now()
);

-- The server uses the SERVICE ROLE key and bypasses RLS.
-- These tables are never exposed to the public anon key, so keep RLS on
-- with no public policies (default-deny) once enabled:
alter table public.mw_affiliates enable row level security;
alter table public.mw_payouts    enable row level security;
alter table public.mw_chat_logs  enable row level security;
