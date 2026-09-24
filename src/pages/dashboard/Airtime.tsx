import { useState } from "react";
import { Smartphone } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { NetworkPicker } from "../../components/ui/NetworkPicker";
import { NETWORKS } from "../../data/reference";
import { purchase } from "../../lib/hadjibs";
import { useWallet } from "../../context/WalletContext";

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

export default function Airtime() {
  const { refresh } = useWallet();
  const [network, setNetwork] = useState(NETWORKS[0].id);
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const result = await purchase({
        service: "airtime",
        serviceId: network,
        phone,
        amount: Number(amount),
      });
      if (!result.success) throw new Error(result.message);
      setSuccess(`₦${amount} airtime sent to ${phone}. Ref: ${result.reference}`);
      setPhone("");
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
        <h1 className="text-2xl font-bold text-slate-900">Airtime top-up</h1>
        <p className="mt-1 text-sm text-slate-500">Recharge any Nigerian network instantly.</p>
      </div>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">Network</p>
            <NetworkPicker networks={NETWORKS} value={network} onChange={setNetwork} />
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
            <div className="mb-2 grid grid-cols-3 gap-2">
              {QUICK_AMOUNTS.map((a) => (
                <button
                  type="button"
                  key={a}
                  onClick={() => setAmount(String(a))}
                  className="rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:border-accent/50 hover:text-slate-900"
                >
                  ₦{a}
                </button>
              ))}
            </div>
            <Input
              label="Amount"
              type="number"
              placeholder="Enter amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={50}
              required
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">{success}</p>}
          <Button type="submit" fullWidth loading={loading} icon={<Smartphone size={16} />}>
            Buy airtime
          </Button>
        </form>
      </Card>
    </div>
  );
}
