import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Smartphone,
  Wifi,
  Tv,
  Zap,
  GraduationCap,
  Send,
  CreditCard,
  History,
  Gift,
  User as UserIcon,
  LogOut,
  Menu,
} from "lucide-react";
import clsx from "clsx";
import { Logo } from "../ui/Logo";
import { useAuth } from "../../context/AuthContext";
import { initials } from "../../lib/format";

const nav = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/dashboard/airtime", label: "Airtime", icon: Smartphone },
  { to: "/dashboard/data", label: "Data", icon: Wifi },
  { to: "/dashboard/tv", label: "TV Subscription", icon: Tv },
  { to: "/dashboard/electricity", label: "Electricity", icon: Zap },
  { to: "/dashboard/exam-pins", label: "Exam Pins", icon: GraduationCap },
  { to: "/dashboard/transfer", label: "Transfer", icon: Send },
  { to: "/dashboard/cards", label: "Virtual Cards", icon: CreditCard },
  { to: "/dashboard/transactions", label: "Transactions", icon: History },
  { to: "/dashboard/referrals", label: "Referrals", icon: Gift },
  { to: "/dashboard/profile", label: "Profile", icon: UserIcon },
];

export function DashboardLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const SidebarContent = (
    <div className="flex h-full flex-col">
      <div className="px-6 py-6">
        <Logo to="/dashboard" />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 scrollbar-thin">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition",
                isActive ? "bg-accent/10 text-accent" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              )
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-4">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
        >
          <LogOut size={18} />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      <div className="hidden w-64 shrink-0 border-r border-slate-200 lg:fixed lg:inset-y-0 lg:flex">
        {SidebarContent}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">{SidebarContent}</div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-4 backdrop-blur lg:px-8">
          <button className="text-slate-600 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 sm:block">
              {profile?.display_name ?? "Welcome"}
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
              {profile ? initials(profile.display_name || profile.email || "") : <UserIcon size={16} />}
            </div>
          </div>
        </header>
        <main className="px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
