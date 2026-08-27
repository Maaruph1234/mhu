import { Smartphone, Wifi, Tv, Zap } from "lucide-react";

const badges = [
  { icon: Smartphone, label: "Airtime", top: "8%", left: "-4%" },
  { icon: Wifi, label: "Data", top: "20%", right: "-6%" },
  { icon: Tv, label: "TV", bottom: "22%", left: "-8%" },
  { icon: Zap, label: "Electricity", bottom: "6%", right: "-2%" },
];

export function Globe() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-md">
      <svg viewBox="0 0 400 400" className="h-full w-full" aria-hidden="true">
        <defs>
          <radialGradient id="sphere" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#3D5AFE" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#1a2a6b" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#03060d" stopOpacity="0.9" />
          </radialGradient>
        </defs>
        <circle cx="200" cy="200" r="150" fill="url(#sphere)" />
        <circle cx="200" cy="200" r="150" fill="none" stroke="#3D5AFE" strokeOpacity="0.25" strokeWidth="1" />

        <g className="origin-center animate-spin-slower" style={{ transformOrigin: "200px 200px" }}>
          <ellipse cx="200" cy="200" rx="150" ry="55" fill="none" stroke="#7C93FF" strokeOpacity="0.35" strokeWidth="1" />
          <ellipse cx="200" cy="200" rx="150" ry="100" fill="none" stroke="#7C93FF" strokeOpacity="0.28" strokeWidth="1" />
          <ellipse cx="200" cy="200" rx="150" ry="150" fill="none" stroke="#7C93FF" strokeOpacity="0.2" strokeWidth="1" />
        </g>
        <g className="origin-center animate-spin-slow-reverse" style={{ transformOrigin: "200px 200px" }}>
          <ellipse cx="200" cy="200" rx="55" ry="150" fill="none" stroke="#7C93FF" strokeOpacity="0.3" strokeWidth="1" />
          <ellipse cx="200" cy="200" rx="100" ry="150" fill="none" stroke="#7C93FF" strokeOpacity="0.22" strokeWidth="1" />
        </g>

        <circle cx="200" cy="200" r="150" fill="none" stroke="#3D5AFE" strokeOpacity="0.5" strokeWidth="1.5" />
        <circle cx="140" cy="130" r="3" fill="#8EA1FF" className="animate-pulse-soft" />
        <circle cx="270" cy="160" r="2.5" fill="#8EA1FF" className="animate-pulse-soft" />
        <circle cx="230" cy="290" r="2.5" fill="#8EA1FF" className="animate-pulse-soft" />
      </svg>

      {badges.map((b, i) => (
        <div
          key={i}
          style={{ top: b.top, bottom: b.bottom, left: b.left, right: b.right, animationDelay: `${i * 0.4}s` }}
          className="absolute flex animate-float items-center gap-2 rounded-full bg-night-900/90 px-3.5 py-2 shadow-lg ring-1 ring-white/10 backdrop-blur transition-transform duration-300 will-change-transform hover:scale-110"
        >
          <b.icon size={14} className="text-accent-400" />
          <span className="text-xs font-medium text-white">{b.label}</span>
        </div>
      ))}
    </div>
  );
}
