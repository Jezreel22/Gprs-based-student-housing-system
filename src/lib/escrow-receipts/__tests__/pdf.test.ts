/**
 * Pure tests for the QR data URL helper and the verification URL
 * construction. No DB needed; these run in milliseconds.
 */
import { describe, expect, it } from "vitest";
import { generateQrDataUrl } from "@/lib/escrow-receipts/render";
import { buildIssuerSnapshot } from "@/lib/escrow-transactions/service";
import crypto from "node:crypto";

describe("QR + verification helpers", () => {
  it("generates a PNG data URL", async () => {
    const dataUrl = await generateQrDataUrl("https://example.com/verify/abc");
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    // base64 body should be non-trivial
    const base64 = dataUrl.split(",")[1] ?? "";
    expect(base64.length).toBeGreaterThan(50);
  });

  it("issuer snapshot exposes a stable URL suffix", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://naubhomefinder.app/";
    const snap = buildIssuerSnapshot();
    expect(snap.name).toBe("NAUB Home Finder");
    // Trailing slash is stripped so we can append `/verify/receipt/...`
    expect(snap.site_url).toBe("https://naubhomefinder.app");
    expect(snap.document_version).toBeGreaterThan(0);
  });

  it("random verification tokens are unique across calls", () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});