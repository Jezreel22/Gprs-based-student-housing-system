/*
 * Service worker source for NAUB Home Finder.
 *
 * Serwist compiles this file to `public/sw.js` at build time (see next.config.ts
 * `withSerwistInit`). In development the worker is disabled entirely
 * (`disable: NODE_ENV === "development"`) so local dev behaves exactly as before
 * and we never have to fight a stale SW while iterating.
 *
 * SECURITY BOUNDARY — read before changing:
 * This is a payments/KYC/escrow/auth app. We deliberately use an explicit,
 * positively-scoped `runtimeCaching` list (we DO NOT spread `defaultCache`).
 * Only safe, mostly-static resources are cached:
 *   - app-shell navigations + RSC payloads
 *   - immutable Next build assets (`/_next/static/**`)
 *   - the image optimizer + bundled listing/icon images
 *   - Google Fonts (CSS + woff2)
 * Every other request — all `/api/**` traffic, Paystack, auth, KYC/verification,
 * trust, disputes, messages, and Google Maps tiles/JS — is NOT matched here, so
 * it falls straight through to the network and is never stored in a cache. That
 * is what guarantees no sensitive response (or auth token-bearing response) is
 * ever persisted. Keep new rules positively-scoped; never add a catch-all.
 */

import {
  Serwist,
  NetworkFirst,
  CacheFirst,
  StaleWhileRevalidate,
  ExpirationPlugin,
  type RuntimeCaching,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from "serwist";

// Declares the value of Serwist's `injectionPoint`. At build time the literal
// `self.__SW_MANIFEST` is replaced with the precache manifest (the list of
// build assets + any `additionalPrecacheEntries` from next.config.ts).
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const runtimeCaching: RuntimeCaching[] = [
  // 1) App-shell navigations and React Server Component payloads.
  //    Network-first with a 3s timeout: fresh while online, served from cache
  //    when the network is slow/unavailable. Same-origin only, never /api.
  {
    matcher: ({ request, url, sameOrigin }) =>
      sameOrigin &&
      !url.pathname.startsWith("/api/") &&
      (request.destination === "document" || request.headers.get("RSC") === "1"),
    handler: new NetworkFirst({
      cacheName: "naub-pages",
      networkTimeoutSeconds: 3,
      plugins: [
        new ExpirationPlugin({
          maxEntries: 64,
          maxAgeSeconds: 24 * 60 * 60, // 1 day
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },

  // 2) Next.js immutable build assets (content-hashed JS/CSS). Cache-first,
  //    long TTL — they're safe to serve without revalidation.
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: "naub-next-static",
      plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })],
    }),
  },

  // 3) Image optimizer + bundled listing/icon images. Stale-while-revalidate:
  //    instant from cache, refreshed in the background. Bounded entry count.
  {
    matcher: ({ url, sameOrigin }) =>
      sameOrigin &&
      (url.pathname.startsWith("/_next/image") ||
        url.pathname.startsWith("/listings/") ||
        url.pathname.startsWith("/icons/")),
    handler: new StaleWhileRevalidate({
      cacheName: "naub-images",
      plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 })],
    }),
  },

  // 4) Google Fonts (CSS from fonts.googleapis.com, woff2 from fonts.gstatic.com).
  //    Immutable binaries — cache-first for a year.
  {
    matcher: ({ url }) => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com",
    handler: new CacheFirst({
      cacheName: "naub-google-fonts",
      plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 })],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Activate a new SW immediately on deploy; the client reloads once on
  // `controllerchange` (see ServiceWorkerRegister.tsx) so users never get stuck
  // on a stale version.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  // When a navigation fails (offline + nothing cached), serve the precached
  // branded offline page instead of the browser's generic offline screen.
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
