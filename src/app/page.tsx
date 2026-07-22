"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueries } from "@tanstack/react-query";
import { getGetPropertiesQueryOptions } from "@/api";
import NavBar from "@/components/NavBar";
import PropertyCard from "@/components/PropertyCard";
import Logo from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search, Shield, Star, MapPin, ArrowRight,
  Lock, CheckCircle, Home as HomeIcon, Building2, Bed, Wifi,
  BadgeCheck, Navigation, ChevronRight, Phone, Mail, Facebook, Twitter, Instagram,
  WifiOff
} from "lucide-react";

const STATS = [
  { value: "200+", label: "Student Residents" },
  { value: "100+", label: "Verified Landlords" },
  { value: "50+", label: "Active Listings" },
  { value: "4.8/5", label: "Average Rating" },
];

// The four "Browse by Type" cards. `query` is sent to GET /api/properties so
// the card can show the live count. Empty `query` keeps the static "All"
// fallback in case the API call is slow. `furnished` is widened to string
// here and coerced to a boolean at the route — keeps the type uniform across
// the four cards so a single hook can fan out to them.
const CATEGORIES: Array<{
  label: string;
  icon: typeof HomeIcon;
  href: string;
  query: Record<string, string | number>;
}> = [
  { label: "Self-Contained", icon: HomeIcon, href: "/properties?type=self_contained", query: { type: "self_contained" } },
  { label: "Single Room",    icon: Bed,       href: "/properties?rooms=1",            query: { rooms: 1 } },
  { label: "2 Bedroom",      icon: Building2, href: "/properties?rooms=2",            query: { rooms: 2 } },
  { label: "Furnished",      icon: Wifi,      href: "/properties?furnished=true",    query: { furnished: 1 } },
];

const CORE_FEATURES = [
  {
    icon: Lock,
    color: "#FF5A5F",
    bg: "#FFF0F0",
    title: "Escrow Payment Protection",
    desc: "Your rent is held securely until you physically confirm you have moved in. No landlord receives a kobo before you are settled.",
  },
  {
    icon: BadgeCheck,
    color: "#10B981",
    bg: "#ECFDF5",
    title: "Trust Score System",
    desc: "Every landlord and student earns a verified trust score based on identity checks, completed transactions, and peer ratings.",
  },
  {
    icon: Navigation,
    color: "#3B82F6",
    bg: "#EFF6FF",
    title: "GPS Occupancy Verification",
    desc: "Share your location and enter your unique 6-character code on move-in day to confirm occupancy and release funds.",
  },
];

const HOW_IT_WORKS = [
  {
    num: "01",
    title: "Create Your Account",
    desc: "Register as a student, landlord, or agent. Upload your ID to get verified and build your trust score.",
  },
  {
    num: "02",
    title: "Browse and Shortlist",
    desc: "Filter by price, rooms, location, and trust rating. Every listing is reviewed before going live.",
  },
  {
    num: "03",
    title: "Book and Pay Safely",
    desc: "Send a booking request. Rent goes into escrow, secure until you are in your new home.",
  },
  {
    num: "04",
    title: "Move In and Confirm",
    desc: "Use your occupancy code and GPS to confirm move-in. Funds release to the landlord automatically.",
  },
];

const FOOTER_LINKS = {
  Platform: [
    { label: "Browse Listings", href: "/properties" },
    { label: "List a Property", href: "/register" },
    { label: "How It Works", href: "#" },
    { label: "Trust Score", href: "#" },
  ],
  Support: [
    { label: "Help Centre", href: "#" },
    { label: "Contact Us", href: "#" },
    { label: "Report a Landlord", href: "#" },
    { label: "File a Dispute", href: "#" },
  ],
  Legal: [
    { label: "Terms of Service", href: "#" },
    { label: "Privacy Policy", href: "#" },
    { label: "Escrow Policy", href: "#" },
    { label: "Cookie Policy", href: "#" },
  ],
};

