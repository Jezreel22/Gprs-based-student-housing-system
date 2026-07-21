import type { NextConfig } from "next";

let nextConfig: NextConfig = {




  // reactStrictMode: true,
  //
  // // Apply security headers to every route. The CSP is intentionally a bit
  // // permissive on `script-src`/`style-src` because Next.js dev tooling and
  // // Radix UI both inject inline scripts/styles; a strict nonce-based CSP is
  // // a follow-up (requires wiring `useServerInsertedHTML` for nonces).
  // async headers() {
  //   const csp = [
  //     "default-src 'self'",
  //     // js.paystack.co = inline checkout script (PaystackPop)
  //     // accounts.google.com/gsi/client = Google Identity Services (login button)
  //     // "script-src 'self' 'unsafe-inline' https://js.paystack.co https://*.paystack.com https://accounts.google.com https://*.googleapis.com https://maps.googleapis.com https://maps.gstatic.com",
  //     // "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.paystack.com",
  //     "font-src 'self' https://fonts.gstatic.com data:",
  //     // picsum.photos redirects to fastly.picsum.photos — both must be allowed.
  //     "img-src 'self' data: blob: https://picsum.photos https://fastly.picsum.photos https://lh3.googleusercontent.com https://*.paystack.co https://*.paystack.com https://*.googleusercontent.com https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com",
  //     "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://*.googleapis.com https://maps.googleapis.com https://api.paystack.co https://*.paystack.co https://*.paystack.com https://paystack.com https://picsum.photos https://fastly.picsum.photos",
  //     // checkout.paystack.COM hosts the popup iframe; also cover paystack.com apex.
  //     "frame-src https://accounts.google.com https://www.openstreetmap.org https://*.paystack.co https://*.paystack.com https://paystack.co https://paystack.com https://maps.google.com",
  //     "object-src 'none'",
  //     "base-uri 'self'",
  //     "form-action 'self'",
  //     "frame-ancestors 'none'",
  //   ].join("; ");
  //
  //   return [
  //     {
  //       source: "/:path*",
  //       headers: [
  //         // { key: "Content-Security-Policy", value: csp },
  //         // { key: "X-Frame-Options", value: "DENY" },
  //         // { key: "X-Content-Type-Options", value: "nosniff" },
  //         // { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  //         // // camera=(self) so the KYC selfie capture (getUserMedia) works
  //         // // same-origin. `camera=()` would block it on every page.
  //         // { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
  //       ],
  //     },
  //   ];
  // },
};

