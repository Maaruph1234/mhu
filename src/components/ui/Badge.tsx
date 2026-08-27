import clsx from "clsx";

type Tone = "success" | "pending" | "failed" | "neutral";

const toneClasses: Record<Tone, string> = {
  success: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-700",
  neutral: "bg-slate-100 text-slate-600",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize", toneClasses[tone])}>
      {children}
    </span>
  );
}
