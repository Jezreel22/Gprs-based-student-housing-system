import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { escrowReceiptsTable } from "@/lib/db/schema";
import { ShieldCheck, ShieldAlert, Receipt as ReceiptIcon } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Public, server-rendered authenticity check. The page reads from the same
 * minimal verification endpoint the QR code points at; no auth required.
 * The response never exposes amount, property, parties, or references —
 * only the data needed to convince a third party that a receipt is real.
 */
async function loadVerification(token: string) {
  const [receipt] = await db
    .select({
      receipt_number: escrowReceiptsTable.receipt_number,
      receipt_kind: escrowReceiptsTable.receipt_kind,
      issued_at: escrowReceiptsTable.issued_at,
      snapshot: escrowReceiptsTable.snapshot,
    })
    .from(escrowReceiptsTable)
    .where(eq(escrowReceiptsTable.verification_token, token))
    .limit(1);
  if (!receipt) return null;
  const snapshot = (receipt.snapshot ?? {}) as any;
  return {
    receipt_number: receipt.receipt_number,
    receipt_kind: receipt.receipt_kind,
    issued_at: receipt.issued_at.toISOString(),
    issuer_name: typeof snapshot?.issuer?.name === "string" ? snapshot.issuer.name : "NAUB Home Finder",
    issuer_site: typeof snapshot?.issuer?.site_url === "string" ? snapshot.issuer.site_url : "https://www.naubhomefinder.app",
  };
}

export default async function VerifyReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await loadVerification(token);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white dark:bg-card border border-[#EBEBEB] dark:border-border rounded-2xl p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div
            className="h-12 w-12 rounded-full flex items-center justify-center"
            style={{ background: result ? "#DCFCE7" : "#FEE2E2" }}
          >
            {result
              ? <ShieldCheck className="h-6 w-6 text-green-700" />
              : <ShieldAlert className="h-6 w-6 text-red-700" />}
          </div>
          <div>
            <h1 className="text-lg font-bold">
              {result ? "Authentic NAUB Escrow Receipt" : "Receipt Not Found"}
            </h1>
            <p className="text-sm text-muted-foreground">{result?.issuer_name ?? "NAUB Home Finder"}</p>
          </div>
        </div>

        {result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Receipt number</div>
                <div className="font-mono font-semibold">{result.receipt_number}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Type</div>
                <div className="font-medium capitalize">{result.receipt_kind}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Issued</div>
                <div className="font-medium">
                  {new Date(result.issued_at).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Issuer</div>
                <div className="font-medium">{result.issuer_name}</div>
              </div>
            </div>

            <div className="border-t border-[#EBEBEB] dark:border-border pt-4">
              <div className="text-xs text-muted-foreground mb-2">What this verifies</div>
              <p className="text-sm">
                This page confirms that the receipt number was issued by NAUB Home Finder and
                has not been revoked. Financial details, parties, and payment references are
                not disclosed publicly — only the receipt holder can view the full document.
              </p>
            </div>

            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ReceiptIcon className="h-4 w-4" /> Back to NAUB Home Finder
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              We could not find a receipt with this verification token. The receipt may have
              been revoked, or the URL may have been entered incorrectly.
            </p>
            <Link href="/" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
              Back to NAUB Home Finder
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}