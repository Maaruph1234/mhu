import { type InputHTMLAttributes, forwardRef, type ReactNode, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import clsx from "clsx";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, suffix, className, id, type, ...props }, ref) => {
    const inputId = id ?? props.name;
    // Any type="password" input automatically gets a show/hide toggle --
    // no per-call-site opt-in needed, matching the Flutter app's
    // MhuTextField.isPassword behavior (lib/shared/widgets/mhu_text_field.dart).
    const isPassword = type === "password";
    const [showPassword, setShowPassword] = useState(false);
    const resolvedType = isPassword ? (showPassword ? "text" : "password") : type;
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
            type={resolvedType}
            className={clsx(
              "w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20",
              icon ? "pl-10" : "pl-3.5",
              isPassword ? "pr-11" : suffix ? "pr-16" : "pr-3.5",
              error && "border-red-500/60 focus:border-red-500/60 focus:ring-red-500/20",
              className
            )}
            {...props}
          />
          {isPassword ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          ) : (
            suffix && (
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                {suffix}
              </span>
            )
          )}
        </div>
        {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";
