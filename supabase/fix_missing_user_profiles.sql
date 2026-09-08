-- Fix: signups were creating an auth.users row but no matching public.users
-- row. The app tried to create that row itself right after signUp(), but at
-- that point there's no session yet (custom OTP confirmation is still
-- pending), so the write was silently blocked by RLS -- and the client code
-- swallowed the error instead of surfacing it. Symptom: "Profile not found"
-- (404) on Fund Wallet, no name/bank details anywhere on the account.
--
-- Run this whole file once in the Supabase SQL Editor.

-- 1. Auto-create a public.users row the moment a new auth.users row is
-- inserted, via SECURITY DEFINER so it runs regardless of RLS or whether
-- the client has a session yet. This is now the reliable source of truth --
-- the client-side upsert can stay as a harmless no-op fallback.
--
-- phone_number is NOT NULL *and* UNIQUE, so a placeholder
-- ('pending-<user id>') is used whenever there's no real phone, or when the
-- real phone is already claimed by another account (e.g. someone retried
-- signup with the same number across multiple broken attempts before this
-- fix existed -- confirmed this actually happened: a real number collided
-- across rows during the backfill below). The exception handler makes this
-- safe for every FUTURE signup too, not just the backfill -- without it, a
-- phone collision here would silently block the entire signup transaction.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.users (id, email, display_name, phone_number)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      coalesce(nullif(new.raw_user_meta_data->>'phone', ''), 'pending-' || new.id::text)
    )
    on conflict (id) do nothing;
  exception when unique_violation then
    -- That phone number is already on another account -- fall back to a
    -- placeholder instead of letting this block account creation.
    insert into public.users (id, email, display_name, phone_number)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      'pending-' || new.id::text
    )
    on conflict (id) do nothing;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 2. Backfill every existing account that's missing its profile row --
-- including the test account(s) that hit "Profile not found", and any
-- other real signups that quietly hit the same bug before this fix.
--
-- Several orphaned test accounts share the same real phone number (same
-- tester retrying signup multiple times before this was fixed), which
-- can't all hold the same UNIQUE phone_number value. Only the most recent
-- account per duplicated phone number keeps the real number; the older
-- duplicates get the placeholder instead. Also excludes any phone number
-- that's already sitting on an existing public.users row (e.g. inserted by
-- the trigger during earlier testing) -- without this check, the backfill
-- can still try to hand out a number that's already taken outside this
-- batch, which is exactly what happened on the previous run.
insert into public.users (id, email, display_name, phone_number)
select
  au.id,
  au.email,
  coalesce(au.raw_user_meta_data->>'full_name', ''),
  case
    when nullif(au.raw_user_meta_data->>'phone', '') is null then 'pending-' || au.id::text
    when au.raw_user_meta_data->>'phone' in (select phone_number from public.users) then 'pending-' || au.id::text
    when row_number() over (
      partition by au.raw_user_meta_data->>'phone'
      order by au.created_at desc
    ) = 1 then au.raw_user_meta_data->>'phone'
    else 'pending-' || au.id::text
  end as phone_number
from auth.users au
left join public.users pu on pu.id = au.id
where pu.id is null;
