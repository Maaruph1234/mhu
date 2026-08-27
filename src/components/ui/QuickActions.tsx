import { Link } from "react-router-dom";
import { Smartphone, Wifi, Tv, Zap, GraduationCap, Send } from "lucide-react";

const actions = [
  { to: "/dashboard/airtime", label: "Airtime", icon: Smartphone },
  { to: "/dashboard/data", label: "Data", icon: Wifi },
  { to: "/dashboard/tv", label: "TV", icon: Tv },
  { to: "/dashboard/electricity", label: "Electricity", icon: Zap },
  { to: "/dashboard/exam-pins", label: "Exam Pins", icon: GraduationCap },
  { to: "/dashboard/transfer", label: "Transfer", icon: Send },
];

export function QuickActions() {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
      {actions.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="card-surface flex flex-col items-center gap-2 px-3 py-5 text-center transition hover:border-accent/30"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Icon size={20} />
          </div>
          <span className="text-xs font-medium text-slate-600">{label}</span>
        </Link>
      ))}
    </div>
  );
}
