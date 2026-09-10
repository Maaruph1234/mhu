-- Custom dual-channel signup verification OTP system.
--
-- Supabase Auth's own built-in "Confirm signup" token can only ever be
-- delivered through whichever single channel the project's email settings
-- are wired to (Resend, via custom SMTP, as of Sept 2026) -- there's no
-- supported way to also push that exact same token out over SMS. So this
-- decouples signup-code generation entirely from Supabase Auth: WE
-- generate the 8-digit code, hash it (bcrypt via pgcrypto, same pattern as
-- pin_schema.sql's transaction_pin_hash), and hand the plaintext to
-- whichever edge function call asked for it -- send-signup-otp then
-- delivers it via Resend (email) or SMSala (SMS), and "resend via the
-- other channel" is just calling send-signup-otp again with a different
-- channel. verify-signup-otp checks it and, on success, confirms the
-- underlying Supabase Auth user itself (email_confirm = true via the Admin
-- API) so normal signInWithPassword stops being blocked.
--
-- Deploy: run this file's contents in the Supabase SQL Editor (same method
-- used for pin_schema.sql / rider_application_schema.sql).

create extension if not exists pgcrypto;

create table if not exists public.signup_otps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  channel text not null check (channel in ('email', 'sms')),
  attempts int not null default 0,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists signup_otps_user_id_idx on public.signup_otps(user_id);

alter table public.signup_otps enable row level security;
-- No policies granted to anon/authenticated -- this table is only ever
-- touched by the two RPCs below, called from edge functions running with
-- the service role, which bypasses RLS entirely. Nothing else should read
-- or write it directly.

-- Generates a fresh 8-digit code for p_user_id, invalidates any earlier
-- still-open code for that user (so only the most recently sent code is
-- ever valid, no matter which channel it went out on), and returns the
-- PLAINTEXT code so the calling edge function can hand it to Resend or
-- SMSala. Only the bcrypt hash is ever persisted.
create or replace function public.create_signup_otp(p_user_id uuid, p_channel text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if p_channel not in ('email', 'sms') then
    raise exception 'Invalid channel: %', p_channel;
  end if;

  update public.signup_otps
    set consumed_at = now()
    where user_id = p_user_id and consumed_at is null;

  v_code := lpad(floor(random() * 100000000)::text, 8, '0');

  insert into public.signup_otps (user_id, code_hash, channel, expires_at)
  values (p_user_id, crypt(v_code, gen_salt('bf')), p_channel, now() + interval '10 minutes');

  return v_code;
end;
$$;

-- Checks p_code against the latest still-open code for p_user_id. Codes
-- expire after 10 minutes and lock out after 5 wrong attempts (the user
-- has to hit resend for a fresh one past that point, rather than being
-- able to brute-force 8 digits).
create or replace function public.verify_signup_otp(p_user_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select * into v_row
    from public.signup_otps
    where user_id = p_user_id and consumed_at is null
    order by created_at desc
    limit 1;

  if v_row is null or v_row.expires_at < now() or v_row.attempts >= 5 then
    return false;
  end if;

  if v_row.code_hash = crypt(p_code, v_row.code_hash) then
    update public.signup_otps set consumed_at = now() where id = v_row.id;
    return true;
  end if;

  update public.signup_otps set attempts = attempts + 1 where id = v_row.id;
  return false;
end;
$$;

-- Only ever called from edge functions using the service-role key -- never
-- exposed to anon/authenticated clients directly.
revoke all on function public.create_signup_otp(uuid, text) from public, anon, authenticated;
revoke all on function public.verify_signup_otp(uuid, text) from public, anon, authenticated;
grant execute on function public.create_signup_otp(uuid, text) to service_role;
grant execute on function public.verify_signup_otp(uuid, text) to service_role;

-- Same fix as fix_pin_pgcrypto_schema.sql: Supabase installs pgcrypto into
-- the `extensions` schema, not `public`, so a function declared with only
-- `set search_path = public` can't actually find gen_salt()/crypt() --
-- widen the search path so it does, wherever the extension landed.
alter function public.create_signup_otp(uuid, text) set search_path = public, extensions;
alter function public.verify_signup_otp(uuid, text) set search_path = public, extensions;
