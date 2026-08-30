-- MHU Global — additive schema for the WEBSITE on top of the REAL,
-- already-live production database (project "mhu-app", used by the
-- Flutter app). Run this in the SQL editor.
--
-- IMPORTANT: this does NOT create `users`, `transactions`, or `otp_codes`
-- — those already exist in production with their own real shape. This
-- file only adds what's genuinely new: the `transfer_funds` function
-- (rewritten to match the real `users.wallet_balance` column instead of a
-- separate wallets table) and the `xpresswallet_accounts` table for wallet
-- funding. It deliberately does NOT touch RLS on the existing
-- users/transactions/otp_codes tables — that's a live app you don't want
-- this website work to accidentally break; review that separately with
-- whoever manages the Flutter app's access patterns.
--
-- Real schema this was written against (public schema):
--   users         id, phone_number, display_name, email, wallet_balance,
--                 user_type, account_number, is_online, created_at, business_name
--   transactions  id, user_id, title, subtitle, amount, type, status,
--                 reference, created_at
--   otp_codes     id, phone, otp, expires_at, created_at
--   (plus dispatches, riders, invoices, chat_messages, notifications —
--   unrelated to the website, untouched here)

create extension if not exists "uuid-ossp";

-- Xpress Wallet (Providus Bank) virtual accounts — net new, no existing
-- table to conflict with. 1:1 with `users`.
create table if not exists public.xpresswallet_accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid unique not null references public.users(id) on delete cascade,
  xw_customer_id text not null,
  xw_wallet_id text not null,
  account_number text not null,
  account_name text not null,
  bank_name text not null,
  bank_code text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.xpresswallet_accounts enable row level security;

drop policy if exists "Users can view own xpresswallet account" on public.xpresswallet_accounts;
create policy "Users can view own xpresswallet account" on public.xpresswallet_accounts
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies on purpose — only the service_role key
-- (used inside the xpresswallet-create-wallet and xpresswallet-webhook edge
-- functions) can write to this table.

-- Korapay virtual bank accounts -- net new, no existing table to conflict
-- with. 1:1 with `users`. This is the ACTIVE wallet-funding integration;
-- xpresswallet_accounts above is left in place unused (see README.md).
create table if not exists public.korapay_accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid unique not null references public.users(id) on delete cascade,
  account_number text not null,
  account_name text not null,
  bank_name text not null,
  bank_code text not null,
  account_reference text unique not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.korapay_accounts enable row level security;

drop policy if exists "Users can view own korapay account" on public.korapay_accounts;
create policy "Users can view own korapay account" on public.korapay_accounts
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies on purpose — only the service_role key
-- (used inside the korapay-create-account and korapay-webhook edge
-- functions) can write to this table.

-- Payvessel virtual bank accounts -- replaces korapay_accounts as the
-- ACTIVE wallet-funding integration (Payvessel replaced Korapay). Same
-- shape/RLS policy as korapay_accounts above; korapay_accounts is left in
-- place unused rather than dropped, in case any historical rows need to be
-- referenced later.
create table if not exists public.payvessel_accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid unique not null references public.users(id) on delete cascade,
  account_number text not null,
  account_name text not null,
  bank_name text not null,
  bank_code text not null,
  tracking_reference text unique not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payvessel_accounts enable row level security;

drop policy if exists "Users can view own payvessel account" on public.payvessel_accounts;
create policy "Users can view own payvessel account" on public.payvessel_accounts
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies on purpose — only the service_role key
-- (used inside the payvessel-create-account and payvessel-webhook edge
-- functions) can write to this table.

