"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateProperty, useAddPropertyPhotos, usePublishProperty } from "@/api";
import NavBar from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Check, Home, Plus, ImagePlus, Loader2, X } from "lucide-react";
import { customFetch } from "@/api/custom-fetch";

const step1Schema = z.object({
  address: z.string().min(5, "Full address required (min 5 characters)"),
  rent_amount_ngn: z.number({ coerce: true }).int().positive("Monthly rent must be a positive amount"),
  deposit_amount_ngn: z.number({ coerce: true }).int().positive("Deposit must be a positive amount"),
  rooms: z.number({ coerce: true }).int().min(1).max(20),
  lease_duration_days: z.number({ coerce: true }).int().min(30).optional(),
  latitude: z.number({ coerce: true }).optional(),
  longitude: z.number({ coerce: true }).optional(),
});

const step2Schema = z.object({
  description: z.string().min(20, "Please provide at least 20 characters"),
  house_rules: z.string().optional(),
  amenities: z.record(z.boolean()).optional(),
});

const AMENITY_OPTIONS = [
  { key: "wifi", label: "WiFi" },
  { key: "electricity_backup", label: "Power Backup / Generator" },
  { key: "water", label: "Running Water" },
  { key: "security", label: "Security / Guard" },
  { key: "parking", label: "Vehicle Parking" },
  { key: "kitchen", label: "Kitchen / Cooking Area" },
  { key: "laundry", label: "Laundry Facilities" },
  { key: "air_conditioning", label: "Air Conditioning" },
];

const STEPS = ["Basic Info", "Description & Amenities", "Photos & Publish"];

