import { Link } from "react-router-dom";
import clsx from "clsx";

export function Logo({
  to = "/",
  showWordmark = false,
  size = "lg",
  className,
}: {
  to?: string;
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizeClasses = {
    sm: "h-12 w-12",
    md: "h-16 w-16",
    lg: "h-20 w-20",
    xl: "h-32 w-32",
  }[size];

  const textClasses = {
    sm: "text-base",
    md: "text-xl",
    lg: "text-2xl",
    xl: "text-3xl",
  }[size];

  return (
    <Link to={to} className="flex shrink-0 items-center gap-3">
      <img
        src="/logo.png"
        alt="MHU Global"
        className={clsx(className ?? sizeClasses, "rounded-full object-cover")}
      />
      {showWordmark && (
        <span className={clsx(textClasses, "font-bold tracking-tight text-slate-900")}>
          MHU <span className="text-accent">Global</span>
        </span>
      )}
    </Link>
  );
}
