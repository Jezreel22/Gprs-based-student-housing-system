"use client";

/**
 * LandmarkLine -- Feature 6 (Landmark Descriptions).
 *
 * Renders a small subtitle like "Near NAUB Main Gate" beneath the property
 * address on the detail page. Returns null when `description` is null, so
 * the parent's vertical-rhythm wrapper collapses cleanly for properties
 * without coordinates.
 *
 * Visual idiom matches the existing meta row in the title block
 * (`text-sm text-muted-foreground` + a lucide icon). The `Compass` icon is
 * chosen over `MapPin` to avoid colliding with the redundant address icon
 * already used in the meta row below.
 */

import { Compass } from "lucide-react";

interface LandmarkLineProps {
  /** Pre-computed description, e.g. "Near NAUB Main Gate". Null hides the line. */
  description: string | null;
}

export default function LandmarkLine({ description }: LandmarkLineProps) {
  if (!description) return null;
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Compass className="h-4 w-4" />
      {description}
    </span>
  );
}