export default function ListProperty() {
  const router = useRouter();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [createdPropertyId, setCreatedPropertyId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([""]);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  async function uploadPhoto(idx: number, file: File) {
    setUploadingIdx(idx);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { url } = await customFetch<{ url: string }>("/api/upload", {
        method: "POST",
        body: fd,
      });
      const next = [...photos];
      next[idx] = url;
      setPhotos(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast({ variant: "destructive", title: "Photo upload failed", description: message });
    } finally {
      setUploadingIdx(null);
    }
  }
  const [selectedAmenities, setSelectedAmenities] = useState<Record<string, boolean>>({});

  const createMutation = useCreateProperty();
  const photoMutation = useAddPropertyPhotos();
  const publishMutation = usePublishProperty();

  useEffect(() => {
    const token = localStorage.getItem("naub_token");
    const raw = localStorage.getItem("naub_user");
    if (!token || !raw) { router.push("/login"); return; }
    // Guard the parse: a corrupt/stale `naub_user` would throw here, and an
    // uncaught throw in useEffect trips Next.js's client error boundary
    // ("Application error: a client-side exception has occurred"). Clear the
    // bad value and force a fresh login instead. (dashboard/NavBar already
    // guard this; /properties/new previously did not.)
    let user: { role?: string } | null = null;
    try { user = JSON.parse(raw); } catch {
      localStorage.removeItem("naub_token");
      localStorage.removeItem("naub_user");
    }
    if (!user) { router.push("/login"); return; }
    if (!["landlord", "agent"].includes(user.role ?? "")) {
      toast({ variant: "destructive", title: "Only landlords and agents can list properties" });
      router.push("/dashboard");
    }
  }, [router, toast]);

  const form1 = useForm<z.infer<typeof step1Schema>>({
    resolver: zodResolver(step1Schema),
    defaultValues: { address: "", rent_amount_ngn: 0, deposit_amount_ngn: 0, rooms: 1 },
  });

  const form2 = useForm<z.infer<typeof step2Schema>>({
    resolver: zodResolver(step2Schema),
    defaultValues: { description: "", house_rules: "" },
  });

  const handleStep1 = async (values: z.infer<typeof step1Schema>) => {
    if (createdPropertyId) { setCurrentStep(1); return; }

    createMutation.mutate({ data: { ...values, amenities: selectedAmenities } }, {
      onSuccess: (data) => {
        setCreatedPropertyId(data.id ?? null);
        toast({ title: "Property created!", description: "Now add your description and amenities." });
        setCurrentStep(1);
      },
      onError: (e: any) => {
        toast({ variant: "destructive", title: "Failed to create property", description: e.message });
      },
    });
  };

  const handleStep2 = async (values: z.infer<typeof step2Schema>) => {
    if (!createdPropertyId) return;
    setCurrentStep(2);
  };

  const handlePublish = async () => {
    if (!createdPropertyId) return;

    const validPhotos = photos.filter(u => u.trim());
    if (validPhotos.length > 0) {
      await photoMutation.mutateAsync({
        id: createdPropertyId,
        data: { photos: validPhotos.map((url, i) => ({ photo_url: url, photo_order: i })) },
      }).catch(() => {});
    }

    publishMutation.mutate({ id: createdPropertyId }, {
      onSuccess: () => {
        toast({ title: "Listing published! 🎉", description: "Your property is now live and visible to students." });
        router.push("/dashboard");
      },
      onError: (e: any) => {
        toast({ variant: "destructive", title: "Failed to submit", description: e.message });
      },
    });
  };

  const toggleAmenity = (key: string) => {
    setSelectedAmenities(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="min-h-screen bg-[#F7F7F7]">
      <NavBar />

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ChevronLeft className="h-4 w-4" /> Back to dashboard
          </Link>
          <h1 className="text-2xl font-bold">List a Property</h1>
          <p className="text-muted-foreground text-sm mt-1">Add your property in 3 simple steps</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center mb-8">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors"
                  style={{
                    background: i < currentStep ? "#34A853" : i === currentStep ? "#FF5A5F" : "#EBEBEB",
                    color: i <= currentStep ? "#fff" : "#717171",
                  }}
                >
                  {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span className="text-xs font-medium hidden sm:block" style={{ color: i === currentStep ? "#222" : "#717171" }}>
                  {step}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 h-px mx-2" style={{ background: i < currentStep ? "#34A853" : "#EBEBEB" }} />
              )}
            </div>
          ))}
        </div>

        {/* Form container */}
        <div className="bg-white rounded-2xl border border-[#EBEBEB] shadow-sm p-6">

          {/* STEP 0: Basic info */}
          {currentStep === 0 && (
            <Form {...form1}>
              <form onSubmit={form1.handleSubmit(handleStep1)} className="space-y-5">
                <FormField control={form1.control} name="address" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Address *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 12 Maiduguri Road, Biu, Borno State" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form1.control} name="rent_amount_ngn" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Monthly Rent (₦) *</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="e.g. 30000" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form1.control} name="deposit_amount_ngn" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Security Deposit (₦) *</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="e.g. 30000" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form1.control} name="rooms" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Number of Rooms *</FormLabel>
                      <Select onValueChange={v => field.onChange(parseInt(v))} defaultValue={String(field.value)}>
                        <FormControl>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {[1, 2, 3, 4, 5, 6].map(n => (
                            <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "Room" : "Rooms"}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form1.control} name="lease_duration_days" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lease Duration</FormLabel>
                      <Select onValueChange={v => field.onChange(parseInt(v))} defaultValue="">
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Flexible" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="90">3 Months</SelectItem>
                          <SelectItem value="180">6 Months</SelectItem>
                          <SelectItem value="365">1 Year</SelectItem>
                          <SelectItem value="730">2 Years</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form1.control} name="latitude" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Latitude (optional)</FormLabel>
                      <FormControl>
                        <Input type="number" step="any" placeholder="e.g. 10.6110" {...field} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form1.control} name="longitude" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Longitude (optional)</FormLabel>
                      <FormControl>
                        <Input type="number" step="any" placeholder="e.g. 12.1909" {...field} />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>

                <Button
                  type="submit"
                  className="w-full gap-2"
                  style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Saving..." : "Continue"}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </form>
            </Form>
          )}

          {/* STEP 1: Description & Amenities */}
          {currentStep === 1 && (
            <Form {...form2}>
              <form onSubmit={form2.handleSubmit(handleStep2)} className="space-y-5">
                <FormField control={form2.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description *</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe the property: size, light, neighbours, surroundings, access to NAUB campus..."
                        rows={5}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div>
                  <Label className="text-sm font-semibold mb-3 block">Amenities</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {AMENITY_OPTIONS.map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2 p-3 border border-[#EBEBEB] rounded-lg hover:bg-[#F7F7F7] cursor-pointer"
                           onClick={() => toggleAmenity(key)}>
                        <Checkbox
                          id={key}
                          checked={!!selectedAmenities[key]}
                          onCheckedChange={() => toggleAmenity(key)}
                        />
                        <label htmlFor={key} className="text-sm cursor-pointer">{label}</label>
                      </div>
                    ))}
                  </div>
                </div>

                <FormField control={form2.control} name="house_rules" render={({ field }) => (
                  <FormItem>
                    <FormLabel>House Rules (optional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="No loud music after 10pm, no pets..." rows={3} {...field} />
                    </FormControl>
                  </FormItem>
                )} />

                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setCurrentStep(0)}>
                    <ChevronLeft className="h-4 w-4 mr-1" /> Back
                  </Button>
                  <Button type="submit" className="flex-1 gap-2" style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
                    Continue <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            </Form>
          )}

          {/* STEP 2: Photos & Publish */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <Label className="text-sm font-semibold mb-3 block">Property Photos</Label>
                <p className="text-xs text-muted-foreground mb-4">
                  Upload up to 8 photos. JPG, PNG, WebP, or GIF, max 8 MB each.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {photos.map((url, i) => (
                    <div key={i} className="relative aspect-square border border-dashed border-[#EBEBEB] rounded-xl overflow-hidden bg-[#FAFAFA]">
                      {url ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={`Photo ${i + 1}`} className="absolute inset-0 w-full h-full object-cover" />
                          <button
                            type="button"
                            aria-label="Remove photo"
                            className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                            onClick={() => {
                              const next = [...photos];
                              next[i] = "";
                              setPhotos(next);
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <label className="absolute inset-0 flex flex-col items-center justify-center gap-1 cursor-pointer text-muted-foreground hover:text-foreground hover:bg-[#F0F0F0] transition-colors">
                          {uploadingIdx === i ? (
                            <Loader2 className="h-6 w-6 animate-spin" />
                          ) : (
                            <ImagePlus className="h-6 w-6" />
                          )}
                          <span className="text-xs font-medium">
                            {uploadingIdx === i ? "Uploading…" : i === 0 ? "Add cover photo" : "Add photo"}
                          </span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            className="sr-only"
                            disabled={uploadingIdx !== null}
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (file) uploadPhoto(i, file);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>
                  ))}
                  {photos.length < 8 && (
                    <button
                      type="button"
                      className="aspect-square border border-dashed border-[#EBEBEB] rounded-xl flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:bg-[#F0F0F0] transition-colors disabled:opacity-50"
                      disabled={uploadingIdx !== null}
                      onClick={() => setPhotos(p => [...p, ""])}
                    >
                      <Plus className="h-6 w-6" />
                      <span className="text-xs font-medium">Add slot</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-[#F7F7F7] rounded-xl p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">📋 What happens next?</p>
                <p>Once you publish, your listing goes live immediately — students can find and book it right away from the landing page and browse page.</p>
              </div>

              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setCurrentStep(1)}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button
                  type="button"
                  className="flex-1 gap-2"
                  style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                  onClick={handlePublish}
                  disabled={publishMutation.isPending || photoMutation.isPending}
                >
                  {publishMutation.isPending ? "Publishing..." : "Publish Listing 🚀"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}