import { useState } from "react";
import { GraduationCap } from "lucide-react";
import clsx from "clsx";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { EXAM_BODIES } from "../../data/reference";
import { purchase } from "../../lib/vtpass";
import { useWallet } from "../../context/WalletContext";
import { formatCurrency } from "../../lib/format";

export default function ExamPins() {
  const { refresh } = useWallet();
  const [examId, setExamId] = useState(EXAM_BODIES[0].id);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const exam = EXAM_BODIES.find((e) => e.id === examId)!;
  const total = exam.price * quantity;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const result = await purchase({
        service: "exam-pin",
        serviceId: examId,
        quantity,
        amount: total,
      });
      if (!result.success) throw new Error(result.message);
      setSuccess(`${quantity} ${exam.name} pin(s) purchased. Ref: ${result.reference}`);
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
        <h1 className="text-2xl font-bold text-slate-900">Exam pins</h1>
        <p className="mt-1 text-sm text-slate-500">Buy WAEC and NECO result checker pins instantly.</p>
      </div>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">Exam body</p>
            <div className="grid grid-cols-2 gap-2.5">
              {EXAM_BODIES.map((e) => (
                <button
                  type="button"
                  key={e.id}
                  onClick={() => setExamId(e.id)}
                  className={clsx(
                    "rounded-xl border px-4 py-3 text-left transition",
                    examId === e.id ? "border-accent bg-accent/10" : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  <p className="text-sm font-semibold text-slate-900">{e.name}</p>
                  <p className="text-xs text-slate-500">{formatCurrency(e.price)} / pin</p>
                </button>
              ))}
            </div>
          </div>
          <Input
            label="Quantity"
            type="number"
            min={1}
            max={20}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
          <p className="text-sm text-slate-500">
            Total: <span className="font-semibold text-slate-900">{formatCurrency(total)}</span>
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">{success}</p>}
          <Button type="submit" fullWidth loading={loading} icon={<GraduationCap size={16} />}>
            Buy pin
          </Button>
        </form>
      </Card>
    </div>
  );
}
