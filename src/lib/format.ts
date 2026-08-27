export function formatCurrency(amount: number, currency = "NGN") {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("");
}

export function maskPhone(phone: string) {
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

// There's no referral_code column in the real users table — this derives a
// stable, unique-enough code directly from the user's own id instead of
// needing a new database column. Purely a display/sharing convenience.
export function deriveReferralCode(userId: string) {
  return userId.replace(/-/g, "").slice(0, 8).toUpperCase();
}
