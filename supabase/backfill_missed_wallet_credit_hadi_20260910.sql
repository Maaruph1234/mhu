-- One-off backfill for a third inbound bank transfer that landed on
-- 2026-09-10 but was never credited, because Payvessel's webhook was never
-- called for it at all (confirmed via Payvessel's own dashboard -- the
-- transfer shows SUCCESSFUL there, but there's no matching entry in
-- payvessel-webhook's logs the way the other two missed transfers had).
-- This is a delivery failure on Payvessel's side, not something the webhook
-- code could have caught -- flagged to Payvessel support separately.
--
-- Unlike backfill_missed_wallet_credits_20260910.sql (which targeted
-- account_number 6656640533), this transfer landed on account 6698942497 --
-- the account currently shown on the Fund Wallet screen -- so this looks up
-- by that account number rather than assuming it's the same one.
--
-- Safe to run more than once: guarded by the same reference-uniqueness
-- check the webhook itself uses.
--
-- Run this ONCE in the Supabase SQL Editor.

do $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
  from public.payvessel_accounts
  where account_number = '6698942497';

  if v_user_id is null then
    raise notice 'No payvessel_accounts row for account 6698942497 -- nothing to backfill';
    return;
  end if;

  -- N1,000 from MUHAMMAD HADI / PALMPAY_INNER, 10 Sep 2026, 4:00 AM.
  -- Credited gross (990 settlement + 10 fee Payvessel kept), matching how
  -- the other two backfilled transfers and the fixed webhook both handle it.
  if not exists (
    select 1 from public.transactions
    where reference = '8A8032482BD84D628CE0D1B3BD4E2BE8'
  ) then
    insert into public.transactions (user_id, type, amount, status, reference, title, subtitle)
    values (
      v_user_id, 'fund_wallet', 1000, 'successful',
      '8A8032482BD84D628CE0D1B3BD4E2BE8',
      'Wallet funded via bank transfer',
      'From MUHAMMAD HADI (PALMPAY_INNER)'
    );
    update public.users
    set wallet_balance = coalesce(wallet_balance, 0) + 1000
    where id = v_user_id;
  end if;
end $$;
