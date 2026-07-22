/**
 * Generates the PWA icon set from a single on-brand SVG (the cream/red house on
 * a full-bleed #FF5A5F square — the same mark as src/components/Logo.tsx).
 *
 * Outputs PNGs to public/icons/:
 *   - icon-{72,96,128,144,152,192,384,512}.png  (purpose: any)
 *   - maskable-512x512.png                       (purpose: maskable, safe-zone)
 *   - apple-touch-icon.png                       (180x180, full-bleed)
 *
 * Run with: `pnpm run pwa:icons` (requires sharp, a devDependency). The
 * generated PNGs are committed, so Vercel does not need sharp or any system
 * rasterizer at build time. Re-run whenever the brand mark changes.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const OUT = path.join(process.cwd(), "public", "icons");

// House artwork in a 32x32 coordinate space — mirrors src/components/Logo.tsx.
const HOUSE = `
    <path d="M 3 16 L 16 5 L 29 16 Z" fill="#B23A36" />
    <rect x="6.5" y="15" width="19" height="13" fill="#FFF8EC" />
    <rect x="3" y="14.4" width="26" height="1.4" fill="#7A2225" />
    <rect x="14" y="19" width="5" height="9" rx="0.6" fill="#9B2A2E" />
    <circle cx="17.6" cy="23.6" r="0.45" fill="#FFD66B" />
    <rect x="8.5" y="18.5" width="4" height="4" rx="0.4" fill="#FFC56B" />
    <rect x="8.5" y="18.5" width="4" height="4" rx="0.4" fill="none" stroke="#7A2225" stroke-width="0.5" />
`;

/** Build a full-bleed brand icon SVG at `size` px, house scaled by `factor`. */
function iconSvg(size: number, factor: number): string {
  const house = Math.round(size * factor);
  const offset = (size - house) / 2;
  const scale = house / 32;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#FF5A5F" />
  <g transform="translate(${offset.toFixed(2)} ${offset.toFixed(2)}) scale(${scale.toFixed(4)})">
    ${HOUSE.trim()}
  </g>
</svg>`;
}

async function writePng(svg: string, file: string) {
  await sharp(Buffer.from(svg)).png().toFile(file);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
  for (const size of sizes) {
    // "any" icons: house fills ~68% of the badge.
    await writePng(iconSvg(size, 0.68), path.join(OUT, `icon-${size}x${size}.png`));
  }

  // Maskable: full-bleed background (platforms mask the corners) with the house
  // kept well inside the 80% safe zone so it's never clipped.
  await writePng(iconSvg(512, 0.56), path.join(OUT, "maskable-512x512.png"));

  // Apple touch icon: 180x180, fully opaque (no transparency).
  await writePng(iconSvg(180, 0.68), path.join(OUT, "apple-touch-icon.png"));

  const rel = path.relative(process.cwd(), OUT);
  console.log(`Generated ${sizes.length + 2} icons in ${rel}/`);
}

main().catch((err) => {
  console.error("generate-pwa-icons failed:", err);
  process.exit(1);
});
