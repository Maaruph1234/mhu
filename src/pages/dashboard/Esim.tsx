import { useEffect, useState } from "react";
import { Wifi, QrCode, Star, Gauge, Globe2 } from "lucide-react";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import * as esim from "../../lib/esim";
import type { EsimOrder, EsimPackage, EsimRegion } from "../../types";

// eSIM data packages for international travel, via Payvessel's VaaS eSIM
// API. See supabase/functions/payvessel-esim/index.ts for the full design
// reasoning (price comes straight from Payvessel's price_naira, no
// conversion guesswork).

function flattenRegions(regions: EsimRegion[]): EsimRegion[] {
  const out: EsimRegion[] = [];
  for (const r of regions) {
    out.push(r);
    if (r.sub_locations?.length) out.push(...flattenRegions(r.sub_locations));
  }
  return out;
}

function formatVolume(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(gb % 1 === 0 ? 0 : 1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

export default function Esim() {
  const [regions, setRegions] = useState<EsimRegion[]>([]);
  const [locationCode, setLocationCode] = useState("");
  const [packages, setPackages] = useState<EsimPackage[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [orders, setOrders] = useState<EsimOrder[]>([]);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    esim.listRegions().then((list) => setRegions(flattenRegions(list)));
    esim.listOrders().then(setOrders);
  }, []);

  useEffect(() => {
    setLoadingPackages(true);
    esim
      .listPackages(locationCode || undefined)
      .then(setPackages)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingPackages(false));
  }, [locationCode]);

  const handleBuy = async (pkg: EsimPackage) => {
    setError(null);
    setSuccess(null);
    setBuying(pkg.package_code);
    try {
      const order = await esim.createOrder(pkg.package_code);
      setOrders((o) => [order, ...o]);
      setSuccess(`${pkg.name} purchased. Check "My eSIMs" below for your QR code once it's ready.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBuying(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-2xl bg-gradient-to-br from-accent/10 to-accent/5 p-5">
        <div className="flex items-center gap-2 text-accent">
          <Globe2 size={20} />
          <h1 className="text-2xl font-bold text-slate-900">eSIM data packages</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">Stay connected abroad with an instant eSIM data plan.</p>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-600">Destination</p>
        <select
          value={locationCode}
          onChange={(e) => setLocationCode(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
        >
          <option value="">All destinations</option>
          {regions.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500">{error}</p>}
      {success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-600">{success}</p>}

      {loadingPackages ? (
        <p className="text-sm text-slate-500">Loading packages…</p>
      ) : (
        <div className="space-y-3">
          {!packages.length && <p className="text-sm text-slate-500">No packages found for this destination.</p>}
          {packages.map((pkg) => (
            <Card key={pkg.package_code} className="relative overflow-hidden">
              {pkg.favorite && (
                <span className="absolute right-0 top-0 flex items-center gap-1 rounded-bl-lg bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-600">
                  <Star size={10} className="fill-amber-500 text-amber-500" /> Popular
                </span>
              )}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                    <Wifi size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{pkg.name}</p>
                    <p className="text-xs text-slate-500">
                      {pkg.location} · {formatVolume(pkg.volume_bytes)} · {pkg.duration} {pkg.duration_unit}
                    </p>
                    {pkg.speed && (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                        <Gauge size={11} /> {pkg.speed}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-900">
                    {pkg.price_naira != null ? `₦${Math.round(pkg.price_naira).toLocaleString()}` : `$${pkg.price_usd}`}
                  </p>
                  <Button size="sm" className="mt-1" loading={buying === pkg.package_code} onClick={() => handleBuy(pkg)}>
                    Buy
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>My eSIMs</CardTitle>
        </CardHeader>
        {!orders.length && <p className="text-sm text-slate-500">No eSIM purchases yet.</p>}
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Wifi size={18} />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">{o.package_name}</p>
                  <p className="text-xs text-slate-500">{o.location} · {o.status}</p>
                </div>
              </div>
              {o.qr_code_url ? (
                <a
                  href={o.qr_code_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  <QrCode size={14} /> QR code
                </a>
              ) : (
                <span className="text-xs text-slate-400">Provisioning…</span>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
