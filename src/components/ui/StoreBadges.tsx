// REPLACE: once MHU Global is live on both stores, set VITE_APP_STORE_URL and
// VITE_PLAY_STORE_URL in your .env to the real listing URLs — these default
// to "#" placeholders until then.

const APP_STORE_URL = (import.meta.env.VITE_APP_STORE_URL as string) || "#";
const PLAY_STORE_URL = (import.meta.env.VITE_PLAY_STORE_URL as string) || "#";

export function StoreBadges({
  className = "",
  variant = "dark",
}: {
  className?: string;
  variant?: "dark" | "light";
}) {
  const badgeClass =
    variant === "dark"
      ? "bg-slate-900 hover:bg-slate-800"
      : "bg-white/10 ring-1 ring-white/15 hover:bg-white/15 backdrop-blur";
  const subTextClass = variant === "dark" ? "text-slate-300" : "text-slate-400";

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noreferrer"
        className={`flex items-center gap-2.5 rounded-xl px-4 py-2.5 transition ${badgeClass}`}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white">
          <path d="M17.05 12.536c-.03-2.99 2.44-4.42 2.55-4.49-1.39-2.03-3.55-2.31-4.32-2.34-1.84-.19-3.6 1.08-4.53 1.08-.93 0-2.36-1.06-3.88-1.03-2 .03-3.84 1.16-4.87 2.95-2.07 3.6-.53 8.94 1.49 11.86.99 1.43 2.17 3.04 3.72 2.98 1.5-.06 2.06-.96 3.87-.96 1.8 0 2.32.96 3.9.93 1.61-.03 2.63-1.46 3.61-2.9 1.14-1.66 1.61-3.27 1.64-3.35-.04-.02-3.14-1.2-3.17-4.77zM14.24 4.02c.82-1 1.38-2.38 1.23-3.77-1.19.05-2.63.79-3.48 1.78-.76.88-1.43 2.3-1.25 3.65 1.32.1 2.67-.67 3.5-1.66z" />
        </svg>
        <div className="text-left leading-tight">
          <div className={`text-[10px] ${subTextClass}`}>Download on the</div>
          <div className="text-sm font-semibold text-white">App Store</div>
        </div>
      </a>
      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noreferrer"
        className={`flex items-center gap-2.5 rounded-xl px-4 py-2.5 transition ${badgeClass}`}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6">
          <path d="M3.6 2.4c-.4.3-.6.8-.6 1.4v16.4c0 .6.2 1.1.6 1.4l.1.1L13 12.9v-.2L3.7 2.3z" fill="#00d3ff" />
          <path d="M16.1 15.9 13 12.9v-.2l3.1-3 3.6 2c1 .6 1 1.5 0 2.1z" fill="#ffde00" />
          <path d="M16.1 15.9 13 12.7 3.7 22c.3.3.8.4 1.4.1z" fill="#ff3a44" />
          <path d="M16.1 9.5 5.1 3.1c-.6-.3-1.1-.2-1.4.1L13 12.7z" fill="#00e676" />
        </svg>
        <div className="text-left leading-tight">
          <div className={`text-[10px] ${subTextClass}`}>GET IT ON</div>
          <div className="text-sm font-semibold text-white">Google Play</div>
        </div>
      </a>
    </div>
  );
}
