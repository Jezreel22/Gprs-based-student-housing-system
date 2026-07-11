"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRegister } from "@/api";
import { GoogleLogin } from "@react-oauth/google";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  GraduationCap, Building2, ChevronLeft, ShieldCheck, CheckCircle2, Eye, EyeOff,
} from "lucide-react";
import Logo from "@/components/Logo";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

type Role = "student" | "landlord";

const studentSchema = z.object({
  first_name: z.string().min(1, "Required"),
  last_name: z.string().min(1, "Required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "At least 6 characters"),
  matriculation_number: z.string().optional(),
});

const landlordSchema = z.object({
  first_name: z.string().min(1, "Required"),
  last_name: z.string().min(1, "Required"),
  email: z.string().email("Invalid email"),
  phone_number: z.string().min(10, "Enter a valid phone number"),
  password: z.string().min(8, "At least 8 characters"),
  confirm_password: z.string().min(1, "Required"),
}).refine(d => d.password === d.confirm_password, {
  message: "Passwords do not match",
  path: ["confirm_password"],
});

function saveAuth(token: string, user: object) {
  localStorage.setItem("naub_token", token);
  localStorage.setItem("naub_user", JSON.stringify(user));
  window.dispatchEvent(new Event("storage"));
}

function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const { toast } = useToast();
  const registerMutation = useRegister();
  const [showPw, setShowPw] = useState(false);
  const [googlePending, setGooglePending] = useState(false);

  const qRole = new URLSearchParams(search).get("role") as Role | null;
  const [role, setRole] = useState<Role | null>(qRole && ["student", "landlord"].includes(qRole) ? qRole : null);

  const studentForm = useForm<z.infer<typeof studentSchema>>({
    resolver: zodResolver(studentSchema),
    defaultValues: { first_name: "", last_name: "", email: "", password: "", matriculation_number: "" },
  });
  const landlordForm = useForm<z.infer<typeof landlordSchema>>({
    resolver: zodResolver(landlordSchema),
    defaultValues: { first_name: "", last_name: "", email: "", phone_number: "", password: "", confirm_password: "" },
  });

  function handleSuccess(token: string, user: any) {
    saveAuth(token, user);
    toast({ title: "Account created!", description: `Welcome, ${user.first_name ?? user.email}!` });
    if (user.role === "student") router.push("/dashboard");
    else router.push("/kyc");
  }

  async function handleGoogleSuccess(credential: string) {
    setGooglePending(true);
    try {
      const res = await fetch(`/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, role: "student" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Google sign-in failed");
      handleSuccess(data.token, data.user);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Google sign-in failed", description: err.message });
    } finally {
      setGooglePending(false);
    }
  }

  function onStudentSubmit(values: z.infer<typeof studentSchema>) {
    registerMutation.mutate(
      { data: { ...values, role: "student" as any } },
      {
        onSuccess: (res) => handleSuccess(res.token, res.user),
        onError: (err) => toast({ variant: "destructive", title: "Registration failed", description: (err as any).error ?? err.message }),
      }
    );
  }

  function onLandlordSubmit(values: z.infer<typeof landlordSchema>) {
    const { confirm_password, ...rest } = values;
    registerMutation.mutate(
      { data: { ...rest, role: "landlord" as any } },
      {
        onSuccess: (res) => handleSuccess(res.token, res.user),
        onError: (err) => toast({ variant: "destructive", title: "Registration failed", description: (err as any).error ?? err.message }),
      }
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: "#F7F7F7" }}>
      {/* Left decorative panel */}
      <div className="hidden lg:flex w-[420px] shrink-0 flex-col justify-between p-10 text-white"
           style={{ background: "linear-gradient(155deg, #FF5A5F 0%, #c0363a 100%)" }}>
        <Link href="/" className="flex items-center gap-2">
          <Logo size={36} variant="glass" />
          <span className="font-bold text-lg">NAUB Home Finder</span>
        </Link>
        <div className="space-y-6">
          <h2 className="text-3xl font-extrabold leading-tight">
            {role === "landlord" ? "List your property, reach verified students" : "Find your perfect student home"}
          </h2>
          <p className="text-white/80 text-sm leading-relaxed">
            {role === "landlord"
              ? "Complete your KYC to become a verified landlord and list properties on Nigeria's safest student housing platform."
              : "Browse hundreds of verified listings near NAUB campus with full escrow payment protection."}
          </p>
          {role === "landlord" && (
            <div className="space-y-3">
              {[
                "Quick KYC — verified in minutes",
                "List unlimited properties",
                "Secure, escrow-protected payments",
                "Dispute resolution support",
              ].map(l => (
                <div key={l} className="flex items-center gap-2.5 text-sm text-white/90">
                  <CheckCircle2 className="h-4 w-4 text-white/70 shrink-0" /> {l}
                </div>
              ))}
            </div>
          )}
          {role === "student" && (
            <div className="space-y-3">
              {[
                "Free to sign up with email or Google",
                "100+ verified listings near campus",
                "Chat directly with landlords",
                "Escrow protects your payment",
              ].map(l => (
                <div key={l} className="flex items-center gap-2.5 text-sm text-white/90">
                  <CheckCircle2 className="h-4 w-4 text-white/70 shrink-0" /> {l}
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-white/40">&copy; {new Date().getFullYear()} NAUB Home Finder</p>
      </div>

      {/* Right: form area */}
      <div className="flex-1 flex items-start justify-center p-6 pt-10 pb-16 overflow-y-auto">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <Link href="/" className="flex items-center gap-2">
              <Logo size={36} variant="solid" />
              <span className="font-bold text-lg">NAUB Home Finder</span>
            </Link>
          </div>

          {!role ? (
            /* ── Role picker ── */
            <div>
              <h1 className="text-2xl font-extrabold mb-1">Create an account</h1>
              <p className="text-muted-foreground text-sm mb-8">Who are you joining as?</p>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <button onClick={() => setRole("student")}
                  className="group flex flex-col items-center gap-3 p-6 bg-white rounded-2xl border-2 border-transparent hover:border-primary transition-all hover:shadow-md">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                       style={{ background: "#FFF0F0" }}>
                    <GraduationCap className="h-7 w-7 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-sm">Student</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Find housing near campus</p>
                  </div>
                </button>

                <button onClick={() => setRole("landlord")}
                  className="group flex flex-col items-center gap-3 p-6 bg-white rounded-2xl border-2 border-transparent hover:border-primary transition-all hover:shadow-md">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                       style={{ background: "#FFF0F0" }}>
                    <Building2 className="h-7 w-7 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-sm">Landlord / Agent</p>
                    <p className="text-xs text-muted-foreground mt-0.5">List your properties</p>
                  </div>
                </button>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-primary hover:underline">Log in</Link>
              </p>
            </div>

          ) : role === "student" ? (
            /* ── Student registration ── */
            <div>
              <button onClick={() => setRole(null)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFF0F0" }}>
                  <GraduationCap className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-extrabold leading-tight">Student Sign Up</h1>
                  <p className="text-xs text-muted-foreground">Free and instant — no verification required</p>
                </div>
              </div>

              {/* Google sign-up */}
              {GOOGLE_CLIENT_ID && (
                <div className="mb-5">
                  <div className="flex justify-center">
                    <GoogleLogin
                      onSuccess={(resp) => resp.credential && handleGoogleSuccess(resp.credential)}
                      onError={() => toast({ variant: "destructive", title: "Google sign-in failed" })}
                      size="large" width="100%" text="signup_with" shape="rectangular"
                    />
                  </div>
                  <div className="flex items-center gap-3 my-5">
                    <div className="flex-1 h-px bg-[#EBEBEB]" />
                    <span className="text-xs text-muted-foreground">or sign up with email</span>
                    <div className="flex-1 h-px bg-[#EBEBEB]" />
                  </div>
                </div>
              )}

              <Form {...studentForm}>
                <form onSubmit={studentForm.handleSubmit(onStudentSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={studentForm.control} name="first_name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl><Input placeholder="Amina" {...field} className="h-11 rounded-xl bg-white" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={studentForm.control} name="last_name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl><Input placeholder="Usman" {...field} className="h-11 rounded-xl bg-white" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={studentForm.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email address</FormLabel>
                      <FormControl><Input placeholder="you@example.com" type="email" {...field} className="h-11 rounded-xl bg-white" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={studentForm.control} name="matriculation_number" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Matric Number <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                      <FormControl><Input placeholder="NAUB/2024/..." {...field} className="h-11 rounded-xl bg-white" /></FormControl>
                      <FormDescription>Helps verify your student status faster</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={studentForm.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input type={showPw ? "text" : "password"} placeholder="At least 6 characters"
                                 {...field} className="h-11 rounded-xl bg-white pr-10" />
                          <button type="button" onClick={() => setShowPw(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full h-11 rounded-xl font-semibold mt-1"
                          style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                          disabled={registerMutation.isPending || googlePending}>
                    {registerMutation.isPending ? "Creating account…" : "Create Student Account"}
                  </Button>
                </form>
              </Form>

              <p className="text-center text-sm text-muted-foreground mt-5">
                Already have an account?{" "}
                <Link href="/login?role=student" className="font-semibold text-primary hover:underline">Log in</Link>
              </p>
            </div>

          ) : (
            /* ── Landlord registration ── */
            <div>
              <button onClick={() => setRole(null)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFF0F0" }}>
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-extrabold leading-tight">Landlord Sign Up</h1>
                  <p className="text-xs text-muted-foreground">Identity & property verification required</p>
                </div>
              </div>

              <div className="mb-5 bg-blue-50 border border-blue-200 rounded-xl p-3 flex gap-2.5 text-sm text-blue-800">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-blue-500" />
                <span>After signing up you'll complete a quick KYC to verify your identity and property ownership — takes under 5 minutes.</span>
              </div>

              <Form {...landlordForm}>
                <form onSubmit={landlordForm.handleSubmit(onLandlordSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={landlordForm.control} name="first_name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl><Input placeholder="Musa" {...field} className="h-11 rounded-xl bg-white" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={landlordForm.control} name="last_name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl><Input placeholder="Ibrahim" {...field} className="h-11 rounded-xl bg-white" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={landlordForm.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email address</FormLabel>
                      <FormControl><Input placeholder="you@example.com" type="email" {...field} className="h-11 rounded-xl bg-white" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={landlordForm.control} name="phone_number" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl><Input placeholder="+234 800 000 0000" type="tel" {...field} className="h-11 rounded-xl bg-white" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={landlordForm.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input type={showPw ? "text" : "password"} placeholder="At least 8 characters"
                                 {...field} className="h-11 rounded-xl bg-white pr-10" />
                          <button type="button" onClick={() => setShowPw(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={landlordForm.control} name="confirm_password" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} className="h-11 rounded-xl bg-white" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full h-11 rounded-xl font-semibold mt-1"
                          style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                          disabled={registerMutation.isPending}>
                    {registerMutation.isPending ? "Creating account…" : "Continue to Identity Verification"}
                  </Button>
                </form>
              </Form>

              <p className="text-center text-sm text-muted-foreground mt-5">
                Already have an account?{" "}
                <Link href="/login?role=landlord" className="font-semibold text-primary hover:underline">Log in</Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// useSearchParams() forces the surrounding page into a Suspense boundary
// for static prerender; this wrapper keeps the build happy.
export default function Register() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F7F7F7]" />}>
      <RegisterPage />
    </Suspense>
  );
}