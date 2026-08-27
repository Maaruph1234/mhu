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
