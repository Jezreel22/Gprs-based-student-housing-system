"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLogin } from "@/api";
import { GoogleLogin } from "@react-oauth/google";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { GraduationCap, Building2, ChevronLeft, ShieldCheck, Eye, EyeOff } from "lucide-react";
import Logo from "@/components/Logo";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});
type LoginForm = z.infer<typeof loginSchema>;

type Role = "student" | "landlord";

function saveAuth(token: string, user: object) {
  localStorage.setItem("naub_token", token);
  localStorage.setItem("naub_user", JSON.stringify(user));
  window.dispatchEvent(new Event("storage"));
}

export default function Login() {
  const router = useRouter();
  const { toast } = useToast();
  const loginMutation = useLogin();
  const [role, setRole] = useState<Role | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [googlePending, setGooglePending] = useState(false);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  function onSuccess(token: string, user: any) {
    saveAuth(token, user);
    // KYC is a one-time flow triggered after registration; do not re-route to /kyc
    // on subsequent logins based on national_id_verified_at. If a landlord
    // skipped it at signup, they can resume from the dashboard.
    const dest = "/dashboard";
    toast({ title: "Welcome back!", description: `Logged in as ${user.first_name ?? user.email}.` });
    router.push(dest);
  }

  function onSubmit(values: LoginForm) {
    loginMutation.mutate(
      // Send the selected tab so the server can reject a landlord email on the
      // Student tab (and vice-versa). `role` is guaranteed non-null here — the
      // form only renders after a tab is picked.
      { data: { ...values, role: role ?? "student" } },
      {
        onSuccess: (res) => onSuccess(res.token, res.user),
        onError: (err) => {
          toast({ variant: "destructive", title: "Login failed", description: (err as any).error ?? err.message });
        },
      }
    );
  }

  async function handleGoogleSuccess(credential: string) {
    setGooglePending(true);
    try {
      const res = await fetch(`/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, role: role ?? "student" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Google sign-in failed");
      onSuccess(data.token, data.user);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Google sign-in failed", description: err.message });
    } finally {
      setGooglePending(false);
    }
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
          <h2 className="text-3xl font-extrabold leading-tight">Safe housing for NAUB students</h2>
          <p className="text-white/80 text-sm leading-relaxed">
            Verified listings, escrow-protected payments, and trusted landlords — all in one place.
          </p>
          <div className="space-y-3">
            {[
              { icon: ShieldCheck, label: "Escrow-protected rent payments" },
              { icon: ShieldCheck, label: "Verified landlords with KYC checks" },
              { icon: ShieldCheck, label: "GPS occupancy verification" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3 text-sm text-white/90">
                <Icon className="h-4 w-4 text-white/70 shrink-0" />
                {label}
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-white/40">&copy; {new Date().getFullYear()} NAUB Home Finder</p>
      </div>

      {/* Right: auth panel */}
      <div className="flex-1 flex items-center justify-center p-6">
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
              <h1 className="text-2xl font-extrabold mb-1">Welcome back</h1>
              <p className="text-muted-foreground text-sm mb-8">Choose how you're logging in</p>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <button onClick={() => setRole("student")}
                  className="group flex flex-col items-center gap-3 p-6 bg-white rounded-2xl border-2 border-transparent hover:border-primary transition-all hover:shadow-md">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                       style={{ background: "#FFF0F0" }}>
                    <GraduationCap className="h-7 w-7 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-sm">Student</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Find housing</p>
                  </div>
                </button>

                <button onClick={() => setRole("landlord")}
                  className="group flex flex-col items-center gap-3 p-6 bg-white rounded-2xl border-2 border-transparent hover:border-primary transition-all hover:shadow-md">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                       style={{ background: "#FFF0F0" }}>
                    <Building2 className="h-7 w-7 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-sm">Landlord</p>
                    <p className="text-xs text-muted-foreground mt-0.5">List properties</p>
                  </div>
                </button>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                Don't have an account?{" "}
                <Link href="/register" className="font-semibold text-primary hover:underline">Sign up</Link>
              </p>
            </div>
          ) : (
            /* ── Login form ── */
            <div>
              <button onClick={() => setRole(null)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                     style={{ background: "#FFF0F0" }}>
                  {role === "student"
                    ? <GraduationCap className="h-5 w-5 text-primary" />
                    : <Building2 className="h-5 w-5 text-primary" />}
                </div>
                <div>
                  <h1 className="text-xl font-extrabold leading-tight">
                    {role === "student" ? "Student" : "Landlord / Agent"} Login
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    {role === "student" ? "Access your housing dashboard" : "Manage your property listings"}
                  </p>
                </div>
              </div>

              {/* Google button — students only, if configured */}
              {role === "student" && GOOGLE_CLIENT_ID && (
                <div className="mb-5">
                  <div className="flex justify-center">
                    <GoogleLogin
                      onSuccess={(resp) => resp.credential && handleGoogleSuccess(resp.credential)}
                      onError={() => toast({ variant: "destructive", title: "Google sign-in failed" })}
                      size="large"
                      width="100%"
                      text="signin_with"
                      shape="rectangular"
                    />
                  </div>

                  <div className="flex items-center gap-3 my-5">
                    <div className="flex-1 h-px bg-[#EBEBEB]" />
                    <span className="text-xs text-muted-foreground">or continue with email</span>
                    <div className="flex-1 h-px bg-[#EBEBEB]" />
                  </div>
                </div>
              )}

              {/* Landlord notice */}
              {role === "landlord" && (
                <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5 text-sm text-amber-800">
                  <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>Landlords must complete identity & property verification after signing in.</span>
                </div>
              )}

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email address</FormLabel>
                      <FormControl>
                        <Input placeholder="you@example.com" type="email" {...field}
                               className="h-11 rounded-xl bg-white" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input type={showPassword ? "text" : "password"} placeholder="••••••••"
                                 {...field} className="h-11 rounded-xl bg-white pr-10" />
                          <button type="button" onClick={() => setShowPassword(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <Button type="submit" className="w-full h-11 rounded-xl font-semibold"
                          style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                          disabled={loginMutation.isPending || googlePending}>
                    {loginMutation.isPending ? "Signing in…" : "Sign In"}
                  </Button>
                </form>
              </Form>

              <p className="text-center text-sm text-muted-foreground mt-6">
                Don't have an account?{" "}
                <Link href={`/register?role=${role}`} className="font-semibold text-primary hover:underline">
                  Sign up
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}