export default function Home() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [user, setUser] = useState<{ first_name?: string; role?: string } | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("naub_user");
    if (raw) try { setUser(JSON.parse(raw)); } catch {}
  }, []);

  const {
    data: propertiesData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    ...getGetPropertiesQueryOptions({ sort: "newest", page_size: 6 }),
    // Keep showing the last successful result while refetching in the
    // background, and — crucially — keep it on a transient fetch failure so a
    // flaky connection doesn't wipe the listings off the page. React Query
    // already retries 3x; if those still fail we'd rather show stale data
    // than a blank "couldn't load" screen.
    staleTime: 60_000,
    keepPreviousData: true,
  });

  const featured = propertiesData?.data ?? [];

  // Live counts for the "Browse by Type" cards. We only care about `total`,
  // so each query asks for one row — keeps the response payload tiny while
  // still giving us an exact live count.
  const categoryCounts = useQueries({
    queries: CATEGORIES.map((c) => getGetPropertiesQueryOptions({ ...c.query, page: 1, page_size: 1 })),
    combine: (results) => results.map((r) => r.data?.total ?? 0),
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/properties${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ""}`);
  };

  return (
    <div className="min-h-screen bg-[#F7F7F7]">
      <NavBar />

      {/* Hero */}
      <section className="bg-white">
        <div className="max-w-7xl mx-auto px-4 py-24 md:py-32 flex flex-col items-center text-center">
          <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-4">
            Student Housing Near NAUB Campus
          </p>
          <h1 className="text-4xl md:text-6xl font-extrabold text-foreground leading-tight tracking-tight mb-5 max-w-3xl">
            Find Your Perfect{" "}
            <span style={{ color: "#FF5A5F" }}>Student Home</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mb-10">
            Browse verified, affordable listings near Nigerian Army University Biu.
          </p>

          {/* Search bar */}
          <form onSubmit={handleSearch} className="w-full max-w-2xl">
            <div className="flex items-center bg-white border-2 border-[#EBEBEB] rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow">
              <div className="flex items-center gap-3 flex-1 px-5 py-3">
                <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search by area, street, or neighbourhood..."
                  className="border-0 shadow-none p-0 h-auto text-base focus-visible:ring-0 bg-transparent"
                />
              </div>
              <Button
                type="submit"
                className="m-2 rounded-xl px-6 py-3 h-auto font-semibold"
                style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
              >
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
            </div>
          </form>

          {/* Quick filters */}
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {[
              { label: "Under N100k/yr", href: "/properties?rent_max=100000" },
              { label: "Under N150k/yr", href: "/properties?rent_max=150000" },
              { label: "Self-Contained", href: "/properties?type=self_contained" },
              { label: "Top Rated", href: "/properties?sort=most_trusted" },
            ].map(f => (
              <Link key={f.label} href={f.href}>
                <button className="text-sm bg-white border border-[#EBEBEB] rounded-full px-4 py-1.5 hover:border-primary hover:text-primary transition-colors font-medium cursor-pointer">
                  {f.label}
                </button>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="py-8" style={{ background: "#FF5A5F" }}>
        <div className="max-w-5xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-6 text-center text-white">
          {STATS.map(s => (
            <div key={s.label}>
              <div className="text-3xl font-extrabold">{s.value}</div>
              <div className="text-sm opacity-80 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Browse by Category */}
      <section className="py-14 bg-white">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-foreground mb-8">Browse by Type</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {CATEGORIES.map((cat, i) => {
              const count = categoryCounts[i];
              return (
                <Link key={cat.label} href={cat.href}>
                  <div className="flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border border-[#EBEBEB] bg-[#FAFAFA] hover:border-primary hover:shadow-md transition-all cursor-pointer group h-full">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform"
                      style={{ background: "#FFF0F0" }}
                    >
                      <cat.icon className="h-6 w-6 text-primary" />
                    </div>
                    <span className="text-sm font-semibold text-foreground">{cat.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {count > 0 ? `${count} ${count === 1 ? "listing" : "listings"}` : "—"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Featured Listings */}
      <section className="py-16 bg-[#F7F7F7]">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-1">Latest Listings</h2>
              <p className="text-muted-foreground text-sm">Newly added, verified properties near campus</p>
            </div>
            <Link href="/properties">
              <Button variant="outline" className="hidden md:flex gap-2 rounded-full font-medium text-sm">
                View all listings <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-8">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl overflow-hidden border border-[#EBEBEB] animate-pulse">
                  <div className="aspect-[4/3] bg-gray-200" />
                  <div className="p-4 space-y-3">
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                    <div className="h-3 bg-gray-200 rounded w-1/2" />
                    <div className="h-5 bg-gray-200 rounded w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : error && featured.length === 0 ? (
            // Only show the hard error state when we have NO cached data to
            // fall back on. If we've loaded listings before, keep showing them
            // (below) with a discreet "couldn't refresh" notice — a flaky
            // connection shouldn't blank the page.
            <div className="text-center py-20 bg-white rounded-2xl border border-[#EBEBEB]">
              <WifiOff className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-60" />
              <h3 className="text-lg font-semibold mb-2">Couldn&rsquo;t load listings</h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                Check your internet connection and try again.
              </p>
              <Button variant="outline" onClick={() => refetch()}>Try again</Button>
            </div>
          ) : error && featured.length > 0 ? (
            <div>
              <div className="mb-4 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <WifiOff className="h-3.5 w-3.5 shrink-0" />
                Couldn&rsquo;t refresh the latest listings — showing what we loaded earlier.
                <button onClick={() => refetch()} className="ml-auto underline hover:text-amber-900">Retry</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-8">
                {featured.map(property => (
                  <PropertyCard key={property.id} property={property} />
                ))}
              </div>
            </div>
          ) : featured.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-8">
              {featured.map(property => (
                <PropertyCard key={property.id} property={property} />
              ))}
            </div>
          ) : (
            <div className="text-center py-20 bg-white rounded-2xl border border-[#EBEBEB]">
              <HomeIcon className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-60" />
              <h3 className="text-lg font-semibold mb-2">Listings coming soon</h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                No listings yet — check back soon or be the first to list.
              </p>
              {user && ["landlord", "agent"].includes(user.role ?? "") && (
                <Link href="/properties/new">
                  <Button style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
                    List Your Property
                  </Button>
                </Link>
              )}
            </div>
          )}

          <div className="flex justify-center mt-8 md:hidden">
            <Link href="/properties">
              <Button variant="outline" className="flex gap-2 rounded-full font-medium text-sm">
                See all listings <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Core Features */}
      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">Why NAUB Home Finder</p>
            <h2 className="text-3xl font-bold text-foreground mb-3">Built Different, For Your Safety</h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              We go beyond a simple listing board. Every feature is designed to protect NAUB students from fraud and bad landlords.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 items-stretch">
            {CORE_FEATURES.map(f => (
              <div key={f.title} className="rounded-2xl border border-[#EBEBEB] p-8 hover:shadow-md transition-shadow flex flex-col">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 shrink-0"
                  style={{ background: f.bg }}
                >
                  <f.icon className="h-7 w-7" style={{ color: f.color }} />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-3">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-[#F7F7F7]">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-foreground mb-3">How It Works</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              From search to settled, a clear and safe process for every student.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6 items-stretch">
            {HOW_IT_WORKS.map(step => (
              <div key={step.num} className="bg-white rounded-2xl p-6 border border-[#EBEBEB] text-center flex flex-col">
                <div
                  className="text-4xl font-extrabold mb-4 leading-none"
                  style={{ color: "rgba(255,90,95,0.15)" }}
                >
                  {step.num}
                </div>
                <h3 className="text-sm font-bold text-foreground mb-2">{step.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed flex-1">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Strip */}
      <section className="py-10 bg-white border-t border-b border-[#EBEBEB]">
        <div className="max-w-4xl mx-auto px-4 flex flex-wrap items-center justify-center gap-8 text-sm text-muted-foreground">
          {[
            { icon: Shield, text: "Verified landlords only" },
            { icon: Lock, text: "Escrow-protected payments" },
            { icon: Star, text: "4.8/5 student satisfaction" },
            { icon: CheckCircle, text: "Fraud dispute resolution" },
          ].map(item => (
            <div key={item.text} className="flex items-center gap-2">
              <item.icon className="h-4 w-4 text-primary" />
              <span className="font-medium">{item.text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      {!user && (
        <section className="py-20 bg-[#F7F7F7]">
          <div className="max-w-4xl mx-auto px-4">
            <div className="rounded-3xl overflow-hidden grid md:grid-cols-2">
              <div className="p-10 flex flex-col justify-between" style={{ background: "#FF5A5F" }}>
                <div>
                  <p className="text-white/70 text-sm font-semibold uppercase tracking-widest mb-3">For Students</p>
                  <h3 className="text-2xl font-bold text-white mb-3">Find Your Room Today</h3>
                  <p className="text-white/80 text-sm mb-8">
                    Browse verified listings, book safely, and move in with full protection.
                  </p>
                </div>
                <Link href="/register">
                  <Button
                    className="rounded-full bg-white font-bold hover:bg-gray-50 w-full sm:w-auto"
                    style={{ color: "#FF5A5F" }}
                  >
                    Register as Student <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </Link>
              </div>
              <div className="p-10 flex flex-col justify-between bg-[#222222]">
                <div>
                  <p className="text-white/50 text-sm font-semibold uppercase tracking-widest mb-3">For Landlords</p>
                  <h3 className="text-2xl font-bold text-white mb-3">List Your Property</h3>
                  <p className="text-white/60 text-sm mb-8">
                    Reach thousands of verified NAUB students. Get paid securely through our escrow system.
                  </p>
                </div>
                <Link href="/register">
                  <Button
                    variant="outline"
                    className="rounded-full border-white/30 text-white hover:bg-white/10 w-full sm:w-auto"
                  >
                    List a Property <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer style={{ background: "#111111" }}>
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
            {/* Brand column */}
            <div className="col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <Logo size={32} variant="solid" />
                <span className="text-white font-bold">NAUB Home Finder</span>
              </div>
              <p className="text-xs leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>
                Safe, verified student housing near Nigerian Army University Biu, with full escrow protection.
              </p>
              <div className="flex items-center gap-3 mb-3 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                <div className="flex items-center gap-1"><Mail className="h-3 w-3" /><span>support@naub-homefinder.ng</span></div>
              </div>
              <div className="flex gap-2">
                {[Facebook, Twitter, Instagram].map((Icon, i) => (
                  <a key={i} href="#" className="w-7 h-7 rounded-md flex items-center justify-center transition-colors" style={{ background: "rgba(255,255,255,0.08)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#FF5A5F")}
                    onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}>
                    <Icon className="h-3.5 w-3.5 text-white" />
                  </a>
                ))}
              </div>
            </div>

            {/* Link columns */}
            {Object.entries(FOOTER_LINKS).map(([group, links]) => (
              <div key={group}>
                <h4 className="text-white font-semibold text-xs uppercase tracking-wider mb-3">{group}</h4>
                <ul className="space-y-2">
                  {links.map(link => (
                    <li key={link.label}>
                      <a href={link.href} className="text-xs transition-colors" style={{ color: "rgba(255,255,255,0.4)" }}
                        onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
              &copy; {new Date().getFullYear()} NAUB Home Finder. All rights reserved.
            </p>
            <div className="flex items-center gap-1 text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
              <Shield className="h-3 w-3" />
              <span>Secure payments powered by escrow</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}