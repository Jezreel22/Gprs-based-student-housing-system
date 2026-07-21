/**
 * Listing photos used as seed imagery and as the fallback when a property has
 * no DB photos. Sourced from the user's `assets/image listing 1/` WhatsApp
 * JPEGs and copied to `public/listings/` so Next.js serves them as static
 * assets. We keep the index here because static files can't be enumerated at
 * build time.
 *
 * Each listing gets a stable rotation of these photos based on a hash of its
 * id (or a fallback string) — same listing always shows the same photos so
 * they look consistent, but different listings look distinct.
 */
export const LISTING_PHOTOS: readonly string[] = [
  "/listings/listing-1.jpeg",
  "/listings/listing-2.jpeg",
  "/listings/listing-3.jpeg",
  "/listings/listing-4.jpeg",
  "/listings/listing-5.jpeg",
  "/listings/listing-6.jpeg",
  "/listings/listing-7.jpeg",
  "/listings/listing-8.jpeg",
  "/listings/listing-9.jpeg",
] as const;

/**
 * Tiny string-hash to keep fallback photo selection stable per seed.
 * djb2 — fast, collision-bearable for this use case.
 */
function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Return `n` rotating photo URLs starting at a hash-derived offset for `seed`.
 * Same seed → same order (stable across renders); different seed → different
 * rotation (listings look distinct). `n` is clamped to the available count.
 */
export function pickListingPhotos(seed: string, n = 4): string[] {
  if (LISTING_PHOTOS.length === 0) return [];
  const count = Math.min(n, LISTING_PHOTOS.length);
  const offset = hashSeed(seed || "default") % LISTING_PHOTOS.length;
  return Array.from({ length: count }, (_, i) => LISTING_PHOTOS[(offset + i) % LISTING_PHOTOS.length]);
}

/** Return a single stable photo for a seed (used for card thumbnails). */
export function pickListingPhoto(seed: string): string {
  return pickListingPhotos(seed, 1)[0] ?? LISTING_PHOTOS[0];
}