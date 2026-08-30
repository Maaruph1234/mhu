import { useEffect, useState } from "react";
import { ShieldCheck, ChevronDown } from "lucide-react";
import { Card, CardHeader, CardTitle } from "../ui/Card";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import * as identity from "../../lib/identityVerification";
import type { IdentityDocType, IdentityVerification } from "../../types";

const DOC_TYPES: { type: IdentityDocType; label: string; placeholder: string }[] = [
  { type: "nin", label: "NIN", placeholder: "11-digit NIN" },
  { type: "drivers_license", label: "Driver's license", placeholder: "License number" },
  { type: "voters_card", label: "Voter's card", placeholder: "Voter ID (VIN)" },
  { type: "passport", label: "International passport", placeholder: "Passport number" },
];

// Extra KYC beyond the BVN check done at signup -- lets a user verify
// additional documents against Payvessel's Identity Verification API for a
// stronger profile (e.g. before support raises limits or resolves a
// dispute). See supabase/functions/payvessel-identity/index.ts for why
// each attempt carries a small fee.
export function IdentityVerificationCard() {
  const [verifications, setVerifications] = useState<Record<string, IdentityVerification>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<IdentityDocType | null>(null);
  const [docNumber, setDocNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    identity
      .listVerifications()
      .then((list) => {
        const map: Record<string, IdentityVerification> = {};
        for (const v of list) map[v.doc_type] = v;
        setVerifications(map);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleVerify = async (docType: IdentityDocType) => {
    setError(null);
    if (!docNumber.trim()) {
      setError("Enter the document number");
      return;
    }
    setBusy(true);
    try {
      const result = await identity.verifyDocument(docType, docNumber.trim());
      if (result.verified && result.verification) {
        setVerifications((v) => ({ ...v, [docType]: result.verification! }));
        setExpanded(null);
        setDocNumber("");
      } else {
        setError(result.message ?? "Document could not be verified");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity verification</CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          Verify additional documents to strengthen your profile. A small fee applies per check.
        </p>
      </CardHeader>
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      <div className="space-y-2">
        {DOC_TYPES.map(({ type, label, placeholder }) => {
          const verified = verifications[type];
          const isOpen = expanded === type;
          return (
            <div key={type} className="rounded-xl border border-slate-200">
              <button
                className="flex w-full items-center justify-between px-4 py-3 text-left"
                onClick={() => {
                  setError(null);
                  setDocNumber("");
                  setExpanded(isOpen ? null : type);
                }}
                disabled={!!verified}
              >
                <span className="text-sm font-medium text-slate-900">{label}</span>
                {verified ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                    <ShieldCheck size={14} /> Verified
                  </span>
                ) : (
                  <ChevronDown size={16} className={`text-slate-400 transition ${isOpen ? "rotate-180" : ""}`} />
                )}
              </button>
              {verified && (
                <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                  {verified.verified_name} · {verified.doc_number}
                </div>
              )}
              {isOpen && !verified && (
                <div className="space-y-3 border-t border-slate-100 p-4">
                  <Input placeholder={placeholder} value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <Button size="sm" loading={busy} onClick={() => handleVerify(type)}>
                    Verify {label}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
