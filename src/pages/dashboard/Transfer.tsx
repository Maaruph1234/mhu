import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { SearchableSelect } from "../../components/ui/SearchableSelect";
import { supabase } from "../../lib/supabaseClient";
import { useWallet } from "../../context/WalletContext";
import { formatCurrency } from "../../lib/format";
import { isDemoMode } from "../../lib/demoMode";
import { demoStore } from "../../lib/demoStore";
import * as payvessel from "../../lib/payvessel";
import type { PayvesselBank } from "../../lib/payvessel";

type Tab = "mhu" | "bank";

export default function Transfer() {
  const { wallet, refresh } = useWallet();
  const [tab, setTab] = useState<Tab>("mhu");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Send money</h1>
        <p className="mt-1 text-sm text-slate-500">
          Available balance: <span className="font-semibold text-slate-900">{formatCurrency(wallet?.balance ?? 0)}</span>
        </p>
      </div>

      <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
        <button
          onClick={() => setTab("mhu")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
            tab === "mhu" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Transfer to MHU user
        </button>
        <button
          onClick={() => setTab("bank")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
            tab === "bank" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Transfer to bank
        </button>
      </div>

      {tab === "mhu" ? <TransferToMhuUser onDone={refresh} /> : <TransferToBank onDone={refresh} />}
    </div>
  );
}

function TransferToMhuUser({ onDone }: { onDone: () => Promise<void> }) {
  const [identifier, setIdentifier] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const transferAmount = Number(amount);

      if (isDemoMode) {
        await new Promise((r) => setTimeout(r, 700));
        const currentBalance = demoStore.getWallet().balance;
        if (transferAmount > currentBalance) throw new Error("Insufficient wallet balance");
        const reference = `TRF-${Date.now()}`;
        demoStore.record(
          {
            type: "transfer_out",
            amount: transferAmount,
            status: "successful",
            reference,
            title: note || `Transfer to ${identifier}`,
          },
          -transferAmount
        );
        setSuccess(`Transfer successful. Reference: ${reference}`);
        setIdentifier("");
        setAmount("");
        setNote("");
        await onDone();
        return;
      }

      const { data, error: rpcError } = await supabase.rpc("transfer_funds", {
        p_identifier: identifier,
        p_amount: transferAmount,
        p_note: note || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      setSuccess(`Transfer successful. Reference: ${data?.reference ?? ""}`);
      setIdentifier("");
      setAmount("");
      setNote("");
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <p className="mb-5 text-sm text-slate-500">Send money instantly to any MHU Global user, free of charge.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Recipient"
          placeholder="Phone number or email"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
        />
        <Input
          label="Amount"
          type="number"
          placeholder="0.00"
          suffix="NGN"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min={100}
          required
        />
        <Input label="Note (optional)" placeholder="What's this for?" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        {success && <p className="text-sm text-emerald-400">{success}</p>}
        <Button type="submit" fullWidth loading={loading} icon={<Send size={16} />}>
          Send money
        </Button>
      </form>
    </Card>
  );
}

function TransferToBank({ onDone }: { onDone: () => Promise<void> }) {
  const [banks, setBanks] = useState<PayvesselBank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [resolving, setResolving] = useState(false);
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    payvessel
      .listBanks()
      .then((list) => {
        setBanks(list);
        if (list.length) setBankCode(list[0].code);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingBanks(false));
  }, []);

  const handleResolve = async () => {
    setError(null);
    setAccountName("");
    if (!bankCode || accountNumber.length < 10) return;
    setResolving(true);
    try {
      const name = await payvessel.resolveAccount(bankCode, accountNumber);
      setAccountName(name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResolving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess(null);
    if (!accountName) {
      // Don't clobber a more specific error already surfaced by the resolve
      // attempt (e.g. the real reason Payvessel rejected the account) with
      // this generic fallback -- only show the fallback if nothing else is
      // already explaining what's wrong.
      setError((prev) => prev ?? "Resolve the account number first so you can confirm who you're sending to.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await payvessel.payoutToBank({
        bankCode,
        accountNumber,
        accountName,
        amount: Number(amount),
        narration,
      });
      if (!result.success) throw new Error(result.message);
      setSuccess(`Transfer initiated. Reference: ${result.reference}`);
      setAccountNumber("");
      setAccountName("");
      setAmount("");
      setNarration("");
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <p className="mb-5 text-sm text-slate-500">Send money from your wallet to any Nigerian bank account.</p>
      {error && !banks.length && !loadingBanks && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500">
          Couldn't load the bank list: {error}
        </p>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <SearchableSelect
          label="Bank"
          value={bankCode}
          onChange={(v) => {
            setBankCode(v);
            setAccountName("");
          }}
          loading={loadingBanks}
          disabled={!banks.length}
          placeholder={banks.length ? "Select a bank" : "No banks available"}
          options={banks.map((b) => ({ value: b.code, label: b.name }))}
        />
        <Input
          label="Account number"
          placeholder="10-digit account number"
          value={accountNumber}
          onChange={(e) => {
            setAccountNumber(e.target.value);
            setAccountName("");
          }}
          onBlur={handleResolve}
          maxLength={10}
          required
        />
        {resolving && <p className="text-xs text-slate-500">Confirming account name...</p>}
        {accountName && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-600">{accountName}</p>
        )}
        <Input
          label="Amount"
          type="number"
          placeholder="0.00"
          suffix="NGN"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min={100}
          required
        />
        <Input
          label="Narration (optional)"
          placeholder="What's this for?"
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        {success && <p className="text-sm text-emerald-400">{success}</p>}
        <Button type="submit" fullWidth loading={loading} icon={<Send size={16} />}>
          Send to bank
        </Button>
      </form>
    </Card>
  );
}
