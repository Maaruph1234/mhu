import { useState } from "react";
import { X, FileText, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../context/AuthContext";
import { isDemoMode } from "../../lib/demoMode";
import { demoStore } from "../../lib/demoStore";
import { formatCurrency, formatDate } from "../../lib/format";
import type { Transaction } from "../../types";

// Monthly account statement: pick a month, see every SUCCESSFUL transaction
// in it plus opening/closing balance, and save the whole thing as one PDF.
// Only "successful" transactions are included -- "pending" bank transfers
// are debited optimistically (see payvessel-payout/index.ts) but a failed
// one is refunded by directly adjusting wallet_balance rather than logging
// a reversal row, so there's no clean ledger entry for it. Counting only
// settled/successful rows keeps the opening/closing balance math exactly
// right instead of drifting on every pending-then-failed transfer.
//
// There's no stored balance-history table, so opening/closing balance for
// an arbitrary past month is derived from the one number we do have --
// the CURRENT wallet_balance -- by walking backwards:
//   closingBalance (end of the picked month) = currentBalance - sum of all
//     signed amounts for successful transactions AFTER the month ends
//   openingBalance (start of the picked month) = closingBalance - sum of
//     all signed amounts for successful transactions WITHIN the month
const isCredit = (type: Transaction["type"]) =>
  type === "transfer_in" || type === "fund_wallet" || type === "referral_bonus" ||
  type === "card_withdraw" || type === "card_terminate";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function friendlyType(type: string): string {
  return type
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Older rows may still have "... via VTpass"/"... via Provibill" baked into
// the stored title (see vtpass-purchase/index.ts) -- strip it so historical
// transactions don't leak the backend processor's name in the statement.
function cleanTitle(title?: string | null): string | undefined {
  return title?.replace(/\s*via\s+(VTpass|Provibill)\s*/gi, "").trim();
}

interface StatementRow extends Transaction {
  runningBalance: number;
}

export function StatementModal({ onClose }: { onClose: () => void }) {
  const { user, profile } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{
    rows: StatementRow[];
    openingBalance: number;
    closingBalance: number;
    totalCredits: number;
    totalDebits: number;
  } | null>(null);

  const yearOptions = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  const handleGenerate = async () => {
    setError(null);
    setLoading(true);
    setGenerated(null);
    try {
      const periodStart = new Date(year, month, 1);
      const periodEnd = new Date(year, month + 1, 1);

      let rowsInPeriod: Transaction[];
      let currentBalance: number;
      let sumAfterPeriodEnd = 0;

      if (isDemoMode) {
        const all = demoStore.getTransactions().filter((t) => t.status === "successful");
        rowsInPeriod = all
          .filter((t) => {
            const d = new Date(t.created_at);
            return d >= periodStart && d < periodEnd;
          })
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        currentBalance = demoStore.getWallet().balance;
        sumAfterPeriodEnd = all
          .filter((t) => new Date(t.created_at) >= periodEnd)
          .reduce((sum, t) => sum + (isCredit(t.type) ? t.amount : -t.amount), 0);
      } else {
        if (!user) throw new Error("Not signed in");
        currentBalance = Number(profile?.wallet_balance ?? 0);

        const [{ data: afterRows, error: afterErr }, { data: withinRows, error: withinErr }] = await Promise.all([
          supabase
            .from("transactions")
            .select("type, amount")
            .eq("user_id", user.id)
            .eq("status", "successful")
            .gte("created_at", periodEnd.toISOString()),
          supabase
            .from("transactions")
            .select("*")
            .eq("user_id", user.id)
            .eq("status", "successful")
            .gte("created_at", periodStart.toISOString())
            .lt("created_at", periodEnd.toISOString())
            .order("created_at", { ascending: true }),
        ]);
        if (afterErr) throw new Error(afterErr.message);
        if (withinErr) throw new Error(withinErr.message);

        sumAfterPeriodEnd = (afterRows ?? []).reduce(
          (sum, t) => sum + (isCredit(t.type as Transaction["type"]) ? t.amount : -t.amount),
          0
        );
        rowsInPeriod = (withinRows as Transaction[]) ?? [];
      }

      const closingBalance = currentBalance - sumAfterPeriodEnd;
      const sumWithinPeriod = rowsInPeriod.reduce(
        (sum, t) => sum + (isCredit(t.type) ? t.amount : -t.amount),
        0
      );
      const openingBalance = closingBalance - sumWithinPeriod;

      let running = openingBalance;
      const rows: StatementRow[] = rowsInPeriod.map((t) => {
        running += isCredit(t.type) ? t.amount : -t.amount;
        return { ...t, runningBalance: running };
      });

      const totalCredits = rowsInPeriod.filter((t) => isCredit(t.type)).reduce((s, t) => s + t.amount, 0);
      const totalDebits = rowsInPeriod.filter((t) => !isCredit(t.type)).reduce((s, t) => s + t.amount, 0);

      setGenerated({ rows, openingBalance, closingBalance, totalCredits, totalDebits });
    } catch (err) {
      setError((err as Error).message || "Could not generate statement");
    } finally {
      setLoading(false);
    }
  };

  const handleSavePdf = async () => {
    const node = document.getElementById("statement-printable");
    if (!node) return;
    setError(null);
    setDownloading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(`MHU-Statement-${MONTH_NAMES[month]}-${year}.pdf`);
    } catch (err) {
      setError((err as Error).message || "Could not save PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="text-sm font-semibold text-slate-900">Monthly statement</p>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(85vh-64px)] overflow-y-auto px-5 py-5">
          <div className="flex gap-2">
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-slate-900 hover:brightness-95 disabled:opacity-50"
            >
              {loading ? "Loading…" : "Generate"}
            </button>
          </div>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          {loading && (
            <div className="mt-6 flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Building your statement…
            </div>
          )}

          {generated && !loading && (
            <div className="mt-5">
              <div id="statement-printable" className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-col items-center border-b border-slate-100 pb-4 text-center">
                  <img src="/logo.png" alt="MHU Global" className="h-12 w-12 rounded-full object-cover" />
                  <p className="mt-2 text-lg font-bold text-blue-900">MHU Global Investment Ltd</p>
                  <p className="text-sm text-slate-500">Account Statement — {MONTH_NAMES[month]} {year}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {profile?.display_name || profile?.email || "Account holder"}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 py-4 text-sm">
                  <SummaryBox label="Opening balance" value={formatCurrency(generated.openingBalance)} />
                  <SummaryBox label="Closing balance" value={formatCurrency(generated.closingBalance)} />
                  <SummaryBox label="Total credits" value={`+${formatCurrency(generated.totalCredits)}`} tone="credit" />
                  <SummaryBox label="Total debits" value={`-${formatCurrency(generated.totalDebits)}`} tone="debit" />
                </div>

                {generated.rows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">No transactions in this period.</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-100">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-2.5 py-2 font-medium">Date</th>
                          <th className="px-2.5 py-2 font-medium">Description</th>
                          <th className="px-2.5 py-2 text-right font-medium">Amount</th>
                          <th className="px-2.5 py-2 text-right font-medium">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {generated.rows.map((r) => {
                          const credit = isCredit(r.type);
                          return (
                            <tr key={r.id} className="border-t border-slate-100">
                              <td className="px-2.5 py-2 text-slate-500">{formatDate(r.created_at)}</td>
                              <td className="px-2.5 py-2 text-slate-900">
                                {cleanTitle(r.title) || friendlyType(r.type)}
                                {r.subtitle ? <span className="text-slate-400"> · {r.subtitle}</span> : null}
                              </td>
                              <td className={`px-2.5 py-2 text-right font-medium ${credit ? "text-emerald-600" : "text-slate-900"}`}>
                                {credit ? "+" : "-"}
                                {formatCurrency(r.amount)}
                              </td>
                              <td className="px-2.5 py-2 text-right text-slate-500">{formatCurrency(r.runningBalance)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <p className="mt-4 text-center text-[11px] text-slate-400">
                  Generated {formatDate(new Date().toISOString())} · www.mhuglobal.com
                </p>
              </div>

              <button
                onClick={handleSavePdf}
                disabled={downloading}
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-sm font-semibold text-slate-900 hover:brightness-95 disabled:opacity-50"
              >
                <FileText size={15} />
                {downloading ? "Saving…" : "Save statement as PDF"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryBox({ label, value, tone }: { label: string; value: string; tone?: "credit" | "debit" }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p
        className={`mt-0.5 text-sm font-semibold ${
          tone === "credit" ? "text-emerald-600" : tone === "debit" ? "text-slate-900" : "text-blue-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
