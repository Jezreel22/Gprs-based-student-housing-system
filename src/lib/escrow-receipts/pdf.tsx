"use client";

/**
 * The receipt document used both by the browser print view and by the PDF
 * generator. Rendered from the immutable `escrow_receipts.snapshot` JSON
 * so historical documents never change even if profiles / properties do.
 */
import * as React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";

export interface ReceiptSnapshot {
  issuer: {
    name: string;
    site_url: string;
    support_email: string | null;
    support_phone: string | null;
    legal_name: string | null;
    document_version: number;
  };
  title: string;
  status_label: string;
  notice: string;
  booking_id: string;
  escrow_reference: string;
  receipt_number: string;
  receipt_kind: "deposit" | "release" | "refund";
  student: { user_id: string; full_name: string; email: string | null; phone: string | null };
  landlord: { user_id: string; full_name: string; email: string | null; phone: string | null };
  property: {
    property_id: string;
    address: string;
    rent_amount_ngn: number;
    deposit_amount_ngn: number;
    lease_start_date: string | null;
    lease_end_date: string | null;
  };
  amount_ngn: number;
  currency: string;
  payment_method: string;
  paystack_reference: string | null;
  issued_at: string;
  settlement_at: string | null;
  verification_url: string;
  footer_note: string;
}

const COLORS = {
  primary: "#FF5A5F",
  text: "#111111",
  textMuted: "#555555",
  textFaint: "#888888",
  border: "#EBEBEB",
  background: "#FFFFFF",
  accentGreen: "#15803D",
  accentBlue: "#1D4ED8",
  accentRed: "#B45309",
};

const STATUS_COLOR: Record<string, string> = {
  deposit: COLORS.accentBlue,
  release: COLORS.accentGreen,
  refund: COLORS.accentRed,
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 11,
    color: COLORS.text,
    backgroundColor: COLORS.background,
    padding: 36,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: COLORS.primary,
  },
  brandSub: { marginTop: 2, fontSize: 9, color: COLORS.textMuted },
  receiptMeta: { textAlign: "right" },
  receiptNumber: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  receiptKind: { fontSize: 9, color: COLORS.textMuted, marginTop: 2 },
  titleBlock: { marginTop: 28 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold" },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    color: COLORS.background,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  notice: { marginTop: 16, color: COLORS.textMuted, fontSize: 10, lineHeight: 1.5 },
  section: {
    marginTop: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  sectionHeading: {
    fontSize: 9,
    color: COLORS.textMuted,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    marginBottom: 6,
  },
  sectionRow: { flexDirection: "row", marginBottom: 4 },
  sectionCol: { flex: 1, paddingRight: 8 },
  label: { color: COLORS.textMuted, fontSize: 9 },
  value: { color: COLORS.text, fontSize: 11, marginTop: 2 },
  amountBox: {
    marginTop: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  amountLabel: { color: COLORS.textMuted, fontSize: 9, fontFamily: "Helvetica-Bold" },
  amountValue: { fontSize: 22, fontFamily: "Helvetica-Bold" },
  qrRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 22,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  qrBox: {
    width: 96,
    height: 96,
    padding: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  qrInfo: { flex: 1, paddingLeft: 14 },
  qrInfoTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: COLORS.textMuted },
  qrInfoValue: { fontSize: 9, marginTop: 4, lineHeight: 1.4, color: COLORS.text },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    textAlign: "center",
    fontSize: 8,
    color: COLORS.textFaint,
    lineHeight: 1.4,
  },
});

