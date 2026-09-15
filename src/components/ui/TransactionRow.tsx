import {
  Smartphone, Wifi, Tv, Zap, GraduationCap, Send, ArrowDownLeft, Gift, Wallet, CreditCard, ShieldCheck, Signal, Plane,
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
  card_create: CreditCard,
  card_fund: CreditCard,
  card_withdraw: CreditCard,
  card_terminate: CreditCard,
  card_fee: CreditCard,
  identity_verification: ShieldCheck,
  esim_purchase: Signal,
  flight_booking: Plane,
};

const toneMap: Record<Transaction["status"], "success" | "pending" | "failed"> = {
  successful: "success",
  pending: "pending",
  failed: "failed",
};

const isCredit = (type: Transaction["type"]) =>
  type === "transfer_in" || type === "fund_wallet" || type === "referral_bonus" ||
  type === "card_withdraw" || type === "card_terminate";

// Older rows may still have "... via VTpass"/"... via Provibill" baked into
// the stored title (see vtpass-purchase/index.ts) -- strip it so historical
// transactions don't leak the backend processor's name in the UI.
const cleanTitle = (title?: string | null) =>
  title?.replace(/\s*via\s+(VTpass|Provibill)\s*/gi, "").trim();

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
          <p className="text-sm font-medium text-slate-900">{cleanTitle(tx.title) || tx.type.replace("_", " ")}</p>
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
