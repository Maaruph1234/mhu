import { useEffect, useState } from "react";
import { Copy, ShieldCheck } from "lucide-react";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../context/AuthContext";
import { isDemoMode } from "../../lib/demoMode";
import * as payvessel from "../../lib/payvessel";
import type { PayvesselAccount } from "../../types";

export default function FundWallet() {
  const { profile } = useAuth();
  const [copied, setCopied] = useState(false);

  const [account, setAccount] = useState<PayvesselAccount | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(!isDemoMode);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [bvn, setBvn] = useState("");

  useEffect(() => {
    if (isDemoMode) {
      setLoadingAccount(false);
      return;
    }
    payvessel
      .getMyAccount()
      .then(setAccount)
      .finally(() => setLoadingAccount(false));
  }, []);

  // In demo mode there's no real Korapay account to create — show a
  // realistic virtual account immediately, same as every other screen in
  // demo mode.
  const virtualAccount = isDemoMode
    ? {
        bank: "Wema Bank",
        accountNumber: "8123456701",
        accountName: `MHU-${profile?.display_name ?? "Your Name"}`,
      }
    : account
    ? { bank: account.bank_name, accountNumber: account.account_number, accountName: account.account_name }
    : null;

  const copyAccount = () => {
    if (!virtualAccount) return;
    navigator.clipboard.writeText(virtualAccount.accountNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleCreateAccount = async () => {
    setCreateError("");
    if (!bvn || bvn.length !== 11) {
      setCreateError("Enter a valid 11-digit BVN");
      return;
    }
    setCreating(true);
    try {
      // NIN isn't asked for here -- it's already on file from the one
      // verified at signup (see store_verified_nin.sql). If somehow
      // missing (an account from before that existed), the edge function
      // returns a clear error rather than silently failing.
      const created = await payvessel.createAccount({ bvn });
      setAccount(created);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Fund wallet</h1>
        <p className="mt-1 text-sm text-slate-500">Add money to your MHU Global wallet.</p>
      </div>

      {!isDemoMode && !loadingAccount && !account && (
        <Card>
          <CardHeader>
            <CardTitle>Verify your identity to get a funding account</CardTitle>
          </CardHeader>
          <div className="flex gap-3 rounded-xl border border-accent/20 bg-accent/5 p-4 text-sm text-slate-600">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" />
            <p>
              We need your BVN to generate a dedicated bank account in your name. This is a one-time
              step required by regulation — it's sent securely and never stored beyond what's needed to
              create the account. (Your NIN is already on file from signup, so we don't need to ask again.)
            </p>
          </div>
          <div className="mt-4 space-y-3">
            <Input
              label="BVN"
              placeholder="11-digit BVN"
              value={bvn}
              onChange={(e) => setBvn(e.target.value)}
              maxLength={11}
            />
            {createError && <p className="text-xs text-red-500">{createError}</p>}
            <Button fullWidth loading={creating} onClick={handleCreateAccount}>
              Generate my funding account
            </Button>
          </div>
        </Card>
      )}

      {virtualAccount && (
        <Card>
          <CardHeader>
            <CardTitle>Bank transfer</CardTitle>
          </CardHeader>
          <div className="space-y-3 rounded-xl bg-slate-50 p-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Bank</span>
              <span className="font-medium text-slate-900">{virtualAccount.bank}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Account number</span>
              <button
                onClick={copyAccount}
                className="press-glass flex items-center gap-1.5 font-medium text-slate-900 hover:text-accent"
              >
                {virtualAccount.accountNumber}
                <Copy size={14} />
              </button>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Account name</span>
              <span className="font-medium text-slate-900">{virtualAccount.accountName}</span>
            </div>
          </div>
          {copied && <p className="mt-2 text-xs text-emerald-500">Account number copied.</p>}
          <p className="mt-3 text-xs text-slate-500">
            Transfers to this account reflect in your wallet automatically, usually within a minute.
          </p>
        </Card>
      )}
    </div>
  );
}
