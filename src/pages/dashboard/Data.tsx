import { useEffect, useMemo, useState } from "react";
import { Wifi } from "lucide-react";
import clsx from "clsx";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { NetworkPicker } from "../../components/ui/NetworkPicker";
import { NETWORKS } from "../../data/reference";
import { purchase, getDataPlans } from "../../lib/hadjibs";
import type { HadjibsVariation } from "../../lib/hadjibs";
import { DATA_CATEGORY_ORDER, groupByCategory, type DataPlanCategory } from "../../lib/dataPlanCategories";
import { useWallet } from "../../context/WalletContext";
import { formatCurrency } from "../../lib/format";

export default function Data() {
  const { refresh } = useWallet();
  const [network, setNetwork] = useState(NETWORKS[0].id);
  const [plans, setPlans] = useState<HadjibsVariation[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [category, setCategory] = useState<DataPlanCategory | null>(null);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Hadjibs Data has no live "list variations" endpoint the way VTpass did
  // -- getDataPlans just filters the static catalog in
  // src/data/hadjibsDataPlans.ts. Kept as an effect (rather than a plain
  // useMemo) so the loading/error UI below still behaves the same way it
  // did against the old live fetch, and so a 9mobile pick (no plans yet --
  // see hadjibsDataPlans.ts) surfaces a clear message instead of an empty grid.
  useEffect(() => {
    setLoadingPlans(true);
    setPlansError(null);
    setPlanId(null);
    const list = getDataPlans(network);
    if (list.length === 0) {
      setPlansError(`No data plans available for ${network} yet`);
    }
    setPlans(list);
    setLoadingPlans(false);
  }, [network]);

  // Sorted into billing-cycle/purpose buckets (Daily, Social, Broadband,
  // MTN's XtraValue bundles, etc. -- see dataPlanCategories.ts) instead of
  // one long flat list, matching the Flutter app's Buy Data screen.
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
          <Input
            label="Phone number"
            type="tel"
            placeholder="080XXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">Plan</p>
            {loadingPlans && <p className="text-sm text-slate-500">Loading plans…</p>}
            {plansError && !loadingPlans && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500">
                Couldn't load plans: {plansError}
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
          <Button type="submit" fullWidth loading={loading} icon={<Wifi size={16} />}>
            Buy data
          </Button>
        </form>
      </Card>
    </div>
  );
}
