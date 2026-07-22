"use client";

import { useEffect, useState } from "react";
import { Download, Plus, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallPlatform = "chromium" | "ios" | null;

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

function isIos(): boolean {
  const { userAgent, platform, maxTouchPoints } = navigator;
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as NavigatorWithStandalone).standalone === true;
}

/**
 * Exposes the browser's native PWA install flow from the persistent navigation.
 * Chromium gives us `beforeinstallprompt`; iOS Safari requires Share → Add to
 * Home Screen, so it receives an accessible instruction dialog instead.
 */
export function InstallPWAButton() {
  const [platform, setPlatform] = useState<InstallPlatform>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHelpOpen, setIosHelpOpen] = useState(false);

  useEffect(() => {
    if (isInstalled()) return;

    if (isIos()) {
      setPlatform("ios");
      return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setPlatform("chromium");
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setPlatform(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function install() {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // Chromium only emits beforeinstallprompt once per page lifecycle. Clear it
    // after any outcome so the button never becomes a dead control.
    setDeferredPrompt(null);
    setPlatform(null);
  }

  if (platform === "chromium" && deferredPrompt) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={install}
        className="hidden sm:inline-flex gap-1.5 rounded-full border-primary/30 text-primary hover:bg-primary/10"
      >
        <Download className="h-3.5 w-3.5" />
        Install app
      </Button>
    );
  }

  if (platform === "ios") {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIosHelpOpen(true)}
          className="hidden sm:inline-flex gap-1.5 rounded-full border-primary/30 text-primary hover:bg-primary/10"
        >
          <Download className="h-3.5 w-3.5" />
          Install app
        </Button>

        <Dialog open={iosHelpOpen} onOpenChange={setIosHelpOpen}>
          <DialogContent className="max-w-sm rounded-2xl">
            <DialogHeader>
              <DialogTitle>Install NAUB Home Finder</DialogTitle>
              <DialogDescription>
                Add the app to your iPhone or iPad home screen for a full-screen experience and faster access.
              </DialogDescription>
            </DialogHeader>
            <ol className="space-y-3 text-sm text-foreground">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">1</span>
                <span>Tap the <strong>Share</strong> button <Share className="inline h-4 w-4 align-text-bottom text-primary" /> in Safari&rsquo;s toolbar.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">2</span>
                <span>Scroll down and choose <strong>Add to Home Screen</strong> <Plus className="inline h-4 w-4 align-text-bottom text-primary" />.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">3</span>
                <span>Tap <strong>Add</strong> to finish.</span>
              </li>
            </ol>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return null;
}
