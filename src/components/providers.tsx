"use client";

import { ReactNode, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter } from "@/api";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

export function Providers({ children }: { children: ReactNode }) {
  // QueryClient lives in state so it's created once per browser session
  // (otherwise it would be recreated on every render).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  // Re-attach the bearer token to every API call on the client.
  // Mirrors the pre-migration behavior in src/main.tsx so the existing
  // generated React Query hooks keep working with no changes.
  useEffect(() => {
    setAuthTokenGetter(() => localStorage.getItem("naub_token"));
  }, []);

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
          <Toaster />
          <ServiceWorkerRegister />
        </TooltipProvider>
      </QueryClientProvider>
    </GoogleOAuthProvider>
  );
}