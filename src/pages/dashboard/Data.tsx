import { useEffect, useState } from "react";
import { Wifi } from "lucide-react";
import clsx from "clsx";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { NetworkPicker } from "../../components/ui/NetworkPicker";
import { NETWORKS } from "../../data/reference";
import { purchase, getVariations } from "../../lib/vtpass";
import type { VtpassVariation } from "../../lib/vtpass";
import { useWallet } from "../../context/WalletContext";
import { formatCurrency } from "../../lib/format";

export default function Data() {
  const { refresh } = useWallet();
  const [network, setNetwork] = useState(NETWORKS[0].id);
  const [plans, setPlans] = useState<VtpassVariation[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Real data-plan codes/prices straight from VTpass -- not the static
  // placeholder list, which uses made-up codes VTpass would reject.
  useEffect(() => {
    setLoadingPlans(true);
    setPlansError(null);
    setPlanId(null);
    getVariations("data", network)
      .then(setPlans)
      .catch((err) => setPlansError((err as Error).message))
      .finally(() => setLoadingPlans(false));
  }, [network]);

  const selectedPlan = plans.find((p) => p.code === planId) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan) return setError("Select a data plan");
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
        <h1 className="text-2xl font-bold text-slate-900">Data bundles</h1>
        <p className="mt-1 text-sm text-slate-500">Buy data for yourself or someone else.</p>
      </div>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">Network</p>
            <NetworkPicker
              networks={NETWORKS}
              value={network}
              onChange={(id) => {
                setNetwork(id);
                setPlanId(null);
              }}
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">Plan</p>
            {loadingPlans && <p className="text-sm text-slate-500">Loading plans…</p>}
            {plansError && !loadingPlans && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500">
                Couldn't load plans: {plansError}
              </p>
            )}
            {!loadingPlans && !plansError && (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {plans.map((p) => (
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
            )}
          </div>
          <Input
            label="Phone number"
            type="tel"
            placeholder="080XXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">{success}</p>}
          <Button type="submit" fullWidth loading={loading} icon={<Wifi size={16} />}>
            Buy data
          </Button>
        </form>
      </Card>
    </div>
  );
}
