/**
 * Sorts VTpass data-bundle variation names into billing-cycle/purpose
 * buckets so the Data page can show one category at a time instead of
 * every plan scrolling past at once. Mirrors buy_airtime_screen.dart's
 * _categorizeVariation exactly, so both apps group the same live VTpass
 * plans the same way.
 *
 * VTpass's variation list has no explicit category field, only a
 * plain-text name -- categories below are inferred from wording/duration
 * cross-checked live against vtpass.com/mtn-data's own plan names.
 *
 * "Best Offers" (data) / "Hot Offers" (TV) is the one exception: not
 * derivable from a plan's name (VTpass's own site doesn't expose a
 * "featured" flag either), so it's a hand-picked list matched against real
 * plan names -- see HIGHLIGHT_PATTERNS below. A plan on that list still
 * also shows up under its normal category tab too; the highlight is an
 * additional bucket, not an exclusive one.
 */
export type DataPlanCategory =
  | "Best Offers"
  | "Hot Offers"
  | "Daily"
  | "Weekly"
  | "Monthly"
  | "Yearly"
  | "Social"
  | "Broadband"
  | "XtraValue"
  | "Other";

export const DATA_CATEGORY_ORDER: DataPlanCategory[] = [
  "Best Offers",
  "Daily",
  "Weekly",
  "Monthly",
  "Yearly",
  "Social",
  "Broadband",
  "XtraValue",
  "Other",
];

// TV bouquets almost never carry duration wording, so this is mostly just
// "Hot Offers" plus a single "Other" bucket -- kept generic anyway in case
// a provider adds a plan whose name does carry duration wording.
export const TV_CATEGORY_ORDER: DataPlanCategory[] = [
  "Hot Offers",
  "Daily",
  "Weekly",
  "Monthly",
  "Yearly",
  "Social",
  "Broadband",
  "XtraValue",
  "Other",
];

// Hand-picked highlights, matched here against real VTpass variation names
// (data plans cross-checked against vtpass.com/mtn-data; DStv bouquet names
// confirmed live against vtpass.com's own DSTV Subscription API docs, e.g.
// "DStv Padi N1,850" / "DStv Yanga N2,565" / "Dstv Confam N4,615" /
// "DStv  Compact N7900" / "DStv Compact Plus N12,400"). Mirrors
// buy_airtime_screen.dart's _bestOfferPatterns/_hotOfferPatterns exactly.
//
// The DStv patterns use a negative lookahead to exclude ExtraView/Showmax/
// streaming/multi-bouquet add-on variations (e.g. "DStv Padi + ExtraView"),
// which all contain "+" -- only the five plain base bouquets the user
// hand-picked (Padi, Yanga, Confam, Compact, Compact Plus) should match.
const DSTV_HOT_OFFERS: { pattern: RegExp; image: string }[] = [
  { pattern: /^(?!.*(\+|extra|showmax|stream)).*\bpadi\b/i, image: "/tv/hot-offers/dstv-padi.png" },
  { pattern: /^(?!.*(\+|extra|showmax|stream)).*\byanga\b/i, image: "/tv/hot-offers/dstv-yanga.png" },
  { pattern: /^(?!.*(\+|extra|showmax|stream)).*\bconfam\b/i, image: "/tv/hot-offers/dstv-confam.png" },
  { pattern: /^(?!.*(\+|extra|showmax|stream|plus)).*\bcompact\b/i, image: "/tv/hot-offers/dstv-compact.png" },
  { pattern: /^(?!.*(\+|extra|showmax|stream)).*\bcompact\s*plus\b/i, image: "/tv/hot-offers/dstv-compact-plus.png" },
];

// Real GOtv promo images for the five paid bouquets (Smallie -- the
// cheapest tier -- has no promo image, so it just falls back to the plain
// price row like before). Variation names confirmed against VTpass's own
// GOTV Subscription API docs, e.g. "GOtv Supa - monthly N11,400" / "GOtv
// Supa Plus - monthly N15,700" -- same "Plus" disambiguation trick as
// DStv's Compact/Compact Plus above, since "Supa" alone would otherwise
// also match "Supa Plus".
const GOTV_HOT_OFFERS: { pattern: RegExp; image: string }[] = [
  { pattern: /^(?!.*plus).*\bsupa\b/i, image: "/tv/hot-offers/gotv-supa.png" },
  { pattern: /.*\bsupa\s*plus\b/i, image: "/tv/hot-offers/gotv-supa-plus.png" },
  { pattern: /\bjolli\b/i, image: "/tv/hot-offers/gotv-jolli.png" },
  { pattern: /\bjinja\b/i, image: "/tv/hot-offers/gotv-jinja.png" },
  { pattern: /\bmax\b/i, image: "/tv/hot-offers/gotv-max.png" },
];