-- Virtual USD debit cards (Payvessel Issuing) -- net new, no existing table
-- to conflict with. One user can hold more than one card (soft-capped at 3
-- non-terminated cards per user in the edge function, not enforced here),
-- so this is NOT unique on user_id like the funding-account tables above.
--
-- IMPORTANT data-isolation note: Payvessel's "List Cards" API returns EVERY
-- card issued under our single shared business account, across ALL MHU
-- Global users -- there is no per-customer filter on their side. This table
-- is what makes per-user isolation possible: the payvessel-cards edge
-- function always reads/writes through this table (scoped by
-- auth.uid() via RLS) and never exposes Payvessel's raw list-cards response
-- to a client. Never remove that indirection.
--
-- card_number and cvv are deliberately NOT columns here -- Payvessel's own
-- security guidance (docs.payvessel.com/virtual-cards/overview) is to never
-- persist those anywhere and only fetch them from Payvessel on demand, over
-- HTTPS, for the active viewing session. balance_usd is a cache updated
-- whenever the edge function or webhook touches a card; always treat a live
-- "get" call as the source of truth over this cached value.
create table if not exists public.virtual_cards (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  payvessel_card_id uuid unique not null,
  brand text not null,
  currency text not null default 'USD',
  card_name text,
  masked_pan text not null default '',
  status text not null default 'PENDING',
  balance_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists virtual_cards_user_id_idx on public.virtual_cards(user_id);

alter table public.virtual_cards enable row level security;

drop policy if exists "Users can view own virtual cards" on public.virtual_cards;
create policy "Users can view own virtual cards" on public.virtual_cards
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies on purpose -- only the service_role key
-- (used inside the payvessel-cards and payvessel-webhook edge functions)
-- can write to this table.

-- Extra identity document verifications (NIN, driver's license, voter's
-- card, international passport) via Payvessel's Identity Verification API.
-- Net new, no existing table to conflict with. Separate from the BVN check
-- done at signup (payvessel_accounts doesn't track that either) -- this is
-- purely a record of which OTHER documents a user has had verified, shown
-- back to them as a trust/KYC-completeness indicator. One row per
-- user+doc_type (re-verifying replaces the row rather than accumulating
-- duplicates).
--
-- doc_number is stored as returned/submitted (license/voter's/passport
-- numbers aren't as sensitive as a BVN and are needed to display "which
-- document is this"); a verified photo, if Payvessel returns one, is
-- deliberately NOT stored here -- there's no product need to keep it and
-- every unnecessary stored identity photo is one more thing to secure.
create table if not exists public.identity_verifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  doc_type text not null check (doc_type in ('nin', 'drivers_license', 'voters_card', 'passport')),
  doc_number text not null,
  verified_name text,
  status text not null default 'verified',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, doc_type)
);

alter table public.identity_verifications enable row level security;

drop policy if exists "Users can view own identity verifications" on public.identity_verifications;
create policy "Users can view own identity verifications" on public.identity_verifications
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies on purpose -- only the service_role key
-- (used inside the payvessel-identity edge function) can write to this
-- table.

-- eSIM data package orders (Payvessel VaaS eSIM API). Net new. Payvessel's
-- eSIM API has no business-wide "list all orders" endpoint the way cards
-- and flights do, but this table is still the source of truth for "which
-- orders belong to this user" -- the edge function never lets a user fetch
-- an order id it didn't create.
create table if not exists public.esim_orders (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  payvessel_order_id uuid unique not null,
  reference text not null,
  package_code text not null,
  package_name text not null,
  location text not null,
  amount_ngn numeric not null,
  status text not null default 'pending',
  qr_code_url text,
  iccid text,
  activation_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists esim_orders_user_id_idx on public.esim_orders(user_id);
alter table public.esim_orders enable row level security;

drop policy if exists "Users can view own esim orders" on public.esim_orders;
create policy "Users can view own esim orders" on public.esim_orders
  for select using (auth.uid() = user_id);

-- Flight quotes and orders (Payvessel VaaS Flight API). Net new.
-- IMPORTANT data-isolation note, same reasoning as `virtual_cards`:
-- Payvessel's "List Flight Orders" endpoint returns every order for our
-- shared business account across ALL users. flight_orders is what makes
-- per-user isolation possible -- the payvessel-flight edge function always
-- reads/writes through this table and never forwards that endpoint's raw
-- response to a client. flight_quotes exists so a quote's exact priced
-- total (fetched once, at quote-creation time) can be charged correctly at
-- order time without trusting a client-supplied amount, and so one user
-- can't complete an order against a quote_id created by a different user.
create table if not exists public.flight_quotes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  payvessel_quote_id uuid unique not null,
  currency_code text not null,
  total_amount numeric not null,
  route_summary text not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists flight_quotes_user_id_idx on public.flight_quotes(user_id);
alter table public.flight_quotes enable row level security;

drop policy if exists "Users can view own flight quotes" on public.flight_quotes;
create policy "Users can view own flight quotes" on public.flight_quotes
  for select using (auth.uid() = user_id);

create table if not exists public.flight_orders (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  payvessel_order_id uuid unique not null,
  merchant_reference text not null,
  route_summary text not null,
  amount_ngn numeric not null,
  status text not null default 'pending',
  passengers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists flight_orders_user_id_idx on public.flight_orders(user_id);
alter table public.flight_orders enable row level security;

drop policy if exists "Users can view own flight orders" on public.flight_orders;
create policy "Users can view own flight orders" on public.flight_orders
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies on any of the three tables above on
-- purpose -- only the service_role key (used inside payvessel-esim and
-- payvessel-flight) can write to them.

-- Phone numbers in the real `users` table (populated by the Flutter app)
-- aren't guaranteed to be in one consistent format -- some rows may have
-- "0801...", others "+234801...", others "234801...". Comparing raw
-- strings caused "Recipient not found" for real, valid numbers typed in a
-- different format than what's stored. This strips everything down to the
-- last 10 digits (the actual subscriber number, ignoring the leading 0 or
-- country code) so any common format matches.
create or replace function public.normalize_ng_phone(p text) returns text as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$ language sql immutable;

-- Wallet-to-wallet transfer, atomic. Rewritten to match the real schema:
-- balance lives on `users.wallet_balance` (no separate wallets table),
-- recipients are looked up by phone_number (format-normalized) or email
-- (there's no referral_code column), and the transaction row uses
-- title/subtitle rather than description/fee.
-- Call from the client with: supabase.rpc('transfer_funds', { p_identifier, p_amount, p_note })
create or replace function public.transfer_funds(p_identifier text, p_amount numeric, p_note text default null)
returns json as $$
declare
  sender_id uuid := auth.uid();
  recipient_id uuid;
  sender_balance numeric;
  ref text := 'TRF-' || extract(epoch from now())::bigint || '-' || floor(random() * 1000000)::text;
begin
  if sender_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid amount';
  end if;

  select id into recipient_id from public.users
    where (
      length(regexp_replace(coalesce(p_identifier, ''), '\D', '', 'g')) >= 7
      and public.normalize_ng_phone(phone_number) = public.normalize_ng_phone(p_identifier)
    )
    or email = p_identifier
    limit 1;

  if recipient_id is null then
    raise exception 'Recipient not found';
  end if;

  if recipient_id = sender_id then
    raise exception 'Cannot transfer to yourself';
  end if;

  select wallet_balance into sender_balance from public.users where id = sender_id for update;

  if sender_balance is null or sender_balance < p_amount then
    raise exception 'Insufficient balance';
  end if;

  update public.users set wallet_balance = wallet_balance - p_amount where id = sender_id;
  update public.users set wallet_balance = coalesce(wallet_balance, 0) + p_amount where id = recipient_id;

  insert into public.transactions (user_id, type, amount, status, reference, title, subtitle)
  values (sender_id, 'transfer_out', p_amount, 'successful', ref, 'Transfer sent', coalesce(p_note, 'Transfer to ' || p_identifier));

  insert into public.transactions (user_id, type, amount, status, reference, title, subtitle)
  values (recipient_id, 'transfer_in', p_amount, 'successful', ref || '-IN', 'Transfer received', coalesce(p_note, 'Transfer received'));

  return json_build_object('success', true, 'reference', ref);
end;
$$ language plpgsql security definer;
