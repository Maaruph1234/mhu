import { Link } from "react-router-dom";
import { Logo } from "../ui/Logo";

export function MarketingNavbar() {
  return (
    <header className="sticky top-0 z-50 bg-[#eef0fb]">
      <div className="container-xl flex h-24 items-center justify-between gap-3">
        <Logo className="h-12 w-12 rounded-full object-cover sm:h-16 sm:w-16 lg:h-20 lg:w-20" />

        <nav className="flex shrink-0 items-center gap-1 rounded-full bg-night-950 p-1.5 sm:p-2">
          <Link
            to="/login"
            className="press-glass whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-slate-300 transition hover:text-white sm:px-6 sm:py-2.5 sm:text-base"
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="press-glass inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-accent-600 sm:px-6 sm:py-2.5 sm:text-sm"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}
