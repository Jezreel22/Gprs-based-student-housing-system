"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu, User, LogOut, LayoutDashboard, Home, PlusCircle, MessageSquare, Shield, ShoppingBag, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Human-readable role labels + colors for the avatar chip.
const ROLE_META: Record<string, { label: string; bg: string; fg: string }> = {
  student:        { label: "Student",        bg: "#DBEAFE", fg: "#1D4ED8" },
  landlord:       { label: "Landlord",       bg: "#DCFCE7", fg: "#15803D" },
  agent:          { label: "Agent",          bg: "#DCFCE7", fg: "#15803D" },
  escrow_officer: { label: "Escrow Officer", bg: "#FEF3C7", fg: "#B45309" },
};

function RoleChip({ role, className = "" }: { role: string; className?: string }) {
  const meta = ROLE_META[role] ?? { label: role, bg: "#E5E7EB", fg: "#374151" };
  return (
    <Badge
      className={`border-0 font-medium ${className}`}
      style={{ background: meta.bg, color: meta.fg }}
    >
      {meta.label}
    </Badge>
  );
}
import Logo from "./Logo";
import NotificationBell from "./NotificationBell";
import Avatar from "./Avatar";

interface StoredUser {
  id: string;
  email: string;
  role: string;
  first_name?: string | null;
  last_name?: string | null;
  profile_photo_url?: string | null;
}

export default function NavBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("naub_user");
    if (raw) {
      try { setUser(JSON.parse(raw)); } catch {}
    }
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("naub_token");
    localStorage.removeItem("naub_user");
    setUser(null);
    window.dispatchEvent(new Event("storage"));
    router.push("/");
  };

  return (
    <nav
      className={`sticky top-0 z-40 w-full transition-all ${
        scrolled ? "bg-white shadow-sm border-b border-[#EBEBEB]" : "bg-white/95 backdrop-blur-sm border-b border-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Logo size={36} variant="solid" />
          <span className="font-extrabold text-base tracking-tight hidden sm:block">NAUB Home Finder</span>
        </Link>

        {/* Center nav (desktop) */}
        <div className="hidden md:flex items-center gap-1">
          <Link href="/properties"
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              pathname?.startsWith("/properties")
                ? "text-primary bg-primary/10"
                : "text-foreground hover:bg-[#F7F7F7]"
            }`}>
            Browse
          </Link>
          <Link href="/map"
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              pathname === "/map"
                ? "text-primary bg-primary/10"
                : "text-foreground hover:bg-[#F7F7F7]"
            }`}>
            <MapPin className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
            Map
          </Link>
          {user && ["landlord", "agent"].includes(user.role) && (
            <Link href="/properties/new"
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === "/properties/new"
                  ? "text-primary bg-primary/10"
                  : "text-foreground hover:bg-[#F7F7F7]"
              }`}>
              List Property
            </Link>
          )}
          {user && user.role !== "escrow_officer" && (
            <Link href="/bookings"
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === "/bookings"
                  ? "text-primary bg-primary/10"
                  : "text-foreground hover:bg-[#F7F7F7]"
              }`}>
              My Bookings
            </Link>
          )}
          {user && (
            <Link href="/messages"
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname?.startsWith("/messages")
                  ? "text-primary bg-primary/10"
                  : "text-foreground hover:bg-[#F7F7F7]"
              }`}>
              Messages
            </Link>
          )}
          {user?.role === "escrow_officer" && (
            <Link href="/admin"
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === "/admin"
                  ? "text-primary bg-primary/10"
                  : "text-foreground hover:bg-[#F7F7F7]"
              }`}>
              <Shield className="h-4 w-4 inline mr-1" />
              Admin
            </Link>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {!user ? (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm" className="font-medium">Sign in</Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="rounded-full px-5 font-semibold"
                        style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
                  Sign up
                </Button>
              </Link>
            </>
          ) : (
            <>
              <NotificationBell />
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 hover:bg-[#F7F7F7] transition-colors">
                  <Avatar user={user} size={32} />
                  <div className="hidden sm:flex items-center gap-2">
                    <span className="text-sm font-medium">{user.first_name ?? "Account"}</span>
                    <RoleChip role={user.role} />
                  </div>
                  <RoleChip role={user.role} className="sm:hidden" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-2 border-b border-[#EBEBEB]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{user.first_name} {user.last_name}</p>
                    <RoleChip role={user.role} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>
                <DropdownMenuItem onClick={() => router.push("/dashboard")}>
                  <LayoutDashboard className="h-4 w-4 mr-2" /> Dashboard
                </DropdownMenuItem>
                {["landlord", "agent"].includes(user.role) && (
                  <DropdownMenuItem onClick={() => router.push("/properties/new")}>
                    <PlusCircle className="h-4 w-4 mr-2" /> List a Property
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => router.push("/map")}>
                  <MapPin className="h-4 w-4 mr-2" /> Map Search
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/properties")}>
                  <Home className="h-4 w-4 mr-2" /> Browse Listings
                </DropdownMenuItem>
                {user.role !== "escrow_officer" && (
                  <DropdownMenuItem onClick={() => router.push("/bookings")}>
                    <ShoppingBag className="h-4 w-4 mr-2" /> My Bookings
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => router.push("/messages")}>
                  <MessageSquare className="h-4 w-4 mr-2" /> Messages
                </DropdownMenuItem>
                {user.role === "escrow_officer" && (
                  <DropdownMenuItem onClick={() => router.push("/admin")}>
                    <Shield className="h-4 w-4 mr-2" /> Admin Panel
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4 mr-2" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}