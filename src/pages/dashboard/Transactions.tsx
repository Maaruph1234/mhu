import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { TransactionRow } from "../../components/ui/TransactionRow";
import { ReceiptModal } from "../../components/ui/ReceiptModal";
import { StatementModal } from "../../components/ui/StatementModal";
import { useWallet } from "../../context/WalletContext";
import { checkTransferStatus } from "../../lib/payvessel";
import type { Transaction, TransactionStatus } from "../../types";

const FILTERS: Array<{ label: string; value: TransactionStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "Successful", value: "successful" },
  { label: "Pending", value: "pending" },
  { label: "Failed", value: "failed" },
];

export default function Transactions() {
  const { transactions, loading, refresh } = useWallet();
  const [filter, setFilter] = useState<TransactionStatus | "all">("all");
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [showStatement, setShowStatement] = useState(false);

  // Bank transfers used to be resolved only by a webhook that (per
  // payvessel-payout/index.ts's updated header comment) has never actually
  // been observed firing for a real payout -- meaning a transfer could
  // stay "pending" forever even after the money genuinely landed. This
  // reconciles every pending bank transfer against Payvessel's real
  // Transfer Status endpoint whenever the page loads, same fix as the app.
  const checkedRef = useRef(new Set<string>());
  useEffect(() => {
    const pending = transactions.filter((t) => t.type === "bank_transfer_out" && t.status === "pending");
    const toCheck = pending.filter((t) => !checkedRef.current.has(t.reference));
    if (!toCheck.length) return;
    toCheck.forEach((t) => checkedRef.current.add(t.reference));

    (async () => {
      const results = await Promise.all(
        toCheck.map((t) => checkTransferStatus(t.reference).catch(() => "pending" as const))
      );
      if (results.some((r) => r !== "pending")) refresh();
    })();
  }, [transactions, refresh]);

  const filtered = filter === "all" ? transactions : transactions.filter((t) => t.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Transactions</h1>
          <p className="mt-1 text-sm text-slate-500">A full history of everything on your wallet.</p>
        </div>
        <button
          onClick={() => setShowStatement(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
        >
          <FileText size={15} />
          Statement
        </button>
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              filter === f.value ? "bg-accent text-slate-900" : "bg-slate-50 text-slate-500 hover:text-slate-900"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No transactions found.</p>
        ) : (
          <div>
            {filtered.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} onClick={() => setSelected(tx)} />
            ))}
          </div>
        )}
      </Card>

      {selected && <ReceiptModal tx={selected} onClose={() => setSelected(null)} />}
      {showStatement && <StatementModal onClose={() => setShowStatement(false)} />}
    </div>
  );
}
