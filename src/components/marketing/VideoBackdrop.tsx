import { useEffect, useRef, useState } from "react";

// Reusable video-background layer, factored out of Hero.tsx so the same
// crossfading globe footage can back other sections (the rest of the
// homepage, the auth pages) without duplicating the hero's own
// choreographed-entrance version of this logic.
//
// Usage: place inside a `position: relative; overflow: hidden` container.
// This component fills that container (`position: absolute; inset: 0`)
// via .mhu-video-backdrop in mhu-theme.css.
//
// Unlike the hero's copy, this version also pauses playback via
// IntersectionObserver when scrolled off-screen -- worthwhile here since a
// long page can end up with several of these at once.

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260912_104036_bd6924f6-3c8e-417e-8465-6d03c8c2e9e6.mp4";
const POSTER_SRC =
  "https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/82e7eb75-c65f-490a-99b5-f3d1cad54200.webp";

export function VideoBackdrop({
  className = "",
  overlay = true,
}: {
  className?: string;
  overlay?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);

  const [reducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    const A = aRef.current;
    const B = bRef.current;
    if (!A || !B) return;

    const play = (v: HTMLVideoElement) => {
      v.play()?.catch(() => {
        // Autoplay can be rejected until a user gesture on some browsers;
        // harmless here since these are muted, decorative backgrounds.
      });
    };

    if (reducedMotion) {
      A.pause();
      B.pause();
      return;
    }

    const FADE = 0.9;
    let cur = A;
    let nxt = B;
    let swapping = false;
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

    let observer: IntersectionObserver | undefined;
    if (wrapRef.current && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            play(cur);
          } else {
            cur.pause();
            nxt.pause();
          }
        },
        { rootMargin: "200px 0px" }
      );
      observer.observe(wrapRef.current);
    }

    return () => {
      A.removeEventListener("timeupdate", tick);
      B.removeEventListener("timeupdate", tick);
      observer?.disconnect();
    };
  }, [reducedMotion]);

  return (
    <div ref={wrapRef} className={`mhu-video-backdrop ${className}`} aria-hidden="true">
      <video
        ref={aRef}
        className="is-active"
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        poster={POSTER_SRC}
      >
        <source src={VIDEO_SRC} type="video/mp4" />
      </video>
      <video ref={bRef} muted loop playsInline preload="auto" disablePictureInPicture poster={POSTER_SRC}>
        <source src={VIDEO_SRC} type="video/mp4" />
      </video>
      {overlay && <div className="mhu-video-overlay" />}
    </div>
  );
}
