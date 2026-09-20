import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "../../pages/marketing/hero.css";

// Video-background hero, ported from a self-contained index.html design
// spec into this React app. Structure/behavior/timings are kept faithful to
// that spec (reference-pixel --u scaling system, masked-line headline
// entrance, video cross-fade to hide the loop seam) -- see hero.css's header
// comment for what had to change to embed safely (scoped selectors, no
// global html/body overflow lock). Copy/branding swapped for MHU Global;
// the original spec's assets (globe video/poster) are generic stock/AI-
// generated background footage, not brand-specific, so kept as-is per the
// spec's "use these URLs verbatim" instruction.

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260912_104036_bd6924f6-3c8e-417e-8465-6d03c8c2e9e6.mp4";
const POSTER_SRC =
  "https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/82e7eb75-c65f-490a-99b5-f3d1cad54200.webp";

const NAV_LINKS = [
  { label: "Services", href: "#services" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Security", href: "#security" },
  { label: "FAQ", href: "#faq" },
];

function Arrow({ className = "arw" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 10" fill="none" aria-hidden="true">
      <path
        d="M0.8 5h10M7.1 1.4 10.9 5l-3.8 3.6"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);

  const [menuOpen, setMenuOpen] = useState(false);

  // Checked once, synchronously, during the initial render -- matches the
  // spec's requirement that the entrance system "arm synchronously so there
  // is no flash of unanimated content." A user with reduced-motion never
  // enters the 'armed'/'go' states at all: the page renders in its finished
  // form immediately.
  const [reducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [phase, setPhase] = useState<"armed" | "go" | "done">(() => (reducedMotion ? "done" : "armed"));

  // --- A) Entrance sequence: boot (wait for fonts, 900ms ceiling) ---
  useEffect(() => {
    if (reducedMotion || phase !== "armed") return;
    let cancelled = false;
    const start = () => {
      if (!cancelled) setPhase("go");
    };
    const ceiling = setTimeout(start, 900);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) {
      fonts.ready.then(start, start);
    }
    return () => {
      cancelled = true;
      clearTimeout(ceiling);
    };
  }, [reducedMotion, phase]);

  // --- A) Entrance sequence: detach once the last tween (ghost CTA) ends ---
  useEffect(() => {
    if (phase !== "go") return;
    const root = heroRef.current;
    if (!root) return;
    const onEnd = (e: AnimationEvent) => {
      const target = e.target as HTMLElement;
      if (e.animationName === "mhuHeroPillIn" && target.classList.contains("btn-ghost")) {
        setPhase("done");
      }
    };
    root.addEventListener("animationend", onEnd, true);
    const safety = setTimeout(() => setPhase("done"), 2600);
    return () => {
      root.removeEventListener("animationend", onEnd, true);
      clearTimeout(safety);
    };
  }, [phase]);

  // --- B) Burger menu ---
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || burgerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        burgerRef.current?.focus();
      }
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // --- C) Background video cross-fade (hides the loop seam) ---
  useEffect(() => {
    const A = videoARef.current;
    const B = videoBRef.current;
    if (!A || !B) return;

    if (reducedMotion) {
      A.removeAttribute("autoplay");
      A.pause();
      B.pause();
      try {
        A.currentTime = 0;
      } catch {
        // ignore -- autoplay may already have advanced a frame or two
      }
      return;
    }

    const FADE = 0.9;
    let cur = A;
    let nxt = B;
    let swapping = false;

    const play = (v: HTMLVideoElement) => {
      v.play()?.catch(() => {
        // Some browsers ignore the autoplay attribute until play() is
        // called explicitly -- the rejection here is expected/harmless.
      });
    };
    play(A);

    const tick = () => {
      if (swapping || !cur.duration) return;
      if (cur.duration - cur.currentTime > FADE) return;

      swapping = true;
      const out = cur;
      nxt.currentTime = 0;
      play(nxt);
      nxt.classList.add("is-active");
      out.classList.remove("is-active");
      [cur, nxt] = [nxt, cur];

      setTimeout(() => {
        out.pause();
        out.currentTime = 0;
        swapping = false;
      }, FADE * 1000 + 100);
    };

    A.addEventListener("timeupdate", tick);
    B.addEventListener("timeupdate", tick);
    return () => {
      A.removeEventListener("timeupdate", tick);
      B.removeEventListener("timeupdate", tick);
    };
  }, [reducedMotion]);

  const heroClass = ["mhu-hero", phase !== "done" ? "anim" : "", phase === "go" ? "go" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={heroClass} ref={heroRef}>
      <div className="bg" role="img" aria-label="Stylised globe of Earth rendered as a purple dot matrix against a starfield, slowly rotating">
        <video
          ref={videoARef}
          className="bg-video is-active"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          poster={POSTER_SRC}
        >
          <source src={VIDEO_SRC} type="video/mp4" />
        </video>
        <video
          ref={videoBRef}
          className="bg-video"
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          poster={POSTER_SRC}
        >
          <source src={VIDEO_SRC} type="video/mp4" />
        </video>
      </div>

      <header className="nav">
        <Link to="/" className="logo">
          <img src="/logo.png" alt="MHU Global" />
        </Link>

        <nav className="nav-links" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="nav-actions">
          <div className="nav-pill">
            <Link to="/login" className="pill-login">
              Log in
            </Link>
            <Link to="/register" className="pill-start">
              <span className="dot" />
              Get started
            </Link>
          </div>
        </div>

        <button
          ref={burgerRef}
          id="burger"
          className="burger"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mhu-hero-menu"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <span />
        </button>
      </header>

      <nav
        ref={menuRef}
        id="mhu-hero-menu"
        className={`menu${menuOpen ? " open" : ""}`}
        aria-label="Mobile"
      >
        {NAV_LINKS.map((l) => (
          <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>
            {l.label}
          </a>
        ))}
        <div className="divider" />
        <Link to="/login" onClick={() => setMenuOpen(false)}>
          Log in
        </Link>
        <Link to="/register" className="m-start" onClick={() => setMenuOpen(false)}>
          <span className="dot" />
          Get started
        </Link>
      </nav>

      <div className="hero-inner">
        <h1>
          <span className="ln">
            <span className="ln-i">Pay bills.</span>
          </span>
          <span className="ln">
            <span className="ln-i">Send money.</span>
          </span>
        </h1>
        <p className="sub">
          Buy airtime, data, and TV subscriptions in seconds,
          <br />
          pay electricity bills and send money to anyone instantly,
          <br />
          all from one secure wallet in your pocket.
        </p>
        <div className="ctas">
          <Link to="/register" className="btn btn-lg btn-primary">
            Get Started
            <Arrow />
          </Link>
          <a href="#how-it-works" className="btn btn-lg btn-ghost">
            How it works
            <Arrow />
          </a>
        </div>
      </div>
    </main>
  );
}
