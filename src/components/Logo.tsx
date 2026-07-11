"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Brand logo for NAUB Home Finder. A stylized house silhouette that stays
 * legible at 26 px (real NavBar size) — flat brand-red roof, cream walls,
 * a window, and a door. The shape reads as "home" instantly.
 *
 * Two visual variants:
 * - "solid"  (default): red rounded square background with the cream house.
 * - "glass":            translucent white rounded square for use on the red
 *                       gradient on login/register side panels.
 */
export interface LogoProps {
  size?: number;       // px, square. Defaults to 36.
  variant?: "solid" | "glass";
  className?: string;
}

export default function Logo({ size = 36, variant = "solid", className }: LogoProps) {
  const isGlass = variant === "glass";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center shrink-0 rounded-xl overflow-hidden",
        className
      )}
      style={{
        width: size,
        height: size,
        background: isGlass
          ? "rgba(255,255,255,0.20)"
          : "#FF5A5F",
        boxShadow: isGlass ? "inset 0 0 0 1px rgba(255,255,255,0.18)" : undefined,
      }}
      aria-label="NAUB Home Finder"
      role="img"
    >
      <svg
        viewBox="0 0 32 32"
        // Render at native pixel size; do not scale down further.
        width={Math.round(size * 0.78)}
        height={Math.round(size * 0.78)}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        shapeRendering="geometricPrecision"
      >
        {/* Flat color palette — keeps everything crisp at small sizes.
            Brand red is used for the roof (the silhouette anchor). */}
        {/* Roof — strong red, slightly darker shade than the badge background
            so the house pops against it. */}
        <path d="M 3 16 L 16 5 L 29 16 Z" fill="#B23A36" />

        {/* Walls — cream so the roof triangle reads against the badge */}
        <rect x="6.5" y="15" width="19" height="13" fill="#FFF8EC" />

        {/* Roof shadow under the eaves — a flat band of darker red */}
        <rect x="3" y="14.4" width="26" height="1.4" fill="#7A2225" />

        {/* Door — deep brand red, big enough to read at 26 px */}
        <rect x="14" y="19" width="5" height="9" rx="0.6" fill="#9B2A2E" />
        <circle cx="17.6" cy="23.6" r="0.45" fill="#FFD66B" />

        {/* Window — single square, no mullions (they vanish at small sizes) */}
        <rect x="8.5" y="18.5" width="4" height="4" rx="0.4" fill="#FFC56B" />
        <rect x="8.5" y="18.5" width="4" height="4" rx="0.4" fill="none" stroke="#7A2225" strokeWidth="0.5" />
      </svg>
    </span>
  );
}
