-- Lets Fund Wallet reuse the NIN a user already verified at signup, instead
-- of asking them to retype an 11-digit number they already provided.
-- Previously NIN was deliberately never stored anywhere (verified against
-- Payvessel just long enough to gate signup, then discarded) -- this is an
-- explicit policy change: NIN is now stored on the user's own profile row,
-- captured the same way full_name/phone already are (via auth.users
-- metadata, copied in by the on_auth_user_created trigger).
--
-- Run this once in the Supabase SQL Editor. Requires
-- fix_missing_user_profiles.sql to have been run first (this replaces that
-- file's handle_new_auth_user() function with a version that also copies
-- nin).

alter table public.users add column if not exists verified_nin text;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.users (id, email, display_name, phone_number, verified_nin)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      coalesce(nullif(new.raw_user_meta_data->>'phone', ''), 'pending-' || new.id::text),
      nullif(new.raw_user_meta_data->>'nin', '')
    )
    on conflict (id) do nothing;
  exception when unique_violation then
    -- That phone number is already on another account -- fall back to a
    -- placeholder instead of letting this block account creation.
    insert into public.users (id, email, display_name, phone_number, verified_nin)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      'pending-' || new.id::text,
      nullif(new.raw_user_meta_data->>'nin', '')
    )
    on conflict (id) do nothing;
  end;
  return new;
end;
$$;

-- Trigger itself is unchanged (still fires on auth.users insert), only the
-- function body above changed -- no need to drop/recreate it.
