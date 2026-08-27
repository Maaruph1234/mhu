import type { Profile } from "../types";

// Seed profile used only when there's no Supabase project configured yet
// (see src/lib/demoMode.ts). Not shown as "demo" anywhere in the UI — it's
// just the starting profile you're logged in as until real auth is wired up.
export const DEMO_PROFILE: Profile = {
  id: "local-user",
  display_name: "Aruf Ibrahim",
  email: "aruf@mhuglobal.app",
  phone_number: "08012345678",
  wallet_balance: 42500,
  user_type: "customer",
  account_number: null,
  is_online: true,
  business_name: null,
  created_at: new Date().toISOString(),
};
