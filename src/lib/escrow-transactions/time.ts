/**
 * Africa/Lagos date helpers.
 *
 * The receipt numbering boundary is the West-Africa calendar day. We use
 * Intl.DateTimeFormat to derive the yyyy-mm-dd string in zone, then the
 * repository's counter UPSERT keys on that string.
 */
const LAGOS_TZ = "Africa/Lagos";

export function lagosDateString(date: Date = new Date()): string {
  // Intl gives us "DD/MM/YYYY" parts; reconstruct as ISO yyyy-mm-dd.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LAGOS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) {
    throw new Error("Could not derive Lagos date");
  }
  return `${y}-${m}-${d}`;
}