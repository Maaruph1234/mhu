-- DESTRUCTIVE & IRREVERSIBLE: deletes EVERY user, wallet record, transaction
-- and verification record. Run once in the Supabase SQL editor.
-- Skips any table that doesn't exist in your database.
-- Does NOT delete customers already created on Xpress Wallet's side.

do $$
declare
  t text;
begin
  foreach t in array array[
    'signup_otps', 'xpresswallet_webhook_events', 'xpresswallet_accounts',
    'korapay_accounts', 'payvessel_accounts', 'virtual_cards',
    'identity_verifications', 'esim_orders', 'flight_quotes', 'flight_orders',
    'tier3_verifications', 'transactions', 'users'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('truncate table public.%I restart identity cascade', t);
      raise notice 'cleared %', t;
    end if;
  end loop;
end $$;

delete from auth.users;

notify pgrst, 'reload schema';
