import { OfflineRetryButton } from "@/components/OfflineRetryButton";

/**
 * Branded offline fallback page.
 *
 * `force-static` so the page's HTML is identical for everyone — Serwist
 * precaches it (see next.config.ts `additionalPrecacheEntries`) and serves it
 * from the service worker when a navigation fails with no cached copy
 * (sw.ts `fallbacks.entries`). No fake data: it's an honest "you're offline"
 * state with a single retry action.
 */
export const dynamic = "force-static";

export const metadata = {
  title: "Offline — NAUB Home Finder",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#F7F7F7",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          maxWidth: "26rem",
          width: "100%",
          textAlign: "center",
          background: "#fff",
          borderRadius: "1.5rem",
          border: "1px solid #EBEBEB",
          padding: "2.5rem 1.75rem",
          boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
        }}
      >
        {/* Brand mark — the house-on-red used across the app (see Logo.tsx) */}
        <div
          aria-hidden
          style={{
            width: 64,
            height: 64,
            margin: "0 auto 1.25rem",
            borderRadius: "1rem",
            background: "#FF5A5F",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="40" height="40" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <path d="M 3 16 L 16 5 L 29 16 Z" fill="#B23A36" />
            <rect x="6.5" y="15" width="19" height="13" fill="#FFF8EC" />
            <rect x="3" y="14.4" width="26" height="1.4" fill="#7A2225" />
            <rect x="14" y="19" width="5" height="9" rx="0.6" fill="#9B2A2E" />
            <rect x="8.5" y="18.5" width="4" height="4" rx="0.4" fill="#FFC56B" />
          </svg>
        </div>

        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: 0, color: "#171717" }}>
          You&rsquo;re offline
        </h1>
        <p style={{ color: "#737373", marginTop: "0.5rem", fontSize: "0.95rem", lineHeight: 1.5 }}>
          NAUB Home Finder can&rsquo;t reach the server right now. Pages you&rsquo;ve already visited
          still work — reconnect to browse listings, book, and manage escrow.
        </p>

        <OfflineRetryButton />
      </div>
    </main>
  );
}
