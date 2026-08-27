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
  type === "transfer_in" || type === "fund_wallet" || type === "referral_bonus";

const statusMeta: Record<Transaction["status"], { label: string; icon: typeof CheckCircle2; className: string }> = {
  successful: { label: "Successful", icon: CheckCircle2, className: "text-emerald-500 bg-emerald-50" },
  pending: { label: "Pending", icon: Clock, className: "text-amber-500 bg-amber-50" },
  failed: { label: "Failed", icon: XCircle, className: "text-red-500 bg-red-50" },
};

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
          <div ref={receiptRef} className="rounded-xl bg-white p-5">
            <div className="flex flex-col items-center text-center">
              <img src="/logo.png" alt="MHU Global" className="h-14 w-14 rounded-full object-cover" />
              <p className="mt-2 text-sm font-bold text-slate-900">
                MHU <span className="text-accent">Global</span>
              </p>
            </div>

            <div className="my-4 border-t border-dashed border-slate-200" />

            <div className="flex flex-col items-center text-center">
              <div className={`flex h-12 w-12 items-center justify-center rounded-full ${status.className}`}>
                <StatusIcon size={24} />
              </div>
              <p className={`mt-3 text-2xl font-bold ${credit ? "text-emerald-500" : "text-slate-900"}`}>
                {credit ? "+" : "-"}
                {formatCurrency(tx.amount)}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-500">{status.label}</p>
            </div>

            <div className="my-4 border-t border-dashed border-slate-200" />

            <div className="space-y-2.5 text-sm">
              <Row label="Transaction" value={tx.title || tx.type.replace(/_/g, " ")} />
              {tx.subtitle && <Row label="Description" value={tx.subtitle} />}
              <Row label="Reference" value={tx.reference} mono />
              <Row label="Date & time" value={formatDate(tx.created_at)} />
              <Row label="Status" value={status.label} />
            </div>

            <div className="my-4 border-t border-dashed border-slate-200" />

            <p className="text-center text-[11px] text-slate-400">
              Thank you for using MHU Global — Fast. Safe. Reliable.
            </p>
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right font-medium text-slate-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}
