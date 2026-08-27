import { type InputHTMLAttributes, forwardRef, type ReactNode } from "react";
import clsx from "clsx";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, suffix, className, id, ...props }, ref) => {
    const inputId = id ?? props.name;
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-slate-600">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={clsx(
              "w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20",
              icon ? "pl-10" : "pl-3.5",
              suffix ? "pr-16" : "pr-3.5",
              error && "border-red-500/60 focus:border-red-500/60 focus:ring-red-500/20",
              className
            )}
            {...props}
          />
          {suffix && (
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
              {suffix}
            </span>
          )}
        </div>
        {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";
