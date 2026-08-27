import { useState } from "react";
import { Link } from "react-router-dom";
import { WalletCard } from "../../components/ui/WalletCard";
import { QuickActions } from "../../components/ui/QuickActions";
import { TransactionRow } from "../../components/ui/TransactionRow";
import { ReceiptModal } from "../../components/ui/ReceiptModal";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { useWallet } from "../../context/WalletContext";
import { useAuth } from "../../context/AuthContext";
import { deriveReferralCode } from "../../lib/format";
import type { Transaction } from "../../types";

export default function Dashboard() {
  const { profile } = useAuth();
  const { wallet, transactions, loading } = useWallet();
  const [selected, setSelected] = useState<Transaction | null>(null);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome{profile?.display_name ? `, ${profile.display_name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm text-slate-500">Here&apos;s what&apos;s happening with your wallet.</p>
      </div>

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