// Real StarTimes promo images for three of its bouquets (Smart/Super have
// no promo image yet, so they fall back to the plain price row). VTpass's
// own variation names are just the bare package name ("Classic", "Nova",
// "Basic" -- e.g. "Nova - 900 Naira - 1 Month", confirmed against
// vtpass.com/documentation/startimes-subscription-api), with no "DTT"/"DTH"
// prefix -- that split is StarTimes' own marketing label for which
// receiver a bouquet needs, not part of the variation name VTpass returns.
// Nova/Basic each also have a "-weekly" variant with the same bouquet name,
// which intentionally still matches here too (same tier, shorter duration).
const STARTIMES_HOT_OFFERS: { pattern: RegExp; image: string }[] = [
  { pattern: /\bclassic\b/i, image: "/tv/hot-offers/startimes-classic.png" },
  { pattern: /\bnova\b/i, image: "/tv/hot-offers/startimes-nova.png" },
  { pattern: /\bbasic\b/i, image: "/tv/hot-offers/startimes-basic.png" },
];

const HIGHLIGHT_PATTERNS: Record<string, { label: DataPlanCategory; patterns: RegExp[] }> = {
  mtn: {
    label: "Best Offers",
    patterns: [
      /110\s*mb.*1\s*day/i,
      /1\s*gb\s*\+\s*1\.5\s*mins/i,
      /\b2gb\b.*\(?\s*2\s*days?\)?/i,
      /\b3\.2\s*gb\b.*2\s*days?/i,
      /\b20\s*gb\b.*weekly/i,
      /\b120\s*gb\b.*30\s*-?\s*days?/i,
    ],
  },
  dstv: {
    label: "Hot Offers",
    patterns: DSTV_HOT_OFFERS.map((o) => o.pattern),
  },
  gotv: {
    label: "Hot Offers",
    patterns: GOTV_HOT_OFFERS.map((o) => o.pattern),
  },
  startimes: {
    label: "Hot Offers",
    patterns: STARTIMES_HOT_OFFERS.map((o) => o.pattern),
  },
};

function highlightBucket(name: string, network: string): DataPlanCategory | null {
  const entry = HIGHLIGHT_PATTERNS[network];
  if (!entry) return null;
  return entry.patterns.some((p) => p.test(name)) ? entry.label : null;
}

// The user sent real DStv promo images for these five bouquets and asked
// for them to be used on the Hot Offers cards themselves (not just as a
// categorization signal) -- same pattern list as above, paired with the
// matching image so Tv.tsx can render an image-banner card instead of a
// plain price row whenever a Hot Offers plan has one.
export function getHotOfferImage(name: string, network: string): string | null {
  if (network === "dstv") {
    const hit = DSTV_HOT_OFFERS.find((o) => o.pattern.test(name));
    return hit ? hit.image : null;
  }
  if (network === "gotv") {
    const hit = GOTV_HOT_OFFERS.find((o) => o.pattern.test(name));
    return hit ? hit.image : null;
  }
  if (network === "startimes") {
    const hit = STARTIMES_HOT_OFFERS.find((o) => o.pattern.test(name));
    return hit ? hit.image : null;
  }
  return null;
}

// Checked in priority order below: a plan matching an earlier category is
// never re-bucketed by a later, more generic one (e.g. a 5G router plan
// billed monthly lands in Broadband, not Monthly).
export function categorizeDataPlan(name: string): DataPlanCategory {
  const lower = name.toLowerCase();

  if (/broadband|router|\b5g\b/.test(lower)) return "Broadband";
  if (/\bxtra\b/.test(lower)) return "XtraValue";
  if (/youtube|\bmusic\b|streaming|\bsms\b/.test(lower)) return "Social";

  if (/\byearly\b|\bannual\b|\b365\s*days?\b/.test(lower)) return "Yearly";
  if (/\b\d+[\s-]*months?\b/.test(lower) || /\bmonthly\b/.test(lower) || /\b30\s*days?\b/.test(lower)) {
    return "Monthly";
  }

  const dayMatch = lower.match(/\b(\d+)\s*days?\b/);
  if (dayMatch) {
    const days = parseInt(dayMatch[1], 10);
    if (days <= 6) return "Daily";
    if (days <= 29) return "Weekly";
    return "Monthly";
  }
  if (lower.includes("daily")) return "Daily";
  if (lower.includes("weekly")) return "Weekly";

  return "Other";
}

export function groupByCategory<T extends { name: string }>(
  items: T[],
  network: string
): Partial<Record<DataPlanCategory, T[]>> {
  const grouped: Partial<Record<DataPlanCategory, T[]>> = {};
  for (const item of items) {
    const category = categorizeDataPlan(item.name);
    (grouped[category] ??= []).push(item);
    const highlight = highlightBucket(item.name, network);
    if (highlight) {
      (grouped[highlight] ??= []).push(item);
    }
  }
  return grouped;
}
