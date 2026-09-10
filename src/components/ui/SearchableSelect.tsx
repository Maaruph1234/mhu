import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import clsx from "clsx";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

/**
 * Dropdown with a search box over its option list -- replaces a native
 * <select> for lists long enough that scrolling through them is a real
 * problem (e.g. Payvessel's 40-90+ supported banks on Transfer's "Send to
 * bank" tab). Mirrors the bottom-sheet bank picker built for the Flutter
 * app (send_money_screen.dart's _BankPickerSheet) so both apps behave the
 * same way.
 */
export function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "Select…",
  loading = false,
  disabled = false,
}: {
  label?: string;
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      // Let the dropdown mount before focusing.
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full">
      {label && <p className="mb-1.5 text-sm font-medium text-slate-600">{label}</p>}
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20",
          disabled || loading ? "cursor-not-allowed text-slate-400" : "text-slate-900"
        )}
      >
        <span className={selected ? "text-slate-900" : "text-slate-500"}>
          {loading ? "Loading…" : selected?.label ?? placeholder}
        </span>
        <ChevronDown size={16} className="text-slate-400" />
      </button>

      {open && !disabled && !loading && (
        <div className="absolute z-20 mt-1.5 w-full rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="relative border-b border-slate-100 p-2">
            <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg border-none bg-slate-50 py-2 pl-8 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3.5 py-3 text-sm text-slate-400">No matches for "{query}"</p>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={clsx(
                  "block w-full px-3.5 py-2.5 text-left text-sm hover:bg-slate-50",
                  o.value === value ? "font-medium text-accent" : "text-slate-700"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
