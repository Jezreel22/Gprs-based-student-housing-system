"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getGetPropertiesQueryOptions } from "@/api";
import NavBar from "@/components/NavBar";
import PropertyCard from "@/components/PropertyCard";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { SlidersHorizontal, X } from "lucide-react";

function PropertiesPage() {
  const searchParams = useSearchParams();
  const searchStr = searchParams.toString();
  const params = new URLSearchParams(searchStr);

  const [rentMin, setRentMin] = useState(params.get("rent_min") ? parseInt(params.get("rent_min")!) : 0);
  const [rentMax, setRentMax] = useState(params.get("rent_max") ? parseInt(params.get("rent_max")!) : 200000);
  const [rooms, setRooms] = useState(params.get("rooms") ?? "");
  const [sort, setSort] = useState(params.get("sort") ?? "newest");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const queryParams: Record<string, any> = {
    sort,
    page,
    page_size: 12,
  };
  const q = params.get("q");
  if (q) queryParams.q = q;
  if (rentMin > 0) queryParams.rent_min = rentMin;
  if (rentMax < 200000) queryParams.rent_max = rentMax;
  if (rooms && rooms !== "any") queryParams.rooms = parseInt(rooms);

  const { data, isLoading, error } = useQuery(getGetPropertiesQueryOptions(queryParams));

  const properties = data?.data ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.ceil(total / 12);

  const hasFilters = rentMin > 0 || rentMax < 200000 || (rooms && rooms !== "any");

  const clearFilters = () => {
    setRentMin(0);
    setRentMax(200000);
    setRooms("");
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-[#F7F7F7]">
      <NavBar />

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {total > 0 ? `${total} Properties Available` : "Browse Properties"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Near Nigerian Army University, Biu</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Sort */}
            <Select value={sort} onValueChange={v => { setSort(v); setPage(1); }}>
              <SelectTrigger className="w-44 bg-white border-[#EBEBEB]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="cheapest">Cheapest first</SelectItem>
                <SelectItem value="most_trusted">Most trusted</SelectItem>
              </SelectContent>
            </Select>

            {/* Filters toggle */}
            <Button
              variant="outline"
              size="sm"
              className="gap-2 bg-white border-[#EBEBEB]"
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {hasFilters && (
                <span className="ml-1 bg-primary text-white rounded-full h-4 w-4 text-xs flex items-center justify-center">!</span>
              )}
            </Button>
          </div>
        </div>

        {/* Filter panel */}
        {filtersOpen && (
          <div className="bg-white border border-[#EBEBEB] rounded-2xl p-6 mb-6 shadow-sm">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Rent range */}
              <div>
                <label className="text-sm font-semibold mb-3 block">
                  Rent Range: ₦{rentMin.toLocaleString()} – ₦{rentMax.toLocaleString()}/mo
                </label>
                <Slider
                  min={0}
                  max={200000}
                  step={5000}
                  value={[rentMin, rentMax]}
                  onValueChange={([min, max]) => { setRentMin(min); setRentMax(max); setPage(1); }}
                  className="mt-2"
                />
              </div>

              {/* Rooms */}
              <div>
                <label className="text-sm font-semibold mb-2 block">Number of Rooms</label>
                <div className="flex gap-2 flex-wrap">
                  {["any", "1", "2", "3", "4+"].map(r => (
                    <button
                      key={r}
                      onClick={() => { setRooms(r === "any" ? "" : r); setPage(1); }}
                      className="px-4 py-1.5 rounded-full text-sm font-medium border transition-colors"
                      style={{
                        background: rooms === (r === "any" ? "" : r) ? "#FF5A5F" : "#fff",
                        color: rooms === (r === "any" ? "" : r) ? "#fff" : "#222",
                        borderColor: rooms === (r === "any" ? "" : r) ? "#FF5A5F" : "#EBEBEB",
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Clear */}
              <div className="flex items-end">
                {hasFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-destructive">
                    <X className="h-4 w-4" /> Clear filters
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
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
        ) : error ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-[#EBEBEB]">
            <div className="text-5xl mb-4">⚠️</div>
            <h3 className="text-lg font-semibold mb-2">Failed to load listings</h3>
            <p className="text-muted-foreground">Please try again in a moment.</p>
          </div>
        ) : properties.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-[#EBEBEB]">
            <div className="text-5xl mb-4">🔍</div>
            <h3 className="text-lg font-semibold mb-2">No listings found</h3>
            <p className="text-muted-foreground mb-4">Try adjusting your filters or check back later.</p>
            {hasFilters && (
              <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
            )}
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {properties.map(p => (
                <PropertyCard key={p.id} property={p} />
              ))}
            </div>

            {/* Pagination */}
            {pageCount > 1 && (
              <div className="flex justify-center items-center gap-2 mt-10">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground px-4">
                  Page {page} of {pageCount}
                </span>
                <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// useSearchParams() forces the surrounding page into a Suspense boundary
// for static prerender; this wrapper keeps the build happy.
export default function Properties() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F7F7F7]" />}>
      <PropertiesPage />
    </Suspense>
  );
}