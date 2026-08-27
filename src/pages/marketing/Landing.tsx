import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Smartphone,
  Wifi,
  Tv,
  Zap,
  GraduationCap,
  Send,
  ShieldCheck,
  Gauge,
  Users,
  ChevronDown,
} from "lucide-react";
import { MarketingNavbar } from "../../components/layout/MarketingNavbar";
import { MarketingFooter } from "../../components/layout/MarketingFooter";
import { StoreBadges } from "../../components/ui/StoreBadges";
import { Globe } from "../../components/ui/Globe";

const services = [
  { icon: Smartphone, title: "Airtime top-up", desc: "Instant recharge across MTN, Airtel, Glo and 9mobile." },
  { icon: Wifi, title: "Data bundles", desc: "Buy data plans for every network at the best rates." },
  { icon: Tv, title: "TV subscription", desc: "Renew DStv, GOtv and StarTimes in seconds." },
  { icon: Zap, title: "Electricity bills", desc: "Pay prepaid and postpaid bills across every disco." },
  { icon: GraduationCap, title: "Exam pins", desc: "WAEC and NECO result checker pins, delivered instantly." },
  { icon: Send, title: "Instant transfers", desc: "Send money to any MHU Global user, free and instant." },
];

const steps = [
  { n: "1", title: "Create your account", desc: "Sign up with your phone number and verify with a one-time SMS code." },
  { n: "2", title: "Fund your wallet", desc: "Top up your MHU Global wallet with a bank transfer or card." },
  { n: "3", title: "Pay for anything", desc: "Airtime, data, TV, electricity, exam pins or a transfer — all from one balance." },
];

const faqs = [
  {
    q: "Is MHU Global free to use?",
    a: "Creating an account and holding a wallet balance is free. Standard service fees apply only to certain bill payments, shown before you confirm any transaction.",
  },
  {
    q: "How fast are airtime and data purchases?",
    a: "Most purchases complete in a few seconds. If a network operator is temporarily slow, we automatically retry and refund your wallet if the purchase can't be completed.",
  },
  {
    q: "Is my money safe?",
    a: "Your wallet balance is held securely and every transaction is logged to an auditable ledger. We never store your card or bank details on our servers.",
  },
  {
    q: "Which networks and providers are supported?",
    a: "All major Nigerian networks (MTN, Airtel, Glo, 9mobile), TV providers (DStv, GOtv, StarTimes), and electricity distribution companies nationwide.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-surface overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-6 py-5 text-left"
      >
        <span className="font-medium text-slate-900">{q}</span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-6 pb-5 text-sm leading-relaxed text-slate-500">{a}</div>}
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNavbar />

      {/* Hero */}
      <section className="bg-white pt-6 sm:pt-10">
        <div className="container-xl">
          <div className="relative overflow-hidden rounded-3xl bg-night-950 px-6 py-16 sm:px-10 lg:px-14 lg:py-24">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(61,90,254,0.18),transparent_50%)]" />
            <div className="relative grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h1
              className="max-w-xl animate-fade-in-up text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl"
              style={{ animationDelay: "0.05s" }}
            >
              Moving money{" "}
              <span className="text-accent-400">at internet speed</span>
            </h1>
            <p
              className="mt-6 max-w-lg animate-fade-in-up text-base text-slate-400 lg:text-lg"
              style={{ animationDelay: "0.2s" }}
            >
              Airtime, data, TV subscriptions, electricity bills, exam pins and instant transfers —
              all from a single MHU Global wallet.
            </p>
            <div
              className="mt-9 flex animate-fade-in-up flex-col gap-4 sm:flex-row"
              style={{ animationDelay: "0.35s" }}
            >
              <Link
                to="/register"
                className="press-glass inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-accent-600"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
                Create free account
              </Link>
              <Link
                to="/login"
                className="press-glass inline-flex items-center justify-center gap-2 rounded-full border border-white/25 px-6 py-3 text-xs font-bold uppercase tracking-wide text-white transition hover:border-accent-400/60 hover:bg-white/5"
              >
                I already have an account
              </Link>
            </div>
            <div className="mt-10 animate-fade-in-up" style={{ animationDelay: "0.5s" }}>
              <StoreBadges variant="light" />
            </div>
          </div>
          <div className="animate-scale-in" style={{ animationDelay: "0.25s" }}>
            <Globe />
          </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="container-xl py-20">
        <div className="mb-14 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Services</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 lg:text-4xl">Everything you pay for, in one place</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s, i) => (
            <div key={s.title} className="group card-surface p-6 transition hover:border-accent/30">
              <div
                className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent transition-transform duration-300 will-change-transform animate-float group-hover:scale-110 group-hover:rotate-6"
                style={{ animationDelay: `${i * 0.15}s` }}
              >
                <s.icon size={22} />
              </div>
              <h3 className="mb-1.5 font-semibold text-slate-900">{s.title}</h3>
              <p className="text-sm leading-relaxed text-slate-500">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust strip */}
      <section className="bg-white py-6">
        <div className="container-xl">
          <div className="grid gap-8 rounded-3xl border border-accent-100 bg-accent-50/50 px-6 py-12 sm:grid-cols-3 sm:px-10">
          <div className="flex items-start gap-4">
            <ShieldCheck className="mt-1 h-6 w-6 shrink-0 animate-float text-accent will-change-transform" />
            <div>
              <h4 className="font-semibold text-slate-900">Secure by design</h4>
              <p className="mt-1 text-sm text-slate-500">SMS verification on every login and every device.</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <Gauge
              className="mt-1 h-6 w-6 shrink-0 animate-float text-accent will-change-transform"
              style={{ animationDelay: "0.3s" }}
            />
            <div>
              <h4 className="font-semibold text-slate-900">Instant settlement</h4>
              <p className="mt-1 text-sm text-slate-500">Purchases and transfers confirm in real time.</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <Users
              className="mt-1 h-6 w-6 shrink-0 animate-float text-accent will-change-transform"
              style={{ animationDelay: "0.6s" }}
            />
            <div>
              <h4 className="font-semibold text-slate-900">Built for everyone</h4>
              <p className="mt-1 text-sm text-slate-500">Simple enough for anyone, powerful enough for daily use.</p>
            </div>
          </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="container-xl py-24">
        <div className="mb-14 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">How it works</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 lg:text-4xl">Get started in minutes</h2>
        </div>
        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="relative pl-4">
              <div className="mb-4 text-5xl font-extrabold text-slate-900/10">{s.n}</div>
              <h3 className="mb-2 font-semibold text-slate-900">{s.title}</h3>
              <p className="text-sm leading-relaxed text-slate-500">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="container-xl py-20">
        <div className="mb-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">FAQ</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 lg:text-4xl">Common questions</h2>
        </div>
        <div className="mx-auto max-w-2xl space-y-3">
          {faqs.map((f) => (
            <FaqItem key={f.q} {...f} />
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container-xl pb-24">
        <div className="relative flex flex-col items-center gap-6 overflow-hidden rounded-2xl bg-gradient-to-br from-accent to-accent-700 px-8 py-14 text-center shadow-glow">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <h2 className="max-w-lg text-3xl font-bold text-white">Ready to move money at internet speed?</h2>
          <Link to="/register">
            <button className="press-glass inline-flex items-center justify-center rounded-full bg-white px-7 py-3.5 text-base font-semibold text-accent transition hover:bg-white/90">
              Create your free account
            </button>
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
