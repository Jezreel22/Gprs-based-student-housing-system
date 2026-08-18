"use client";

/**
 * HeroSlideshow
 *
 * Full-bleed auto-advancing crossfade slideshow that sits behind the hero
 * section's text/search content. Real NAUB-area property photos instead of a
 * flat white background.
 *
 * Design notes:
 *  - Crossfade via opacity transitions on stacked <img> layers — no layout
 *    shift, no flicker, and the browser keeps rendering the outgoing image
 *    until the fade completes.
 *  - Auto-advances every 5 s; pauses on hover/focus and when the tab is
 *    hidden (visibilitychange) so we never burn battery in a background tab.
 *  - Manual controls: prev/next arrows + dot indicators, all keyboard
 *    reachable (real <button>s with aria-labels). Manual interaction resets
 *    the auto-advance timer so the slideshow doesn't lurch mid-click.
 *  - Images are plain <img> (not next/image): they're stacked absolutely and
 *    sized by the container, so next/image gains nothing here. priority on
 *    the first slide keeps LCP fast.
 *  - A dark gradient overlay guarantees text contrast regardless of which
 *    photo is showing (some of the property shots are bright).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Slide {
  src: string;
  alt: string;
}

const SLIDES: Slide[] = [
  {
    src: "/hero/hero-1.jpeg",
    alt: "Modern single-storey rental units with red-tiled roofs and porches near NAUB campus",
  },
  {
    src: "/hero/hero-2.jpeg",
    alt: "Two-storey student residence house with gated entrance in Biu",
  },
  {
    src: "/hero/hero-3.jpeg",
    alt: "Row of self-contained units with palm trees, a typical NAUB student housing block",
  },
];

const AUTO_ADVANCE_MS = 5000;

export default function HeroSlideshow({ className = "" }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = useCallback((next: number) => {
    setIndex((next + SLIDES.length) % SLIDES.length);
  }, []);

  // Auto-advance. Re-arms on every index change (which covers manual clicks
  // too) and stands down entirely while paused or the tab is hidden.
  useEffect(() => {
    if (paused) return;
    if (typeof document !== "undefined" && document.hidden) return;

    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    const arm = () => {
      clearTimer();
      timerRef.current = setTimeout(() => go(index + 1), AUTO_ADVANCE_MS);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) clearTimer();
      else if (!paused) arm();
    };

    arm();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [index, paused, go]);

  return (
    <div
      className={`absolute inset-0 overflow-hidden ${className}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="Featured properties near NAUB campus"
    >
      {/* Slides — stacked, crossfaded by opacity.
          Each slide is two layers: a blurred, cover-scaled copy of the photo
          filling the whole hero (so there's never an empty band), with the
          sharp original contained and centred on top. The source photos are
          mixed aspect ratios at phone resolution (one is portrait) —
          object-cover alone would crop the portrait shot to a sliver, and
          blur-fill keeps everything visible without stretching. */}
      {SLIDES.map((slide, i) => (
        <div
          key={slide.src}
          aria-hidden={i !== index}
          className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
            i === index ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${slide.src})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(32px) saturate(1.2)",
              transform: "scale(1.1)",
            }}
          />
          <img
            src={slide.src}
            alt={slide.alt}
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
            className="relative w-full h-full object-contain drop-shadow-lg"
          />
        </div>
      ))}

      {/* Contrast overlay — keeps white hero text readable over any photo */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(17,17,17,0.55), rgba(17,17,17,0.65))",
        }}
      />

      {/* Controls */}
      <div className="absolute inset-0 flex items-center justify-between px-3 sm:px-6 pointer-events-none">
        <button
          type="button"
          onClick={() => go(index - 1)}
          aria-label="Previous photo"
          className="pointer-events-auto w-10 h-10 rounded-full flex items-center justify-center bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm transition-colors focus:outline-none focus:ring-2 focus:ring-white/70"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => go(index + 1)}
          aria-label="Next photo"
          className="pointer-events-auto w-10 h-10 rounded-full flex items-center justify-center bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm transition-colors focus:outline-none focus:ring-2 focus:ring-white/70"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Dot indicators */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.src}
            type="button"
            onClick={() => go(i)}
            aria-label={`Show photo ${i + 1}`}
            aria-current={i === index}
            className={`h-2 rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-white/70 ${
              i === index ? "w-6 bg-white" : "w-2 bg-white/50 hover:bg-white/80"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
