-- Adds a column to remember Payvessel's session_id for each bank payout,
-- needed by the new "status" action in payvessel-payout/index.ts (Transfer
-- Status endpoint accepts reference and/or session_id -- stored so both
-- can be sent). Existing rows just have it null; the status check still
-- works off reference alone for those.
--
-- Run this once in the Supabase SQL Editor.

alter table public.transactions add column if not exists payvessel_session_id text;
