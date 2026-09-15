import { useRef, useState } from "react";
import { X, Download, FileText, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { Transaction } from "../../types";
import { formatCurrency, formatDate } from "../../lib/format";

// Full transaction detail + downloadable receipt. html2canvas renders the
// `receiptRef` node (and only that node -- not the surrounding modal chrome
// or buttons) to a canvas, which is then either saved directly as a PNG or
// dropped into a same-size PDF page via jsPDF. Both libs are loaded lazily
// so they don't add weight to the main bundle for people who never open a
// receipt.
const isCredit = (type: Transaction["type"]) =>
  type === "transfer_in" || type === "fund_wallet" || type === "referral_bonus" ||
  type === "card_withdraw" || type === "card_terminate";

const statusMeta: Record<Transaction["status"], { label: string; icon: typeof CheckCircle2; className: string; solid: string }> = {
  successful: { label: "Successful", icon: CheckCircle2, className: "text-emerald-500 bg-emerald-50", solid: "bg-emerald-500" },
  pending: { label: "Pending", icon: Clock, className: "text-amber-500 bg-amber-50", solid: "bg-amber-500" },
  failed: { label: "Failed", icon: XCircle, className: "text-red-500 bg-red-50", solid: "bg-red-500" },
};

// "Transfer Successful" / "Purchase Pending" etc -- mirrored exactly in the
// Flutter app's receipt_sheet.dart/receipt_generator.dart (_headline /
// _subheadline) so a receipt reads the same on both platforms.
function headline(tx: Transaction): string {
  const statusWord = statusMeta[tx.status].label;
  const action =
    tx.type === "transfer_out" || tx.type === "bank_transfer_out"
      ? "Transfer"
      : tx.type === "transfer_in" || tx.type === "fund_wallet"
      ? "Funding"
      : "Purchase";
  return `${action} ${statusWord}`;
}

function subheadline(tx: Transaction): string {
  if (tx.status === "failed") return "This transaction didn't go through.";
  if (tx.status === "pending") return "We're still confirming this transaction.";
  if (tx.type === "transfer_out" || tx.type === "bank_transfer_out") return "Your money has been sent successfully.";
  if (tx.type === "transfer_in" || tx.type === "fund_wallet") return "Your wallet has been credited successfully.";
  return "Your purchase was completed successfully.";
}

function friendlyType(type: string): string {
  return type
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Older rows may still have "... via VTpass"/"... via Provibill" baked into
// the stored title (see vtpass-purchase/index.ts) -- strip it so historical
// transactions don't leak the backend processor's name in the receipt.
function cleanTitle(title?: string | null): string | undefined {
  return title?.replace(/\s*via\s+(VTpass|Provibill)\s*/gi, "").trim();
}

export function ReceiptModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState<"image" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const credit = isCredit(tx.type);
  const status = statusMeta[tx.status];
  const StatusIcon = status.icon;
  const fileName = `MHU-Receipt-${tx.reference}`;

  const captureCanvas = async () => {
    if (!receiptRef.current) throw new Error("Nothing to capture");
    const html2canvas = (await import("html2canvas")).default;
    return html2canvas(receiptRef.current, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });
  };

  const handleSaveImage = async () => {
    setError(null);
    setDownloading("image");
    try {
      const canvas = await captureCanvas();
      const link = document.createElement("a");
      link.download = `${fileName}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      setError((err as Error).message || "Could not save image");
    } finally {
      setDownloading(null);
    }
  };

  const handleSavePdf = async () => {
    setError(null);
    setDownloading("pdf");
    try {
      const canvas = await captureCanvas();
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(`${fileName}.pdf`);
    } catch (err) {
      setError((err as Error).message || "Could not save PDF");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="text-sm font-semibold text-slate-900">Transaction receipt</p>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-5">
          <div ref={receiptRef} className="overflow-hidden rounded-xl bg-white">
            {/* Header banner (letterhead) -- drops the wider services-icon
                list and QR/app-store badges from the reference design: the
                former needs more width than this card has, the latter would
                link to app store listings that don't exist yet. */}
            <div className="flex flex-col items-center bg-gradient-to-br from-[#0D6EFD] to-[#0047AB] px-4 py-6 text-center text-white">
              <img src="/logo.png" alt="MHU Global" className="h-14 w-14 rounded-full object-cover" />
              <p className="mt-2 text-xl font-bold">MHU</p>
              <p className="text-[10px] font-bold tracking-wider">GLOBAL INVESTMENT LTD</p>
              <p className="mt-0.5 text-[10px] italic text-white/85">Powering your digital lifestyle</p>
            </div>

            <div className="px-5 py-5">
              <div className="flex flex-col items-center text-center">
                <div className={`flex h-12 w-12 items-center justify-center rounded-full ${status.solid}`}>
                  <StatusIcon size={24} className="text-white" />
                </div>
                <p className="mt-3 text-lg font-bold text-blue-900">{headline(tx)}</p>
                <p className="mt-1 text-sm text-slate-500">{subheadline(tx)}</p>
              </div>

              <div className="mt-5 rounded-lg bg-slate-50 p-3.5 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] text-slate-500">Transaction Reference</p>
                    <p className="mt-0.5 font-mono text-xs font-semibold text-blue-900">{tx.reference || "—"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-500">Date &amp; Time</p>
                    <p className="mt-0.5 text-xs font-semibold text-slate-900">{formatDate(tx.created_at)}</p>
                  </div>
                </div>

                <div className="my-3 border-t border-slate-200" />

                <div className="space-y-2.5">
                  <Row label="Transaction" value={cleanTitle(tx.title) || tx.type.replace(/_/g, " ")} />
                  {tx.subtitle && tx.subtitle !== status.label && <Row label="Description" value={tx.subtitle} />}
                  <Row
                    label="Amount"
                    value={`${credit ? "+" : "-"}${formatCurrency(tx.amount)}`}
                    valueClassName={credit ? "text-emerald-600" : "text-slate-900"}
                    bold
                  />
                  <Row label="Transaction Type" value={friendlyType(tx.type)} />
                  <Row label="Status" value={status.label} valueClassName={status.className.split(" ")[0]} />
                </div>
              </div>

              <p className="mt-5 text-center text-sm italic text-blue-900">
                Thank you for choosing MHU! Together we grow.
              </p>
              <p className="mt-1 text-center text-[11px] text-slate-400">
                www.mhuventures.com &nbsp;|&nbsp; info@mhuventures.com
              </p>
            </div>
          </div>

          {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-5 py-4">
          <button
            onClick={handleSaveImage}
            disabled={downloading !== null}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download size={15} />
            {downloading === "image" ? "Saving…" : "Save image"}
          </button>
          <button
            onClick={handleSavePdf}
            disabled={downloading !== null}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-sm font-semibold text-slate-900 hover:brightness-95 disabled:opacity-50"
          >
            <FileText size={15} />
            {downloading === "pdf" ? "Saving…" : "Save PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  bold,
  valueClassName,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span
        className={`text-right text-slate-900 ${bold ? "font-bold" : "font-medium"} ${mono ? "font-mono text-xs" : ""} ${valueClassName ?? ""}`}
      >
        {value}
      </span>
    </div>
  );
}
