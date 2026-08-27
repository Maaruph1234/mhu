import { type ReactNode } from "react";
import { MarketingNavbar } from "./MarketingNavbar";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNavbar />
      <div className="flex items-center justify-center bg-grid-glow px-4 py-16">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="card-surface p-8">
            <h1 className="mb-1.5 text-2xl font-bold text-slate-900">{title}</h1>
            {subtitle && <p className="mb-6 text-sm text-slate-500">{subtitle}</p>}
            {!subtitle && <div className="mb-6" />}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
