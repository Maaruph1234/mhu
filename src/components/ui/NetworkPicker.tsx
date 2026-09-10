import clsx from "clsx";
import type { Network } from "../../types";

export function NetworkPicker({
  networks,
  value,
  onChange,
}: {
  networks: Network[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {networks.map((n) => (
        <button
          type="button"
          key={n.id}
          onClick={() => onChange(n.id)}
          className={clsx(
            "flex flex-col items-center gap-2 rounded-xl border py-4 transition",
            value === n.id ? "border-accent bg-accent/5" : "border-slate-200 hover:border-slate-300"
          )}
        >
          {n.logo ? (
            <img src={n.logo} alt={n.name} className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-slate-900"
              style={{ backgroundColor: n.color }}
            >
              {n.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <span className="text-xs font-medium text-slate-600">{n.name}</span>
        </button>
      ))}
    </div>
  );
}
