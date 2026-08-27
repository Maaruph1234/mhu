import {
  Smartphone, Wifi, Tv, Zap, GraduationCap, Send, ArrowDownLeft, Gift, Wallet,
} from "lucide-react";
import type { Transaction } from "../../types";
import { formatCurrency, formatDate } from "../../lib/format";
import { Badge } from "./Badge";

const iconMap: Record<Transaction["type"], typeof Smartphone> = {
  airtime: Smartphone,
  data: Wifi,
  tv: Tv,
  electricity: Zap,
  exam_pin: GraduationCap,
  transfer_out: Send,
  bank_transfer_out: Send,
  transfer_in: ArrowDownLeft,
  referral_bonus: Gift,
  fund_wallet: Wallet,
};

const toneMap: Record<Transaction["status"], "success" | "pending" | "failed"> = {
  successful: "success",
  pending: "pending",
  failed: "failed",
};

const isCredit = (type: Transaction["type"]) => type === "transfer_in" || type === "fund_wallet" || type === "referral_bonus";

export function TransactionRow({ tx, onClick }: { tx: Transaction; onClick?: () => void }) {
  const Icon = iconMap[tx.type] ?? Wallet;
  const credit = isCredit(tx.type);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-4 border-b border-slate-200 py-4 text-left last:border-0 hover:bg-slate-50/60"
    >
      <div className="flex items-center gap-3.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-slate-600">
          <Icon size={18} />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900">{tx.title || tx.type.replace("_", " ")}</p>
          <p className="text-xs text-slate-500">
            {tx.subtitle ? `${tx.subtitle} · ` : ""}
            {formatDate(tx.created_at)}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className={`text-sm font-semibold ${credit ? "text-emerald-400" : "text-slate-900"}`}>
          {credit ? "+" : "-"}
          {formatCurrency(tx.amount)}
        </p>
        <Badge tone={toneMap[tx.status]}>{tx.status}</Badge>
      </div>
    </button>
  );
}