export function formatNGN(n: number, currency = "NGN"): string {
  if (currency === "NGN") {
    return `₦${n.toLocaleString("en-NG")}`;
  }
  return `${n.toLocaleString()} ${currency}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/**
 * The receipt document. PDF-only — used by the /api/receipts/[id]/pdf route.
 * The browser print view uses an HTML equivalent under
 * `src/components/receipts/ReceiptDocument.tsx` so the print stylesheet and
 * the PDF stylesheet agree on the layout.
 */
export interface ReceiptDocumentProps {
  snapshot: ReceiptSnapshot;
  /** Pre-rendered QR data URL (so PDF rendering doesn't depend on a browser). */
  qrDataUrl: string;
}

export function ReceiptDocument({ snapshot, qrDataUrl }: ReceiptDocumentProps) {
  const s = snapshot;
  const statusColor = STATUS_COLOR[s.receipt_kind] ?? COLORS.primary;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brand}>{s.issuer.name}</Text>
            <Text style={styles.brandSub}>{s.issuer.site_url}</Text>
            {s.issuer.legal_name ? <Text style={styles.brandSub}>{s.issuer.legal_name}</Text> : null}
          </View>
          <View style={styles.receiptMeta}>
            <Text style={styles.receiptNumber}>{s.receipt_number}</Text>
            <Text style={styles.receiptKind}>{s.receipt_kind.toUpperCase()} · v{s.issuer.document_version}</Text>
          </View>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.title}>{s.title}</Text>
          <View style={styles.statusRow}>
            <Text style={[styles.statusBadge, { backgroundColor: statusColor }]}>{s.status_label}</Text>
          </View>
          <Text style={styles.notice}>{s.notice}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>TRANSACTION</Text>
          <View style={styles.sectionRow}>
            <View style={styles.sectionCol}>
              <Text style={styles.label}>Issued</Text>
              <Text style={styles.value}>{formatDate(s.issued_at)}</Text>
            </View>
            <View style={styles.sectionCol}>
              <Text style={styles.label}>Settled</Text>
              <Text style={styles.value}>{formatDate(s.settlement_at)}</Text>
            </View>
          </View>
          <View style={styles.sectionRow}>
            <View style={styles.sectionCol}>
              <Text style={styles.label}>Booking reference</Text>
              <Text style={styles.value}>{s.escrow_reference}</Text>
            </View>
            <View style={styles.sectionCol}>
              <Text style={styles.label}>Payment method</Text>
              <Text style={styles.value}>{s.payment_method}</Text>
            </View>
          </View>
          {s.paystack_reference ? (
            <View style={styles.sectionRow}>
              <View style={styles.sectionCol}>
                <Text style={styles.label}>Payment reference</Text>
                <Text style={styles.value}>{s.paystack_reference}</Text>
              </View>
              <View style={styles.sectionCol} />
            </View>
          ) : null}
        </View>

        <View style={styles.amountBox}>
          <View>
            <Text style={styles.amountLabel}>AMOUNT</Text>
            <Text style={styles.amountValue}>{formatNGN(s.amount_ngn, s.currency)}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.amountLabel}>CURRENCY</Text>
            <Text style={[styles.amountValue, { fontSize: 14 }]}>{s.currency}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>PARTIES</Text>
          <View style={styles.sectionRow}>
            <View style={styles.sectionCol}>
              <Text style={styles.label}>Student</Text>
              <Text style={styles.value}>{s.student.full_name}</Text>
              <Text style={styles.value}>{s.student.email ?? "—"}</Text>
              <Text style={styles.value}>{s.student.phone ?? ""}</Text>
            </View>
            <View style={styles.sectionCol}>
              <Text style={styles.label}>Landlord</Text>
              <Text style={styles.value}>{s.landlord.full_name}</Text>
              <Text style={styles.value}>{s.landlord.email ?? "—"}</Text>
              <Text style={styles.value}>{s.landlord.phone ?? ""}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>PROPERTY</Text>
          <Text style={styles.value}>{s.property.address}</Text>
          <View style={styles.sectionRow}>
            <View style={styles.sectionCol}>
              <Text style={styles.label}>Rent</Text>
              <Text style={styles.value}>{formatNGN(s.property.rent_amount_ngn)}</Text>
            </View>
            <View style={styles.sectionCol}>
              <Text style={styles.label}>Deposit</Text>
              <Text style={styles.value}>{formatNGN(s.property.deposit_amount_ngn)}</Text>
            </View>
          </View>
          {s.property.lease_start_date || s.property.lease_end_date ? (
            <View style={styles.sectionRow}>
              <View style={styles.sectionCol}>
                <Text style={styles.label}>Lease</Text>
                <Text style={styles.value}>
                  {s.property.lease_start_date ?? "?"} → {s.property.lease_end_date ?? "?"}
                </Text>
              </View>
              <View style={styles.sectionCol} />
            </View>
          ) : null}
        </View>

        <View style={styles.qrRow}>
          <View style={styles.qrBox}>
            <Image src={qrDataUrl} style={{ width: 84, height: 84 }} />
          </View>
          <View style={styles.qrInfo}>
            <Text style={styles.qrInfoTitle}>VERIFY THIS RECEIPT</Text>
            <Text style={styles.qrInfoValue}>
              Scan the QR code or visit the link below to verify this receipt with NAUB Home Finder. Only the
              receipt number, kind, issuer, and issue date are shown publicly.
            </Text>
            <Text style={styles.qrInfoValue}>{s.verification_url}</Text>
          </View>
        </View>

        <Text style={styles.footer}>{s.footer_note}</Text>
      </Page>
    </Document>
  );
}