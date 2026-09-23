import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Upload } from "lucide-react";
import { Card, CardHeader, CardTitle } from "../ui/Card";
import { Button } from "../ui/Button";
import { useAuth } from "../../context/AuthContext";
import * as tier3 from "../../lib/tier3";
import { TIER3_DOCUMENT_LABELS } from "../../lib/tier3";
import type { Tier3DocumentType, Tier3Verification } from "../../types";

// Mirrors kyc_tier_limits() in supabase/schema.sql exactly -- display only,
// the real enforcement happens server-side (transfer_funds,
// xpresswallet-transfer, xpresswallet-create-wallet). Keep these two in
// sync if the numbers ever change.
const TIER_LIMITS: Record<1 | 2 | 3, { maxBalance: number; dailyLimit: number }> = {
  1: { maxBalance: 50_000, dailyLimit: 20_000 },
  2: { maxBalance: 500_000, dailyLimit: 200_000 },
  3: { maxBalance: 5_000_000, dailyLimit: 1_000_000 },
};

function formatNaira(n: number) {
  return `₦${n.toLocaleString("en-NG")}`;
}

export function TierCard() {
  const { profile } = useAuth();
  const tierNum = (profile?.kyc_tier ?? 1) as 1 | 2 | 3;
  const limits = TIER_LIMITS[tierNum];

  const [submissions, setSubmissions] = useState<Tier3Verification[]>([]);
  const [documentType, setDocumentType] = useState<Tier3DocumentType>("utility_bill");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tierNum === 2) {
      tier3.getMyTier3Submissions().then(setSubmissions).catch(() => {});
    }
  }, [tierNum]);

  const latestSubmission = submissions[0];
  const hasPendingSubmission = latestSubmission?.status === "pending";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Choose a document to upload");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await tier3.submitTier3Verification(documentType, file);
      setSubmissions((prev) => [result, ...prev]);
      setFile(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Verification tier</CardTitle>
        <span className="flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
          <ShieldCheck size={14} />
          Tier {tierNum}
        </span>
      </CardHeader>

      <div className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Balance limit</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{formatNaira(limits.maxBalance)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Daily transfer limit</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{formatNaira(limits.dailyLimit)}</p>
        </div>
      </div>

      {tierNum === 1 && (
        <div className="mt-4">
          <p className="text-sm text-slate-500">
            Verify your account with your BVN to unlock a real bank account for funding, higher limits, and bank
            transfers.
          </p>
          <Link to="/dashboard/fund" className="mt-3 inline-block text-sm font-medium text-accent hover:underline">
            Verify now →
          </Link>
        </div>
      )}

      {tierNum === 2 && (
        <div className="mt-4 space-y-4">
          {hasPendingSubmission ? (
            <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
              Your {TIER3_DOCUMENT_LABELS[latestSubmission.document_type]} submission is under review. This is
              reviewed by hand, so it may take a little while — check back here for updates.
            </div>
          ) : latestSubmission?.status === "rejected" ? (
            <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
              Your last submission wasn&apos;t approved
              {latestSubmission.reviewer_notes ? `: ${latestSubmission.reviewer_notes}` : "."} You can submit again
              below.
            </div>
          ) : null}

          {!hasPendingSubmission && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <p className="text-sm text-slate-500">
                Want a higher limit? Submit a document for enhanced verification (Tier 3) — reviewed by our team,
                not an automated check.
              </p>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Document type</label>
                <select
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value as Tier3DocumentType)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
                >
                  {Object.entries(TIER3_DOCUMENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Document photo or scan</label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-xl border border-dashed border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-accent/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" loading={submitting} icon={<Upload size={16} />}>
                Submit for review
              </Button>
            </form>
          )}
        </div>
      )}

      {tierNum === 3 && (
        <p className="mt-4 text-sm text-slate-500">You&apos;re fully verified — highest limits unlocked.</p>
      )}
    </Card>
  );
}
