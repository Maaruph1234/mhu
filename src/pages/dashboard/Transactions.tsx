import { useState } from "react";
import { Card } from "../../components/ui/Card";
import { TransactionRow } from "../../components/ui/TransactionRow";
import { ReceiptModal } from "../../components/ui/ReceiptModal";
import { useWallet } from "../../context/WalletContext";
import type { Transaction, TransactionStatus } from "../../types";

const FILTERS: Array<{ label: string; value: TransactionStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "Successful", value: "successful" },
  { label: "Pending", value: "pending" },
  { label: "Failed", value: "failed" },
];

export default function Transactions() {
  const { transactions, loading } = useWallet();
  const [filter, setFilter] = useState<TransactionStatus | "all">("all");
  const [selected, setSelected] = useState<Transaction | null>(null);

  const filtered = filter === "all" ? transactions : transactions.filter((t) => t.status === filter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Transactions</h1>
        <p className="mt-1 text-sm text-slate-500">A full history of everything on your wallet.</p>
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
    </div>
  );
}
