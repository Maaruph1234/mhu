-- One-off backfill for a fourth inbound bank transfer that landed
-- successfully (confirmed via Payvessel's dashboard) but never triggered
-- payvessel-webhook -- same recurring delivery failure as the other three
-- backfilled transfers (see backfill_missed_wallet_credits_20260910.sql and
-- backfill_missed_wallet_credit_hadi_20260910.sql). Flagged to Payvessel
-- support separately; this just makes the customer whole in the meantime.
--
-- Landed on account 6698942497 (same account as the previous Hadi backfill).
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

  -- N2,000 from MUHAMMAD HADI / PALMPAY_INNER, 12 Sep 2026.
  -- Credited gross (1,980 settlement + 20 fee Payvessel kept).
  if not exists (
    select 1 from public.transactions
    where reference = 'B2237E908CFD4DB386B1DD7E38E3EB66'
  ) then
    insert into public.transactions (user_id, type, amount, status, reference, title, subtitle)
    values (
      v_user_id, 'fund_wallet', 2000, 'successful',
      'B2237E908CFD4DB386B1DD7E38E3EB66',
      'Wallet funded via bank transfer',
      'From MUHAMMAD HADI (PALMPAY_INNER)'
    );
    update public.users
    set wallet_balance = coalesce(wallet_balance, 0) + 2000
    where id = v_user_id;
  end if;
end $$;
