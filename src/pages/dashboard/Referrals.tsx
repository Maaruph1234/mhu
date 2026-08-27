import { useState } from "react";
import { Copy, Gift, Users, ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { useAuth } from "../../context/AuthContext";
import { deriveReferralCode } from "../../lib/format";

export default function Referrals() {
  const { profile } = useAuth();
  const [copied, setCopied] = useState(false);
  // Collapsed by default on mobile to save space (tap the header to expand);
  // always shown on sm+ screens regardless of this state -- see the
  // `expanded ? ... : "hidden sm:block"` class below.
  const [expanded, setExpanded] = useState(false);

  const code = profile ? deriveReferralCode(profile.id) : "";
  // Always the real site, even on a local dev server -- referral links
  // shared from here should never point at localhost. Falls back to
  // window.location.origin only if VITE_APP_URL was never set.
  const appUrl = (import.meta.env.VITE_APP_URL as string | undefined) || window.location.origin;
  const link = `${appUrl}/register?ref=${code}`;

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Referrals</h1>
        <p className="mt-1 text-sm text-slate-500">Invite friends and earn a bonus for every signup.</p>
      </div>

      <Card>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-left sm:cursor-default"
        >
          <CardHeader className="mb-0">
            <CardTitle>Your referral code</CardTitle>
          </CardHeader>
          <span className="text-slate-400 sm:hidden">
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </span>
        </button>
        <div className={clsx("mt-4", expanded ? "block" : "hidden sm:block")}>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-lg font-bold tracking-wider text-accent">{code}</span>
            <button onClick={() => copy(code)} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
              <Copy size={14} /> Copy
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="truncate text-sm text-slate-600">{link}</span>
            <button onClick={() => copy(link)} className="ml-3 shrink-0 text-sm text-slate-600 hover:text-slate-900">
              <Copy size={14} />
            </button>
          </div>
          {copied && <p className="mt-2 text-xs text-emerald-400">Copied to clipboard.</p>}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex items-start gap-3">
          <Gift className="mt-0.5 h-5 w-5 text-accent" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Earn on every signup</p>
            <p className="mt-1 text-xs text-slate-500">
              You and your friend both get a wallet bonus once they fund their wallet for the first time.
            </p>
          </div>
        </Card>
        <Card className="flex items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 text-accent" />
          <div>
            <p className="text-sm font-semibold text-slate-900">No limit</p>
            <p className="mt-1 text-xs text-slate-500">
              Invite as many people as you want — there's no cap on referral bonuses.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
