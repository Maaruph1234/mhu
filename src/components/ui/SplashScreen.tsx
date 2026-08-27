import { useEffect, useState } from "react";

// Shown once per full page load (not on in-app route changes). Pure CSS
// animation + a couple of timeouts — no extra libraries, negligible cost.
export function SplashScreen() {
  const [mounted, setMounted] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 2200);
    const unmountTimer = setTimeout(() => setMounted(false), 2700);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(unmountTimer);
    };
  }, []);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-slate-900 transition-opacity duration-500 ease-out ${
        fading ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      aria-hidden="true"
    >
      <img
        src="/splash-delivery.jpg"
        alt=""
        className="h-full w-full animate-scale-in object-cover"
      />
    </div>
  );
}
