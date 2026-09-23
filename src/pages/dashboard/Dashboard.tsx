import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { WalletCard } from "../../components/ui/WalletCard";
import { QuickActions } from "../../components/ui/QuickActions";
import { TransactionRow } from "../../components/ui/TransactionRow";
import { ReceiptModal } from "../../components/ui/ReceiptModal";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { useWallet } from "../../context/WalletContext";
import { useAuth } from "../../context/AuthContext";
import { deriveReferralCode } from "../../lib/format";
import * as xpressWallet from "../../lib/xpressWallet";
import { isDemoMode } from "../../lib/demoMode";
import type { Transaction } from "../../types";

export default function Dashboard() {
  const { profile } = useAuth();
  const { wallet, transactions, loading } = useWallet();
  const [selected, setSelected] = useState<Transaction | null>(null);
  // Tiered onboarding (see README.md): signup stays light, so most users
  // reach the dashboard without a real Providus Bank account yet. This
  // nudges them toward verifying (BVN/DOB/address, on Fund Wallet) instead
  // of gating that at signup -- BVN checks can fail and shouldn't block
  // registration. `null` = "still checking" so the banner doesn't flash in
  // then out once the lookup resolves.
  const [needsVerification, setNeedsVerification] = useState<boolean | null>(null);

  useEffect(() => {
    if (isDemoMode) {
      setNeedsVerification(false);
      return;
    }
    let cancelled = false;
    xpressWallet
      .getMyAccount()
      .then((account) => {
        if (!cancelled) setNeedsVerification(!account);
      })
      .catch(() => {
        if (!cancelled) setNeedsVerification(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome{profile?.display_name ? `, ${profile.display_name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm text-slate-500">Here&apos;s what&apos;s happening with your wallet.</p>
      </div>

      {needsVerification && (
        <Link
          to="/dashboard/fund"
          className="flex items-center justify-between gap-4 rounded-xl border border-accent/20 bg-accent/5 px-5 py-4 transition hover:bg-accent/10"
        >
          <div>
            <p className="text-sm font-semibold text-slate-900">Verify your account to unlock wallet funding</p>
            <p className="mt-0.5 text-sm text-slate-500">
              Takes a minute — get a dedicated bank account number in your name for deposits and bank transfers.
            </p>
          </div>
          <span className="shrink-0 text-sm font-medium text-accent">Verify now →</span>
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <WalletCard balance={wallet?.balance ?? 0} currency={wallet?.currency} />
        <Card className="flex flex-col justify-center">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Referral code</p>
          <p className="mt-2 text-2xl font-bold text-accent">
            {profile ? deriveReferralCode(profile.id) : "—"}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Share your code — you and your friend both earn a bonus when they fund their wallet.
          </p>
          <Link to="/dashboard/referrals" className="mt-3 text-sm font-medium text-accent hover:underline">
            View referral program →
          </Link>
        </Card>
      </div>

      <div>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">Quick actions</h2>
        <QuickActions />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Recent transactions</CardTitle>
          <Link to="/dashboard/transactions" className="text-sm font-medium text-accent hover:underline">
            View all
          </Link>
        </CardHeader>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading...</p>
        ) : transactions.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No transactions yet.</p>
        ) : (
          <div>
            {transactions.slice(0, 6).map((tx) => (
              <TransactionRow key={tx.id} tx={tx} onClick={() => setSelected(tx)} />
            ))}
          </div>
        )}
      </Card>

      {selected && <ReceiptModal tx={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
