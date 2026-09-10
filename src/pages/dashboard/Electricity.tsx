import { useState } from "react";
import { Zap } from "lucide-react";
import clsx from "clsx";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { SearchableSelect } from "../../components/ui/SearchableSelect";
import { DISCOS } from "../../data/reference";
import { purchase, verifyMeter } from "../../lib/vtpass";
import { useWallet } from "../../context/WalletContext";

export default function Electricity() {
  const { refresh } = useWallet();
  const [disco, setDisco] = useState(DISCOS[0].id);
  const [meterType, setMeterType] = useState<"prepaid" | "postpaid">("prepaid");
  const [meterNumber, setMeterNumber] = useState("");
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleVerify = async () => {
    setError(null);
    setCustomerName(null);
    setVerifying(true);
    try {
      const res = await verifyMeter(disco, meterNumber, meterType);
      setCustomerName(res.customerName);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setVerifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const result = await purchase({
        service: "electricity",
        serviceId: disco,
        meterNumber,
        meterType,
        amount: Number(amount),
      });
      if (!result.success) throw new Error(result.message);
      setSuccess(`Token purchased for meter ${meterNumber}. Ref: ${result.reference}`);
      setAmount("");
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
        <h1 className="text-2xl font-bold text-slate-900">Electricity bill</h1>
        <p className="mt-1 text-sm text-slate-500">Pay prepaid or postpaid electricity bills.</p>
      </div>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <SearchableSelect
            label="Distribution company"
            value={disco}
            onChange={(v) => {
              setDisco(v);
              setCustomerName(null);
            }}
            options={DISCOS.map((d) => ({ value: d.id, label: `${d.fullName} (${d.name})` }))}
          />

          <div className="flex gap-2.5">
            {(["prepaid", "postpaid"] as const).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setMeterType(t)}
                className={clsx(
                  "flex-1 rounded-xl border py-2.5 text-sm font-medium capitalize transition",
                  meterType === t ? "border-accent bg-accent/10 text-slate-900" : "border-slate-200 text-slate-600 hover:border-slate-300"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Meter number"
                placeholder="01234567890"
                value={meterNumber}
                onChange={(e) => setMeterNumber(e.target.value)}
                required
              />
            </div>
            <Button type="button" variant="outline" loading={verifying} onClick={handleVerify} disabled={!meterNumber}>
              Verify
            </Button>
          </div>
          {customerName && <p className="-mt-2 text-sm text-emerald-400">Customer: {customerName}</p>}

          <Input
            label="Amount"
            type="number"
            placeholder="Enter amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min={500}
            required
          />

          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">{success}</p>}
          <Button type="submit" fullWidth loading={loading} icon={<Zap size={16} />}>
            Pay bill
          </Button>
        </form>
      </Card>
    </div>
  );
}
