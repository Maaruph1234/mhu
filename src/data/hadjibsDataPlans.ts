/**
 * Hadjibs Data's full data-plan catalog, transcribed directly from the
 * account's own live Pricing page (hadjibsdata.com.ng, More > Pricing,
 * logged in) on Oct 2026 -- NOT guessed. Hadjibs' public API has no
 * "list variations" endpoint the way VTpass does (see src/lib/vtpass.ts),
 * so this static list stands in for that live lookup; `id` is the real
 * numeric Plan Id their POST /api/data endpoint expects for the `plan`
 * param.
 *
 * No 9mobile rows exist here because Hadjibs' Pricing page has none --
 * data bundles aren't offered for that network yet (see the 9MOBILE guard
 * in supabase/functions/hadjibs-purchase/index.ts).
 *
 * Prices are Hadjibs' own "Subscriber" (base/default-tier) price -- the
 * app passes this straight through to the customer with no separate
 * markup step, matching how VTpass's price was always passed through
 * as-is elsewhere in this codebase.
 *
 * Re-scrape this list from the Pricing page every so often -- Hadjibs adds/
 * removes/reprices plans on their end with no notice and no API to detect
 * that automatically.
 */

export interface HadjibsDataPlan {
  id: string; // numeric Plan Id, as a string (matches VtpassVariation.code's type)
  network: "mtn" | "glo" | "airtel";
  name: string;
  price: number;
}

export const HADJIBS_DATA_PLANS: HadjibsDataPlan[] = [
  { id: "217", network: "mtn", name: "500MB (SME) (7 days)", price: 295 },
  { id: "219", network: "mtn", name: "1GB (SME) (7 days)", price: 440 },
  { id: "220", network: "mtn", name: "2GB (SME) (30 days)", price: 850 },
  { id: "221", network: "mtn", name: "3GB (SME) (30 days)", price: 1350 },
  { id: "222", network: "mtn", name: "5GB (SME) (30 days)", price: 1780 },
  { id: "223", network: "mtn", name: "150MB TikTok (Gifting) (1 day)", price: 100 },
  { id: "224", network: "mtn", name: "470MB Social (Gifting) (1 day)", price: 250 },
  { id: "225", network: "mtn", name: "2GB TikTok only (Gifting) (30 days)", price: 500 },
  { id: "226", network: "mtn", name: "20GB (Gifting) (7 days)", price: 5500 },
  { id: "228", network: "mtn", name: "1GB (Corporate) (30 days)", price: 550 },
  { id: "229", network: "mtn", name: "2GB (Corporate) (30 days)", price: 1200 },
  { id: "230", network: "mtn", name: "3GB (Corporate) (30 days)", price: 1650 },
  { id: "231", network: "mtn", name: "500MB (Corporate) (30 days)", price: 2700 },
  { id: "272", network: "mtn", name: "1GB (Corporate) (1 day)", price: 300 },
  { id: "273", network: "mtn", name: "2.5GB (Corporate) (1 day)", price: 650 },
  { id: "275", network: "mtn", name: "3.0GB (Corporate) (1 day)", price: 800 },
  { id: "276", network: "mtn", name: "2.0GB (Corporate) (1 day)", price: 600 },

  { id: "232", network: "airtel", name: "500MB (SME) (1 day)", price: 380 },
  { id: "233", network: "airtel", name: "1GB Social bundle (SME) (1 day)", price: 400 },
  { id: "234", network: "airtel", name: "1.5GB (SME) (1 day)", price: 500 },
  { id: "235", network: "airtel", name: "3GB (SME) (2 days)", price: 950 },
  { id: "237", network: "airtel", name: "500MB (Corporate) (30 days)", price: 510 },
  { id: "238", network: "airtel", name: "1GB (Corporate) (30 days)", price: 800 },
  { id: "239", network: "airtel", name: "2GB (Corporate) (30 days)", price: 1550 },
  { id: "240", network: "airtel", name: "3GB (Corporate) (30 days)", price: 2300 },
  { id: "241", network: "airtel", name: "10GB (Corporate) (30 days)", price: 4300 },
  { id: "251", network: "airtel", name: "1.5GB (Gifting) (1 day)", price: 520 },
  { id: "252", network: "airtel", name: "3.2GB (Gifting) (2 days)", price: 1200 },
  { id: "254", network: "airtel", name: "7GB (Gifting) (30 days)", price: 2500 },
  { id: "255", network: "airtel", name: "10GB (Gifting) (30 days)", price: 3500 },
  { id: "263", network: "airtel", name: "4.0GB (Corporate) (30 days)", price: 2750 },

  { id: "242", network: "glo", name: "1.5GB (SME) (1 day)", price: 350 },
  { id: "243", network: "glo", name: "2.5GB (SME) (2 days)", price: 600 },
  { id: "244", network: "glo", name: "750MB (SME) (1 day)", price: 250 },
  { id: "245", network: "glo", name: "500MB (Corporate) (30 days)", price: 300 },
  { id: "246", network: "glo", name: "1GB (Corporate) (30 days)", price: 500 },
  { id: "247", network: "glo", name: "2GB (Corporate) (30 days)", price: 950 },
  { id: "248", network: "glo", name: "3GB (Corporate) (30 days)", price: 1500 },
  { id: "249", network: "glo", name: "500MB (Corporate) (30 days)", price: 2500 },
  { id: "250", network: "glo", name: "10GB (Corporate) (30 days)", price: 4500 },
  { id: "256", network: "glo", name: "750MB (Gifting) (1 day)", price: 250 },
  { id: "257", network: "glo", name: "1.5GB (Gifting) (1 day)", price: 320 },
  { id: "258", network: "glo", name: "2.5GB (Gifting) (2 days)", price: 650 },
];
