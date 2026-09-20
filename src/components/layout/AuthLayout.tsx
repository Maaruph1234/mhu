import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { VideoBackdrop } from "../marketing/VideoBackdrop";
import "../../pages/marketing/mhu-theme.css";

// Shared shell for every auth page (Login, Register, Verify OTP, Forgot/Reset
// Password) -- full-screen looping video background behind a glass-white
// form card, matching the marketing hero's look. See mhu-theme.css for the
// video-backdrop/nav/pill classes shared with the rest of the homepage.

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#03060d]">
      <VideoBackdrop />

      <header className="mhu-video-nav">
        <Link to="/" className="mhu-logo-link">
          <img src="/logo.png" alt="MHU Global" />
        </Link>
        <div className="mhu-nav-pill">
          <Link to="/login" className="pill-login">
            Log in
          </Link>
          <Link to="/register" className="pill-start">
            <span className="dot" />
            Get started
          </Link>
        </div>
      </header>

      <div className="relative z-10 flex items-center justify-center px-4 py-12 sm:py-16">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="card-surface p-8 shadow-2xl shadow-black/40">
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
