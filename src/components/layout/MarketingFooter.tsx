import { Logo } from "../ui/Logo";
import { StoreBadges } from "../ui/StoreBadges";

const year = new Date().getFullYear();

export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white py-14">
      <div className="container-xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-slate-500">
              One wallet for airtime, data, TV, electricity, exam pins and instant transfers.
            </p>
          </div>
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Company</div>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="#" className="hover:text-slate-900">About</a></li>
              <li><a href="#" className="hover:text-slate-900">Careers</a></li>
              <li><a href="#" className="hover:text-slate-900">Contact</a></li>
            </ul>
          </div>
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Services</div>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="#services" className="hover:text-slate-900">Airtime &amp; Data</a></li>
              <li><a href="#services" className="hover:text-slate-900">TV Subscription</a></li>
              <li><a href="#services" className="hover:text-slate-900">Electricity</a></li>
              <li><a href="#services" className="hover:text-slate-900">Transfers</a></li>
            </ul>
          </div>
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Get the app</div>
            <StoreBadges />
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-4 border-t border-slate-200 pt-6 text-xs text-slate-500 md:flex-row md:items-center md:justify-between">
          <p>&copy; {year} MHU Global. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-slate-900">Privacy Policy</a>
            <a href="#" className="hover:text-slate-900">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
