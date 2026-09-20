import { Logo } from "../ui/Logo";
import { StoreBadges } from "../ui/StoreBadges";

const year = new Date().getFullYear();

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#03060d] py-14">
      <div className="container-xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-slate-400">
              One wallet for airtime, data, TV, electricity, exam pins and instant transfers.
            </p>
          </div>
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Company</div>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><a href="#" className="hover:text-white">About</a></li>
              <li><a href="#" className="hover:text-white">Careers</a></li>
              <li><a href="#" className="hover:text-white">Contact</a></li>
            </ul>
          </div>
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Services</div>
            <ul className="space-y-2 text-sm text-slate-400">
              <li><a href="#services" className="hover:text-white">Airtime &amp; Data</a></li>
              <li><a href="#services" className="hover:text-white">TV Subscription</a></li>
              <li><a href="#services" className="hover:text-white">Electricity</a></li>
              <li><a href="#services" className="hover:text-white">Transfers</a></li>
            </ul>
          </div>
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Get the app</div>
            <StoreBadges />
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-6 text-xs text-slate-400 md:flex-row md:items-center md:justify-between">
          <p>&copy; {year} MHU Global. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white">Privacy Policy</a>
            <a href="#" className="hover:text-white">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
