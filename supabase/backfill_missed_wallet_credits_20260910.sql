-- One-off backfill for two inbound bank transfers that landed on
-- 2026-09-10 but weren't credited, because payvessel-webhook was checking
-- for a top-level "event" field that Payvessel's real reserved-account-
-- credit payload never actually sends (see payvessel-webhook/index.ts's
-- updated header comment). The function returned 200 both times (since
-- "no match" fell through to a generic ok response), so Payvessel
-- considers both deliveries successful and will NOT retry them --
-- this applies exactly what the now-fixed webhook would have done.
--
-- Safe to run more than once: guarded by the same reference-uniqueness
-- check the webhook itself uses.
--
-- Run this ONCE in the Supabase SQL Editor, then redeploy payvessel-webhook
-- so future transfers credit automatically.

do $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
  from public.payvessel_accounts
  where account_number = '6656640533';

  if v_user_id is null then
    raise notice 'No payvessel_accounts row for account 6656640533 -- nothing to backfill';
    return;
  end if;

  -- Transfer 1: N1,500 from MUHAMMAD HADI / PALMPAY_INNER
  if not exists (
    select 1 from public.transactions
    where reference = '100033260910015023040048824857PP'
  ) then
    insert into public.transactions (user_id, type, amount, status, reference, title, subtitle)
    values (
      v_user_id, 'fund_wallet', 1500, 'successful',
      '100033260910015023040048824857PP',
      'Wallet funded via bank transfer',
      'From MUHAMMAD HADI (PALMPAY_INNER)'
    );
    update public.users
    set wallet_balance = coalesce(wallet_balance, 0) + 1500
    where id = v_user_id;
  end if;

  -- Transfer 2: N100 from MA'ARUF YUSUF / OPay
  if not exists (
    select 1 from public.transactions
    where reference = '100004260910014650170836925109'
  ) then
    insert into public.transactions (user_id, type, amount, status, reference, title, subtitle)
    values (
      v_user_id, 'fund_wallet', 100, 'successful',
      '100004260910014650170836925109',
      'Wallet funded via bank transfer',
      'From MA''ARUF YUSUF (OPay)'
    );
    update public.users
    set wallet_balance = coalesce(wallet_balance, 0) + 100
    where id = v_user_id;
  end if;
end $$;
