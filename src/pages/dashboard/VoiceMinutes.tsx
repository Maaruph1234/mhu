import { useEffect, useMemo, useState } from "react";
import { PhoneCall } from "lucide-react";
import clsx from "clsx";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { NetworkPicker } from "../../components/ui/NetworkPicker";
import { VOICE_NETWORKS } from "../../data/reference";
import { purchase, getVariations } from "../../lib/vtpass";
import type { VtpassVariation } from "../../lib/vtpass";
import { DATA_CATEGORY_ORDER, groupByCategory, isVoicePlan, type DataPlanCategory } from "../../lib/dataPlanCategories";
import { useWallet } from "../../context/WalletContext";
import { formatCurrency } from "../../lib/format";

// Voice/call-minute bundles (VTpass's "Xtratalk"/"Voice Bundle" products)
// are NOT a separate VTpass product -- they ride on the exact same
// mtn-data/airtel-data serviceID and GET /service-variations endpoint as
// regular data bundles (see src/lib/dataPlanCategories.ts's isVoicePlan
// header comment for how this was confirmed). This page fetches the same
// live list Data.tsx does and keeps only the voice-labeled entries, so the
// purchase itself still goes through vtpass-purchase with service: "data"
// -- that's genuinely what VTpass processes it as under the hood.
export default function VoiceMinutes() {
  const { refresh } = useWallet();
  const [network, setNetwork] = useState(VOICE_NETWORKS[0].id);
  const [plans, setPlans] = useState<VtpassVariation[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [category, setCategory] = useState<DataPlanCategory | null>(null);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingPlans(true);
    setPlansError(null);
    setPlanId(null);
    getVariations("data", network)
      .then((list) => {
        if (cancelled) return;
        const voicePlans = list.filter((p) => isVoicePlan(p.name));
        if (voicePlans.length === 0) {
          setPlansError(`No voice bundles available for ${network} yet`);
        }
        setPlans(voicePlans);
      })
      .catch((err) => {
        if (!cancelled) setPlansError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoadingPlans(false);
      });
    return () => {
      cancelled = true;
    };
  }, [network]);

  // Same Best Offers/Daily/Weekly/Monthly/etc. grouping Data.tsx uses --
  // Airtel's "Voice Bundle" names carry no duration wording so they land in
  // "Other", MTN's Xtratalk names do carry it ("Weekly Bundle"/"Monthly
  // Bundle") so those group correctly.
  const groupedPlans = useMemo(() => groupByCategory(plans, network), [plans, network]);
  const availableCategories = useMemo(
    () => DATA_CATEGORY_ORDER.filter((c) => groupedPlans[c]?.length),
    [groupedPlans]
  );

  useEffect(() => {
    setCategory((current) => {
      if (current && availableCategories.includes(current)) return current;
      return availableCategories[0] ?? null;
    });
  }, [availableCategories]);

  const visiblePlans = category ? groupedPlans[category] ?? [] : plans;
  const selectedPlan = plans.find((p) => p.code === planId) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan) return setError("Select a voice bundle");
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const result = await purchase({
        service: "data",
        serviceId: network,
        variationCode: selectedPlan.code,
        variationLabel: selectedPlan.name,
        phone,
        amount: selectedPlan.price,
      });
      if (!result.success) throw new Error(result.message);
      setSuccess(`${selectedPlan.name} sent to ${phone}. Ref: ${result.reference}`);
      setPhone("");
      setPlanId(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Voice call minutes</h1>
        <p className="mt-1 text-sm text-slate-500">Buy call-minute bundles for yourself or someone else.</p>
      </div>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">Network</p>
            <NetworkPicker
              networks={VOICE_NETWORKS}
              value={network}
              onChange={(id) => {
                setNetwork(id);
                setPlanId(null);
              }}
            />
            <p className="mt-2 text-xs text-slate-400">Only MTN and Airtel offer voice bundles via VTpass.</p>
          </div>
          <Input
            label="Phone number"
            type="tel"
            placeholder="080XXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">Bundle</p>
            {loadingPlans && <p className="text-sm text-slate-500">Loading bundles…</p>}
            {plansError && !loadingPlans && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500">
                Couldn't load bundles: {plansError}
              </p>
            )}
            {!loadingPlans && !plansError && (
              <>
                {availableCategories.length > 1 && (
                  <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                    {availableCategories.map((c) => (
                      <button
                        type="button"
                        key={c}
                        onClick={() => setCategory(c)}
                        className={clsx(
                          "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition",
                          category === c
                            ? "border-accent bg-accent text-white"
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {visiblePlans.map((p) => (
                    <button
                      type="button"
                      key={p.code}
                      onClick={() => setPlanId(p.code)}
                      className={clsx(
                        "rounded-xl border px-3 py-3 text-left transition",
                        planId === p.code ? "border-accent bg-accent/10" : "border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                      <p className="mt-1 text-xs font-medium text-accent">{formatCurrency(p.price)}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">{success}</p>}
          <Button type="submit" fullWidth loading={loading} icon={<PhoneCall size={16} />}>
            Buy voice bundle
          </Button>
        </form>
      </Card>
    </div>
  );
}
