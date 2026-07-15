"use client";

import { cn } from "@/lib/utils";

interface AvatarUser {
  first_name?: string | null;
  last_name?: string | null;
  profile_photo_url?: string | null;
}

interface AvatarProps {
  user?: AvatarUser | null;
  /** Pixel diameter. Defaults to 32 (NavBar size). */
  size?: number;
  className?: string;
}

/**
 * Reusable avatar. Renders the user's profile photo if present, otherwise
 * the existing red/white initial chip so call sites look identical whether
 * or not a photo is set.
 */
export default function Avatar({ user, size = 32, className }: AvatarProps) {
  const photo = user?.profile_photo_url;
  const initial = (user?.first_name?.[0] ?? user?.last_name?.[0] ?? "?").toUpperCase();
  const fontSize = Math.max(10, Math.round(size * 0.42));

  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt=""
        className={cn("rounded-full object-cover shrink-0", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center text-white font-bold shrink-0",
        className,
      )}
      style={{ width: size, height: size, background: "#FF5A5F", fontSize }}
    >
      {initial}
    </div>
  );
}