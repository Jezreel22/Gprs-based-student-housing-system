"use client";

import { useEffect } from "react";

/**
 * Registers the production service worker and applies updates seamlessly.
 *
 * - Production-only: Serwist is disabled in development (see next.config.ts), so
 *   there is no /sw.js to register locally and dev behaves exactly as before —
 *   we never have to fight a stale worker while iterating.
 * - On a new deploy the worker activates immediately (skipWaiting + clientsClaim
 *   in sw.ts). We listen for `controllerchange` and reload the page exactly once
 *   so the user picks up the new assets without getting stuck on a stale
 *   version. The `reloading` guard prevents a loop if the event fires twice.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("Service worker registration failed:", err);
    });

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  return null;
}
