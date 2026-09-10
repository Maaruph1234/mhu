import { useEffect, useMemo, useState } from "react";
import { Tv as TvIcon } from "lucide-react";
import clsx from "clsx";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { TV_PROVIDERS } from "../../data/reference";
import { purchase, verifySmartcard, getVariations } from "../../lib/vtpass";
import type { VtpassVariation } from "../../lib/vtpass";
import { TV_CATEGORY_ORDER, groupByCategory, getHotOfferImage, type DataPlanCategory } from "../../lib/dataPlanCategories";
import { useWallet } from "../../context/WalletContext";
import { formatCurrency } from "../../lib/format";

export default function Tv() {
  const { refresh } = useWallet();
  const [provider, setProvider] = useState(TV_PROVIDERS[0].id);
  const [smartcard, setSmartcard] = useState("");
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [plans, setPlans] = useState<VtpassVariation[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [category, setCategory] = useState<DataPlanCategory | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Real bouquets/prices straight from VTpass -- not the static placeholder
  // list, which uses made-up codes VTpass would reject as invalid.
  useEffect(() => {
    setLoadingPlans(true);
    setPlansError(null);
    setPlanId(null);
    getVariations("tv-subscription", provider)
      .then(setPlans)
      .catch((err) => setPlansError((err as Error).message))
      .finally(() => setLoadingPlans(false));
  }, [provider]);

  // Same grouping helper as the Data page -- for TV bouquets this mostly
  // just sorts real duration-bearing plans (e.g. "3-Month") away from
  // plain monthly ones; most bouquets have no duration wording at all and
  // land in a single "Other" bucket, in which case no tabs show at all.
  const groupedPlans = useMemo(() => groupByCategory(plans, provider), [plans, provider]);
  const availableCategories = useMemo(
    () => TV_CATEGORY_ORDER.filter((c) => groupedPlans[c]?.length),
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

  const handleVerify = async () => {
    setError(null);
    setCustomerName(null);
    setVerifying(true);
    try {
      const res = await verifySmartcard(provider, smartcard);
      setCustomerName(res.customerName);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setVerifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan) return setError("Select a plan");
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const result = await purchase({
        service: "tv-subscription",
        serviceId: provider,
        variationCode: selectedPlan.code,
        variationLabel: selectedPlan.name,
        smartcardNumber: smartcard,
        amount: selectedPlan.price,
      });
      if (!result.success) throw new Error(result.message);
      setSuccess(`${selectedPlan.name} renewed. Ref: ${result.reference}`);
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
        <h1 className="text-2xl font-bold text-slate-900">TV subscription</h1>
        <p className="mt-1 text-sm text-slate-500">Renew your DStv, GOtv or StarTimes bouquet.</p>
      </div>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">Provider</p>
            <div className="grid grid-cols-3 gap-2.5">
              {TV_PROVIDERS.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => {
                    setProvider(p.id);
                    setPlanId(null);
                    setCustomerName(null);
                  }}
                  className={clsx(
                    "flex flex-col items-center gap-1.5 rounded-xl border py-3 text-sm font-medium transition",
                    provider === p.id ? "border-accent bg-accent/10 text-slate-900" : "border-slate-200 text-slate-600 hover:border-slate-300"
                  )}
                >
                  {p.logo && <img src={p.logo} alt={p.name} className="h-7 w-7 rounded object-cover" />}
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Smartcard / IUC number"
                placeholder="1234567890"
                value={smartcard}
                onChange={(e) => setSmartcard(e.target.value)}
                required
              />
            </div>
            <Button type="button" variant="outline" loading={verifying} onClick={handleVerify} disabled={!smartcard}>
              Verify
            </Button>
          </div>
          {customerName && (
            <p className="-mt-2 text-sm text-emerald-400">Customer: {customerName}</p>
          )}

          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">Bouquet</p>
            {loadingPlans && <p className="text-sm text-slate-500">Loading bouquets…</p>}
            {plansError && !loadingPlans && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500">
                Couldn't load bouquets: {plansError}
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
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {visiblePlans.map((p) => {
                    // Hot Offers gets the user's own DStv promo images as
                    // full-bleed banner cards; everything else (and any
                    // Hot Offers plan we don't have an image for yet, e.g.
                    // once GOtv/StarTimes picks are added) falls back to
                    // the plain price row.
                    const hotOfferImage = category === "Hot Offers" ? getHotOfferImage(p.name, provider) : null;
                    if (hotOfferImage) {
                      return (
                        <button
                          type="button"
                          key={p.code}
                          onClick={() => setPlanId(p.code)}
                          className={clsx(
                            "relative aspect-[16/9] overflow-hidden rounded-xl border text-left transition",
                            planId === p.code ? "border-accent ring-2 ring-accent/40" : "border-slate-200 hover:border-slate-300"
                          )}
                        >
                          <img src={hotOfferImage} alt={p.name} className="absolute inset-0 h-full w-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-3">
                            <span className="text-sm font-semibold text-white drop-shadow">{p.name}</span>
                            <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-slate-900">
                              {formatCurrency(p.price)}
                            </span>
                          </div>
                        </button>
                      );
                    }
                    return (
                      <button
                        type="button"
                        key={p.code}
                        onClick={() => setPlanId(p.code)}
                        className={clsx(
                          "flex items-center justify-between rounded-xl border px-4 py-3 text-left transition",
                          planId === p.code ? "border-accent bg-accent/10" : "border-slate-200 hover:border-slate-300"
                        )}
                      >
                        <span className="text-sm font-medium text-slate-900">{p.name}</span>
                        <span className="text-xs font-semibold text-accent">{formatCurrency(p.price)}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">{success}</p>}
          <Button type="submit" fullWidth loading={loading} icon={<TvIcon size={16} />}>
            Pay subscription
          </Button>
        </form>
      </Card>
    </div>
  );
}
