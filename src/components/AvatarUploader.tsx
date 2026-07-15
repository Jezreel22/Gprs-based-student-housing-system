"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { customFetch } from "@/api/custom-fetch";
import { useToast } from "@/hooks/use-toast";
import Avatar from "./Avatar";

interface AvatarUploaderProps {
  user: { id: string; first_name?: string | null; last_name?: string | null; profile_photo_url?: string | null } | null;
  size?: number;
  /** Optional caption shown under the avatar (e.g. "Update photo"). */
  hint?: string;
}

// Match KYC's client-side compression so uploads stay well under /api/upload's
// 8 MB cap and start uploading fast on slow mobile networks.
function compressImage(file: File, maxWidth = 600, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error("Canvas not supported")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error("Compression produced no output")); return; }
        resolve(blob);
      }, "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
    img.src = url;
  });
}

/**
 * Avatar + pencil overlay. Click → file picker → compress → POST /api/upload
 * → PUT /api/users/me with the returned URL → update localStorage so the
 * NavBar (which reads from localStorage) re-renders on the storage event.
 */
export default function AvatarUploader({ user, size = 96, hint }: AvatarUploaderProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(user?.profile_photo_url ?? null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ variant: "destructive", title: "Please pick an image file" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ variant: "destructive", title: "Image too large", description: "Max 10 MB before compression." });
      return;
    }
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.append("file", compressed, "avatar.jpg");
      const up = await customFetch<{ url: string }>("/api/upload", { method: "POST", body: fd });
      await customFetch("/api/users/me", {
        method: "PUT",
        body: JSON.stringify({ profile_photo_url: up.url }),
      });

      setPhotoUrl(up.url);

      // Sync localStorage so the NavBar avatar + dropdown header update
      // without a full reload. The NavBar listens on the storage event.
      if (typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem("naub_user");
          if (raw) {
            const parsed = JSON.parse(raw);
            window.localStorage.setItem(
              "naub_user",
              JSON.stringify({ ...parsed, profile_photo_url: up.url }),
            );
            window.dispatchEvent(new Event("storage"));
          }
        } catch {
          // best-effort sync
        }
      }

      toast({ title: "Profile photo updated" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Upload failed", description: err?.message ?? "Please try again." });
    } finally {
      setBusy(false);
    }
  };

  // Render the avatar with the freshest URL we know about.
  const displayed = photoUrl !== user?.profile_photo_url
    ? { ...user, profile_photo_url: photoUrl }
    : user;

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label="Change profile photo"
        className="relative rounded-full group focus:outline-none focus:ring-2 focus:ring-primary/40"
        style={{ width: size, height: size }}
      >
        <Avatar user={displayed ?? null} size={size} />
        <span
          className="absolute inset-0 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: "rgba(0,0,0,0.45)" }}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        </span>
      </button>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}