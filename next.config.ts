import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Apply security headers to every route. The CSP is intentionally a bit
  // permissive on `script-src`/`style-src` because Next.js dev tooling and
  // Radix UI both inject inline scripts/styles; a strict nonce-based CSP is
  // a follow-up (requires wiring `useServerInsertedHTML` for nonces).
  async headers() {
    const csp = [
      "default-src 'self'",
      // js.paystack.co serves the inline checkout script (PaystackPop).
      "script-src 'self' 'unsafe-inline' https://js.paystack.co",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://picsum.photos https://lh3.googleusercontent.com",
      // api.paystack.co is called by the inline popup during charge.
      "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://api.paystack.co",
      // checkout.paystack.co / standard.paystack.co host the popup iframe.
      "frame-src https://accounts.google.com https://www.openstreetmap.org https://checkout.paystack.co https://standard.paystack.co",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // camera=(self) so the KYC selfie capture (getUserMedia) works
          // same-origin. `camera=()` would block it on every page.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;