/**
 * Render helpers for the official NAUB escrow receipt.
 *
 * Public API surface:
 *   - `renderReceiptPdfBuffer(snapshot)` — server-only; produces the
 *     downloadable PDF bytes. Used by /api/receipts/[id]/pdf.
 *   - `generateQrDataUrl(text)` — produces the data URL embedded in the PDF
 *     and shown on the browser view. Uses the `qrcode` package, server-safe.
 *
 * Server runtime only — `@react-pdf/renderer` and `qrcode` are Node
 * libraries. Do not import this file from a client component.
 */
import "server-only";
import * as React from "react";
import QRCode from "qrcode";
import { pdf } from "@react-pdf/renderer";
import { ReceiptDocument, type ReceiptSnapshot } from "./pdf";

export type { ReceiptSnapshot };

/**
 * Build a verification QR as a data URL. Used inside the PDF and also
 * embedded into the browser preview. Server-only by virtue of the parent
 * module's `server-only` import.
 */
export async function generateQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
    color: { dark: "#111111", light: "#FFFFFF" },
  });
}

/**
 * Render the receipt PDF as a `Buffer`. Server-only.
 *
 * Uses React's `createElement` directly so this file stays in TypeScript
 * (Next's client/server heuristics prefer .ts for server-only modules) and
 * the rendered tree is identical to the browser preview component.
 */
export async function renderReceiptPdfBuffer(snapshot: ReceiptSnapshot): Promise<Buffer> {
  const qrDataUrl = await generateQrDataUrl(snapshot.verification_url);
  const element = React.createElement(ReceiptDocument, { snapshot, qrDataUrl });
  const instance = pdf(element as any);
  const blob = await instance.toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}