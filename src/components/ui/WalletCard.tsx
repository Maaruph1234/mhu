import { Eye, EyeOff, Plus, Send } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { formatCurrency } from "../../lib/format";

export function WalletCard({ balance, currency = "NGN" }: { balance: number; currency?: string }) {
  const [visible, setVisible] = useState(true);
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-accent to-accent-700 p-7 shadow-glow">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
      <p className="text-xs font-medium uppercase tracking-wider text-white/70">Wallet balance</p>
      <div className="mt-3 flex items-center gap-3">
        <h2 className="text-4xl font-extrabold text-white">
          {visible ? formatCurrency(balance, currency) : "••••••"}
        </h2>
        <button onClick={() => setVisible(!visible)} className="text-white/70 hover:text-white" aria-label="Toggle balance visibility">
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to="/dashboard/fund"
          className="press-glass inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-accent transition hover:bg-white/90"
        >
          <Plus size={16} />
          Fund wallet
        </Link>
        <Link
          to="/dashboard/transfer"
          className="press-glass inline-flex items-center justify-center gap-2 rounded-xl border border-white/40 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-white hover:bg-white/10"
        >
          <Send size={16} />
          Transfer
        </Link>
      </div>
    </div>
  );
}
