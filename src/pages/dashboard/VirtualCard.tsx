import { useEffect, useState } from "react";
import { CreditCard, Eye, EyeOff, Snowflake, Sun, Wallet, ArrowDownToLine, XCircle, Copy, X } from "lucide-react";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { useWallet } from "../../context/WalletContext";
import * as cards from "../../lib/virtualCards";
import type { VirtualCard as VirtualCardT, VirtualCardDetail, VirtualCardTransaction } from "../../types";

// USD virtual card issuing (Visa/Mastercard) via Payvessel. See
// supabase/functions/payvessel-cards/index.ts for the full design
// reasoning: cards are funded/withdrawn against the user's own NGN wallet
// at a manually maintained exchange rate (not live FX), and full card
// numbers/CVVs are only ever fetched on demand for the active viewing
// session -- never stored here beyond component state, and cleared the
// moment the user closes the reveal panel.

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const statusStyles: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-600",
  ACTIVE: "bg-emerald-50 text-emerald-600",
  FROZEN: "bg-sky-50 text-sky-600",
  TERMINATED: "bg-slate-100 text-slate-500",
  FAILED: "bg-red-50 text-red-500",
};

export default function VirtualCard() {
  const { refresh } = useWallet();
  const [list, setList] = useState<VirtualCardT[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<VirtualCardT | null>(null);

  const loadCards = async () => {
    setLoading(true);
    try {
      setList(await cards.listCards());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCount = list.filter((c) => c.status !== "TERMINATED").length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Virtual cards</h1>
          <p className="mt-1 text-sm text-slate-500">USD Visa/Mastercard cards for online spending abroad.</p>
        </div>
        {activeCount < 3 && (
          <Button size="sm" icon={<CreditCard size={16} />} onClick={() => setShowCreate((s) => !s)}>
            New card
          </Button>
        )}
      </div>

      {showCreate && (
        <CreateCardForm
          onCreated={async (card) => {
            setShowCreate(false);
            setList((l) => [card, ...l]);
            await refresh();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loading && <p className="text-sm text-slate-500">Loading your cards…</p>}

      {!loading && !list.length && !showCreate && (
        <Card className="text-center">
          <CreditCard className="mx-auto mb-3 text-slate-300" size={40} />
          <p className="text-sm text-slate-500">
            You don't have a virtual card yet. Create one to pay at international merchants like Google, PayPal,
            and Canva.
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {list.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c)}
            className="press-glass flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-accent/40"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-14 items-center justify-center rounded-lg bg-slate-900 text-[10px] font-bold uppercase tracking-wide text-white">
                {c.brand}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {c.masked_pan || "•••• •••• •••• ••••"}
                </p>
                <p className="text-xs text-slate-500">{c.card_name}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-slate-900">${Number(c.balance_usd).toFixed(2)}</p>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusStyles[c.status] ?? ""}`}>
                {c.status}
              </span>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <CardDetailModal
          card={selected}
          onClose={() => setSelected(null)}
          onChanged={async (updated) => {
            if (updated) {
              setList((l) => l.map((c) => (c.id === updated.id ? updated : c)));
              setSelected(updated);
            } else {
              await loadCards();
              setSelected(null);
            }
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateCardForm({
  onCreated,
  onCancel,
}: {
  onCreated: (card: VirtualCardT) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    bvn: "",
    nin: "",
    dob: "",
    state: "",
    lga: "",
    street: "",
    postalCode: "",
    brand: "VISA" as "VISA" | "MASTERCARD",
    prefundAmountUsd: "",
  });
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setError("Identity photo must be under 4MB");
      return;
    }
    setImage(await fileToBase64(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!image) {
      setError("Upload a photo of a valid ID (national ID, passport, or driver's license)");
      return;
    }
    setLoading(true);
    try {
      const card = await cards.createCard({
        ...form,
        image,
        prefundAmountUsd: form.prefundAmountUsd ? Number(form.prefundAmountUsd) : undefined,
      });
      onCreated(card);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a virtual card</CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          Full KYC is required by our card partner for every card, same as a real bank card.
        </p>
      </CardHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="First name" value={form.firstName} onChange={set("firstName")} required />
          <Input label="Last name" value={form.lastName} onChange={set("lastName")} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Email" type="email" value={form.email} onChange={set("email")} required />
          <Input label="Phone" value={form.phone} onChange={set("phone")} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="BVN" maxLength={11} value={form.bvn} onChange={set("bvn")} required />
          <Input label="NIN" maxLength={11} value={form.nin} onChange={set("nin")} required />
        </div>
        <Input label="Date of birth" type="date" value={form.dob} onChange={set("dob")} required />
        <div className="grid grid-cols-2 gap-3">
          <Input label="State" value={form.state} onChange={set("state")} required />
          <Input label="LGA" value={form.lga} onChange={set("lga")} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Street address" value={form.street} onChange={set("street")} required />
          <Input label="Postal code" value={form.postalCode} onChange={set("postalCode")} required />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-600">Card network</p>
          <select
            value={form.brand}
            onChange={set("brand")}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
          >
            <option value="VISA">Visa</option>
            <option value="MASTERCARD">Mastercard</option>
          </select>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-600">Identity document photo</p>
          <input
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
        </div>
        <Input
          label="Initial funding (optional, USD)"
          type="number"
          placeholder="10.00"
          min={1}
          step="0.01"
          value={form.prefundAmountUsd}
          onChange={set("prefundAmountUsd")}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-3">
          <Button type="button" variant="secondary" onClick={onCancel} fullWidth>
            Cancel
          </Button>
          <Button type="submit" loading={loading} fullWidth>
            Create card
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CardDetailModal({
  card,
  onClose,
  onChanged,
}: {
  card: VirtualCardT;
  onClose: () => void;
  onChanged: (updated: VirtualCardT | null) => void;
}) {
  const [detail, setDetail] = useState<VirtualCardDetail | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"none" | "fund" | "withdraw">("none");
  const [txns, setTxns] = useState<VirtualCardTransaction[] | null>(null);

  const loadLive = async (reveal = false) => {
    setError(null);
    try {
      const live = await cards.getCard(card.payvessel_card_id, reveal);
      setDetail(live);
      setRevealed(reveal);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    loadLive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  const copyNumber = () => {
    if (!detail?.card_number) return;
    navigator.clipboard.writeText(detail.card_number.replace(/\s/g, ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const run = async (action: () => Promise<void>, thenReload = true) => {
    setBusy(action.name || "working");
    setError(null);
    try {
      await action();
      if (thenReload) await loadLive(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleFundOrWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter a valid amount");
      return;
    }
    setBusy(mode);
    setError(null);
    try {
      if (mode === "fund") await cards.fundCard(card.payvessel_card_id, amt);
      else await cards.withdrawFromCard(card.payvessel_card_id, amt);
      setAmount("");
      setMode("none");
      await loadLive(false);
      onChanged(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const loadTransactions = async () => {
    setBusy("transactions");
    try {
      setTxns(await cards.getCardTransactions(card.payvessel_card_id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{card.card_name || card.brand}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 p-5 text-white">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-white/70">{detail?.currency ?? card.currency}</span>
            <span className="text-xs font-bold uppercase">{detail?.brand ?? card.brand}</span>
          </div>
          <p className="mt-6 font-mono text-lg tracking-widest">
            {revealed && detail?.card_number ? detail.card_number : detail?.masked_pan || card.masked_pan || "•••• •••• •••• ••••"}
          </p>
          <div className="mt-4 flex items-center justify-between text-xs text-white/70">
            <span>{revealed && detail?.expiry ? `Exp ${detail.expiry}` : "Exp ••/••"}</span>
            <span>{revealed && detail?.cvv ? `CVV ${detail.cvv}` : "CVV •••"}</span>
            <span className="font-semibold text-white">${Number(detail?.balance_usd ?? card.balance_usd).toFixed(2)}</span>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={revealed ? <EyeOff size={14} /> : <Eye size={14} />}
            onClick={() => loadLive(!revealed)}
          >
            {revealed ? "Hide details" : "Reveal card number"}
          </Button>
          {revealed && detail?.card_number && (
            <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={copyNumber}>
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        {(detail?.status ?? card.status) === "ACTIVE" && (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Button
              variant="secondary"
              icon={<Wallet size={16} />}
              onClick={() => setMode(mode === "fund" ? "none" : "fund")}
            >
              Fund
            </Button>
            <Button
              variant="secondary"
              icon={<ArrowDownToLine size={16} />}
              onClick={() => setMode(mode === "withdraw" ? "none" : "withdraw")}
            >
              Withdraw
            </Button>
          </div>
        )}

        {mode !== "none" && (
          <form onSubmit={handleFundOrWithdraw} className="mt-3 space-y-3">
            <Input
              label={`Amount to ${mode} (USD)`}
              type="number"
              min={mode === "fund" ? 1 : 3}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              suffix="USD"
              required
            />
            <Button type="submit" fullWidth loading={busy === mode}>
              Confirm {mode}
            </Button>
          </form>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {(detail?.status ?? card.status) === "ACTIVE" && (
            <Button
              size="sm"
              variant="outline"
              icon={<Snowflake size={14} />}
              loading={busy === "freeze"}
              onClick={() => run(async function freeze() { await cards.freezeCard(card.payvessel_card_id); })}
            >
              Freeze
            </Button>
          )}
          {(detail?.status ?? card.status) === "FROZEN" && (
            <Button
              size="sm"
              variant="outline"
              icon={<Sun size={14} />}
              loading={busy === "unfreeze"}
              onClick={() => run(async function unfreeze() { await cards.unfreezeCard(card.payvessel_card_id); })}
            >
              Unfreeze
            </Button>
          )}
          {(detail?.status ?? card.status) !== "TERMINATED" && (
            <Button
              size="sm"
              variant="outline"
              icon={<XCircle size={14} />}
              loading={busy === "terminate"}
              onClick={() => {
                if (!confirm("Terminate this card? Any remaining balance is refunded to your wallet.")) return;
                run(async function terminate() {
                  await cards.terminateCard(card.payvessel_card_id);
                }, false).then(() => onChanged(null));
              }}
            >
              Terminate
            </Button>
          )}
          <Button size="sm" variant="ghost" loading={busy === "transactions"} onClick={loadTransactions}>
            View transactions
          </Button>
        </div>

        {txns && (
          <div className="mt-4 space-y-2">
            {!txns.length && <p className="text-sm text-slate-500">No card transactions yet.</p>}
            {txns.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{t.merchant || t.type}</p>
                  <p className="text-xs text-slate-500">{t.description || t.status}</p>
                </div>
                <span className={t.entry === "CREDIT" ? "text-emerald-600" : "text-slate-900"}>
                  {t.entry === "CREDIT" ? "+" : "-"}${Number(t.amount).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
