/**
 * Per-plan margin overrides for VTpass data bundles -- a flat ₦ amount
 * added on top of VTpass's own live price for specific variation codes.
 *
 * Why this is safe margin and not just inflating what VTpass charges us:
 * for a purchase that includes a variation_code (every data/TV purchase),
 * VTpass's own /pay docs say the `amount` field "will be ignored as the
 * variation code determine[s] the price" -- VTpass always bills this
 * business account its own real catalog price for that variation_code,
 * regardless of what `amount` we send. So bumping the price here only
 * changes what the CUSTOMER's wallet gets debited (via purchase() in
 * vtpass.ts, which sends amount: selectedPlan.price) -- the difference
 * between that and VTpass's real cost is pure profit, confirmed safe
 * against VTpass's documented behavior, not a guess.
 *
 * Keyed by VTpass's own variation_code (not by name/price -- names can be
 * ambiguous and a plan's live price can drift from what's in this file,
 * but the code is stable).
 */
export const DATA_PLAN_MARKUPS: Record<string, number> = {
  // MTN
  "mtn-1tb-110000": 20000, // MTN 1TB (1 Year)
  "mtn-400gb-50000": 10000, // MTN 400GB (3-Month Plan)
  "mtn-600gb-75000": 5000, // MTN 600GB (3-Months Plan)

  // Glo
  glo5000: 500, // Glo N5000 - 18.25GB - 30 days
  // Glo's own docs list TWO different ₦10,000 codes ("glo10000" = 50GB and
  // "glo-monthly-10000" = 46GB+4GB Night) -- marking up both so the +500
  // applies no matter which one is actually live.
  glo10000: 500,
  "glo-monthly-10000": 500,
  glo15000: 3000, // Glo N15000 - 93GB - 30 days
  glo20000: 3000, // Glo N20000 - 138GB - 30 days
  "glo-mega-60000": 7000, // Glo Mega 525GB
  // Glo's docs reuse the SAME code "glo-mega-75000" for both the 675GB/₦75k
  // plan and (by typo) the 1TB/₦100k plan -- keying the 1TB one by the
  // corrected code below. UNVERIFIED: confirm the real code on the live
  // Data page before trusting this actually lands on the 1TB plan and not
  // the 675GB one.
  "glo-mega-100000": 20000,

  // Airtel
  // Two ₦1,500 Airtel codes exist ("airt-1500" = 3GB/30d, "airt-1500-2" =
  // 6GB/7d "Binge") -- marking up both since it's unclear which one is live.
  "airt-1500": 100,
  "airt-1500-2": 100,
  "airt-10000": 1000, // Airtel ₦10,000 - 40GB - 30 Days
  "airt-15000": 1500, // Airtel ₦15,000 - 75GB - 30 Days

  // 9mobile
  "eti-110000": 5000, // 9mobile ₦110,000 - 120GB - 365 days
};

export function applyDataPlanMarkup(code: string, price: number): number {
  return price + (DATA_PLAN_MARKUPS[code] ?? 0);
}
