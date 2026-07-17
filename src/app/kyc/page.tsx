"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import AvatarUploader from "@/components/AvatarUploader";
import {
  CheckCircle, Upload, Camera, FileText, CreditCard, Building, Landmark,
  ChevronRight, RefreshCw, AlertCircle, ShieldCheck, Lock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { checkFacePresence } from "@/lib/face-check";
import { customFetch } from "@/api/custom-fetch";

interface Bank { name: string; code: string; }

type IdDocType = "nin" | "international_passport" | "drivers_licence";
type PropDocType = "certificate_of_occupancy" | "deed_of_assignment" | "right_of_occupancy" | "land_certificate";

const ID_DOCS: { id: IdDocType; label: string; desc: string; Icon: React.ElementType }[] = [
  { id: "nin", label: "National ID (NIN)", desc: "NIMC-issued NIN card or slip", Icon: CreditCard },
  { id: "international_passport", label: "International Passport", desc: "Valid Nigerian passport (any page with photo)", Icon: FileText },
  { id: "drivers_licence", label: "Driver's Licence", desc: "Valid FRSC-issued driver's licence", Icon: FileText },
];

const PROP_DOCS: { id: PropDocType; label: string; desc: string }[] = [
  { id: "certificate_of_occupancy", label: "Certificate of Occupancy (C of O)", desc: "Government-issued title document" },
  { id: "deed_of_assignment", label: "Deed of Assignment", desc: "Signed property transfer document" },
  { id: "right_of_occupancy", label: "Right of Occupancy", desc: "Right of Occupancy document" },
  { id: "land_certificate", label: "Land Certificate", desc: "Survey plan or land certificate" },
];

const STEPS = [
  { label: "ID Type", desc: "Choose your identity document" },
  { label: "Upload ID", desc: "Upload a clear photo of your ID" },
  { label: "Face Check", desc: "Live facial verification" },
  { label: "Bank", desc: "Verify a bank account in your name" },
  { label: "Property Doc", desc: "Upload property ownership document" },
  { label: "Submit", desc: "Review and submit" },
];

function compressImage(file: File, maxWidth = 900, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not supported")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
    img.src = url;
  });
}

export default function KYC() {
  const router = useRouter();
  const { toast } = useToast();

  const [user, setUser] = useState<{ id: string; email: string; role: string; first_name?: string | null; last_name?: string | null; verification_status?: string; kyc_submitted_at?: string | null } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try { setUser(JSON.parse(localStorage.getItem("naub_user") || "null")); } catch { setUser(null); }
    setToken(localStorage.getItem("naub_token"));
    setHydrated(true);
  }, []);

  // If the user has already submitted KYC, show the "under review" screen
  // instead of forcing them through the 5-step flow again. They can also
  // resume to add a missing property document from this screen.
  const alreadySubmitted = !!user?.kyc_submitted_at;

  const [step, setStep] = useState(0);
  const [idDocType, setIdDocType] = useState<IdDocType | null>(null);
  const [idDocPreview, setIdDocPreview] = useState<string | null>(null);
  const [idDocBase64, setIdDocBase64] = useState<string | null>(null);
  const [selfieBase64, setSelfieBase64] = useState<string | null>(null);
  const [propDocType, setPropDocType] = useState<PropDocType | null>(null);
  const [propDocPreview, setPropDocPreview] = useState<string | null>(null);
  const [propDocBase64, setPropDocBase64] = useState<string | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [faceConfidence, setFaceConfidence] = useState(0);
  const [faceReason, setFaceReason] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "verifying" | "done" | "error">("idle");

  // Bank-account identity anchor (resolved server-side via Paystack).
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankQuery, setBankQuery] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (!user || !token) { router.push("/login"); return; }
    if (user.role && !["landlord", "agent"].includes(user.role)) { router.push("/dashboard"); }
  }, [user, token, hydrated, router]);

  useEffect(() => {
    if (step === 2) startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [step]);

  // Load the bank list once (used for the identity-verification account picker).
  useEffect(() => {
    if (!token) return;
    customFetch<{ data: Bank[] }>("/api/banks")
      .then((r) => setBanks((r as any)?.data ?? []))
      .catch(() => { /* surfaced inline when the picker is empty */ });
  }, [token]);

  async function startCamera() {
    setCameraError(null);
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => { videoRef.current?.play(); setCameraReady(true); };
      }
    } catch (err: any) {
      setCameraError(
        err?.message?.includes("denied") || err?.name === "NotAllowedError"
          ? "Camera access denied. Please allow camera access in your browser settings and try again."
          : "Could not access camera. Please check your device or use a different browser."
      );
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraReady(false);
    if (faceLoopRef.current) { cancelAnimationFrame(faceLoopRef.current); faceLoopRef.current = null; }
  }

  // Live face-presence scan while the camera streams, so the user gets feedback
  // ("no face detected / too dark") before they even capture.
  const faceLoopRef = useRef<number | null>(null);
  useEffect(() => {
    if (!cameraReady || step !== 2) return;
    let last = 0;
    const tick = async () => {
      const now = Date.now();
      if (now - last > 600 && videoRef.current && videoRef.current.videoWidth > 0) {
        last = now;
        try {
          const res = await checkFacePresence(videoRef.current);
          setFaceConfidence(res.confidence);
          setFaceReason(res.confidence < 55 ? res.reason : null);
        } catch { /* keep scanning */ }
      }
      faceLoopRef.current = requestAnimationFrame(tick);
    };
    faceLoopRef.current = requestAnimationFrame(tick);
    return () => { if (faceLoopRef.current) cancelAnimationFrame(faceLoopRef.current); };
  }, [cameraReady, step]);

  async function captureSelfie() {
    if (!videoRef.current) return;
    // Run the real check on the frame we're about to keep.
    const check = await checkFacePresence(videoRef.current);
    setFaceConfidence(check.confidence);
    setFaceReason(check.confidence < 55 ? check.reason : null);
    if (check.confidence < 55) {
      toast({
        variant: "destructive",
        title: "Face not detected",
        description: check.reason,
      });
      return; // don't accept a frame that failed the check
    }
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save(); ctx.scale(-1, 1);
    ctx.drawImage(videoRef.current, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();
    setSelfieBase64(canvas.toDataURL("image/jpeg", 0.8));
    stopCamera();
  }

  async function handleIdDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      toast({ variant: "destructive", title: "Invalid file", description: "Please upload an image (JPG, PNG) or PDF." });
      return;
    }
    if (file.type.startsWith("image/")) {
      try {
        const compressed = await compressImage(file);
        setIdDocBase64(compressed); setIdDocPreview(compressed);
      } catch { toast({ variant: "destructive", title: "Upload failed" }); }
    } else {
      const reader = new FileReader();
      reader.onload = () => { setIdDocBase64(reader.result as string); setIdDocPreview(null); };
      reader.readAsDataURL(file);
    }
  }

  async function handlePropDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith("image/")) {
      try {
        const compressed = await compressImage(file);
        setPropDocBase64(compressed); setPropDocPreview(compressed);
      } catch { toast({ variant: "destructive", title: "Upload failed" }); }
    } else if (file.type === "application/pdf") {
      const reader = new FileReader();
      reader.onload = () => { setPropDocBase64(reader.result as string); setPropDocPreview(null); };
      reader.readAsDataURL(file);
    } else {
      toast({ variant: "destructive", title: "Invalid file", description: "Upload image or PDF." });
    }
  }

  async function handleSubmit() {
    if (!user || !token || !idDocBase64 || !selfieBase64 || !idDocType || !propDocBase64 || !propDocType) {
      // Surface the missing-field case explicitly instead of silently returning;
      // the user reported "Submission failed" with no clue, and silent returns
      // were a likely culprit for that symptom on partial flows.
      const missing: string[] = [];
      if (!idDocType) missing.push("ID document type");
      if (!idDocBase64) missing.push("ID document upload");
      if (!selfieBase64) missing.push("selfie");
      if (!propDocType) missing.push("property document type");
      if (!propDocBase64) missing.push("property ownership document");
      toast({ variant: "destructive", title: "Missing required information",
              description: `Please complete: ${missing.join(", ") || "log in"}.` });
      return;
    }
    if (faceConfidence < 55) {
      toast({ variant: "destructive", title: "Face check incomplete",
              description: faceReason ?? "Retake the selfie so a live face is clearly detected." });
      setStep(2);
      return;
    }
    if (!accountNumber || accountNumber.length !== 10 || !bankCode) {
      toast({ variant: "destructive", title: "Bank account required",
              description: "Add a bank account registered in your own name so Paystack can verify your identity." });
      setStep(3);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/auth/kyc/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          national_id_type: idDocType,
          national_id_document_url: idDocBase64,
          selfie_url: selfieBase64,
          face_confidence: faceConfidence,
          bank_account_number: accountNumber,
          bank_code: bankCode,
          property_document_url: propDocBase64 ?? undefined,
        }),
      });
      if (!res.ok) {
        // Try to extract a useful error message. Show response status + body
        // (truncated) so failures are diagnosable instead of opaque.
        const rawText = await res.text().catch(() => "");
        let serverMsg = "";
        try {
          const body = JSON.parse(rawText);
          serverMsg = body?.error || body?.message || "";
        } catch {
          // body wasn't JSON — fall through with raw text
          serverMsg = rawText.slice(0, 200);
        }
        throw new Error(
          (serverMsg ? serverMsg + " " : "") +
          `(HTTP ${res.status}${res.statusText ? " " + res.statusText : ""})`
        );
      }
      const updated = { ...user, verification_status: "verified", kyc_submitted_at: new Date().toISOString() };
      localStorage.setItem("naub_user", JSON.stringify(updated));
      setUser(updated);
      window.dispatchEvent(new Event("storage"));
      setSubmitting(false);
      setStatus("verifying");
      setTimeout(() => setStatus("done"), 2200);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Submission failed", description: err.message });
      setSubmitting(false);
    }
  }

  if (status === "verifying") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F7F7] p-4">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-sm w-full text-center space-y-6">
          <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <RefreshCw className="h-10 w-10 text-primary animate-spin" />
          </div>
          <div>
            <h2 className="text-xl font-bold mb-2">Running automated checks…</h2>
            <p className="text-muted-foreground text-sm">We're verifying your identity documents. This takes just a moment.</p>
          </div>
          <div className="space-y-2 text-sm text-left">
            {["Checking ID document", "Matching face to document", "Validating property ownership"].map((item, i) => (
              <div key={i} className="flex items-center gap-2.5 text-muted-foreground">
                <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" style={{ animationDelay: `${i * 0.3}s` }} />
                {item}…
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F7F7] p-4">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-sm w-full text-center space-y-6">
          <div className="h-20 w-20 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <ShieldCheck className="h-10 w-10 text-green-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">You're verified! 🎉</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your identity is verified. You can list properties now and start receiving bookings.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button className="w-full h-11 rounded-xl font-semibold"
                    style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                    onClick={() => router.push("/properties/new")}>
              List a Property
            </Button>
            <Button variant="outline" className="w-full h-11 rounded-xl font-semibold"
                    onClick={() => router.push("/dashboard")}>
              Go to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // If they've already submitted KYC at least once, don't force them through
  // the 5-stage flow again. Show their current status and let them add a
  // missing property document if they originally skipped it.
  if (alreadySubmitted && status === "idle") {
    const submitted = user.kyc_submitted_at ? new Date(user.kyc_submitted_at) : null;
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F7F7] p-4">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center space-y-6">
          <div className="h-20 w-20 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <ShieldCheck className="h-10 w-10 text-green-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">You're verified ✅</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your identity was verified
              {submitted && (
                <> on <span className="font-medium text-foreground">{submitted.toLocaleDateString()}</span></>
              )}
              . You can list properties and receive bookings.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button className="w-full h-11 rounded-xl font-semibold"
                    style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                    onClick={() => router.push("/properties/new")}>
              List a Property
            </Button>
            <Button variant="outline" className="w-full h-11 rounded-xl font-semibold"
                    onClick={() => router.push("/dashboard")}>
              Go to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F7F7] py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 rounded-xl items-center justify-center font-bold text-xl text-white mb-4"
               style={{ background: "#FF5A5F" }}>N</div>
          <h1 className="text-2xl font-extrabold">Identity & Property Verification</h1>
          <p className="text-muted-foreground text-sm mt-1">Required to list properties on NAUB Home Finder</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center mb-2">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div className={cn(
                  "h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                  i < step ? "text-white" : i === step ? "text-white ring-4 ring-primary/20" : "bg-[#EBEBEB] text-muted-foreground"
                )} style={i <= step ? { background: "#FF5A5F" } : {}}>
                  {i < step ? <CheckCircle className="h-4 w-4" /> : i + 1}
                </div>
                <span className={cn("text-[10px] mt-1 text-center hidden sm:block leading-tight max-w-[60px]",
                  i <= step ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 h-0.5 mx-1 mb-5 transition-colors"
                     style={{ background: i < step ? "#FF5A5F" : "#EBEBEB" }} />
              )}
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="w-full h-1 bg-[#EBEBEB] rounded-full mb-8">
          <div className="h-1 rounded-full transition-all duration-500" style={{ width: `${(step / (STEPS.length - 1)) * 100}%`, background: "#FF5A5F" }} />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-[#EBEBEB] p-7">
          {/* Step 0: ID type */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="mb-5">
                <h2 className="text-lg font-bold">Select Your Identity Document</h2>
                <p className="text-sm text-muted-foreground mt-1">Choose the government-issued ID you'll use to verify your identity</p>
              </div>
              {ID_DOCS.map(doc => (
                <button key={doc.id} onClick={() => setIdDocType(doc.id)}
                  className={cn("w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all",
                    idDocType === doc.id ? "border-primary bg-primary/5" : "border-[#EBEBEB] hover:border-primary/40 hover:bg-[#FAFAFA]")}>
                  <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                    idDocType === doc.id ? "bg-primary text-white" : "bg-[#F7F7F7] text-muted-foreground")}>
                    <doc.Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{doc.label}</p>
                    <p className="text-xs text-muted-foreground">{doc.desc}</p>
                  </div>
                  {idDocType === doc.id && <CheckCircle className="h-5 w-5 text-primary shrink-0" />}
                </button>
              ))}
              <Button className="w-full h-11 rounded-xl font-semibold mt-2" disabled={!idDocType}
                      style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                      onClick={() => setStep(1)}>
                Continue <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}

          {/* Step 1: Upload ID document */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="mb-2">
                <h2 className="text-lg font-bold">Upload Your {ID_DOCS.find(d => d.id === idDocType)?.label}</h2>
                <p className="text-sm text-muted-foreground mt-1">Take a clear photo or scan — all four corners must be visible</p>
              </div>

              <label className={cn("flex flex-col items-center justify-center w-full border-2 border-dashed rounded-xl cursor-pointer transition-colors",
                idDocPreview ? "border-primary/40 bg-primary/5 p-2" : "border-[#EBEBEB] hover:border-primary/40 hover:bg-[#FAFAFA] p-12")}>
                {idDocPreview ? (
                  <div className="w-full">
                    <img src={idDocPreview} alt="ID preview" className="w-full max-h-56 object-contain rounded-lg" />
                    <p className="text-xs text-center text-muted-foreground mt-2">Tap to change</p>
                  </div>
                ) : idDocBase64 ? (
                  <div className="text-center">
                    <FileText className="h-10 w-10 text-primary mx-auto mb-2" />
                    <p className="text-sm font-medium">PDF uploaded</p>
                    <p className="text-xs text-muted-foreground">Tap to change</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm font-medium">Click to upload</p>
                    <p className="text-xs text-muted-foreground mt-1">JPG, PNG, or PDF • Max 10MB</p>
                  </div>
                )}
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleIdDocFile} />
              </label>

              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
                Tips: Good lighting, no glare, all text readable, no flash reflection.
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setStep(0)}>Back</Button>
                <Button className="flex-1 h-11 rounded-xl font-semibold" disabled={!idDocBase64}
                        style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                        onClick={() => setStep(2)}>
                  Continue <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Face verification */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="mb-2">
                <h2 className="text-lg font-bold">Live Face Verification</h2>
                <p className="text-sm text-muted-foreground mt-1">Face the camera in good lighting, center your face in the oval, then tap Capture</p>
              </div>

              <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
                {!selfieBase64 ? (
                  <>
                    <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
                    {cameraReady && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-36 h-48 border-4 border-white/80 rounded-full" style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)" }} />
                      </div>
                    )}
                    {!cameraReady && !cameraError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <div className="text-white text-center space-y-2">
                          <RefreshCw className="h-8 w-8 mx-auto animate-spin" />
                          <p className="text-sm">Starting camera…</p>
                        </div>
                      </div>
                    )}
                    {cameraError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6">
                        <div className="text-white text-center space-y-3">
                          <AlertCircle className="h-8 w-8 mx-auto text-red-400" />
                          <p className="text-sm">{cameraError}</p>
                          <Button size="sm" variant="outline" onClick={startCamera} className="text-white border-white/50 hover:bg-white/10">
                            Try Again
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <img src={selfieBase64} alt="Captured selfie" className="w-full h-full object-cover" />
                )}
              </div>

              {!selfieBase64 && cameraReady && (
                <div className={cn(
                  "flex items-center gap-2 text-sm rounded-xl px-3 py-2.5 border",
                  faceConfidence >= 55 ? "text-green-700 bg-green-50 border-green-200" : "text-amber-800 bg-amber-50 border-amber-200",
                )}>
                  {faceConfidence >= 55 ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                  <span>{faceConfidence >= 55 ? "Face detected — ready to capture." : (faceReason ?? "Looking for a face…")}</span>
                </div>
              )}

              {selfieBase64 && (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
                  <CheckCircle className="h-4 w-4 shrink-0" /> Live face captured and checked
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-11 rounded-xl"
                        onClick={() => { setSelfieBase64(null); setStep(1); }}>Back</Button>
                {!selfieBase64 ? (
                  <Button className="flex-1 h-11 rounded-xl font-semibold" disabled={!cameraReady}
                          style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                          onClick={captureSelfie}>
                    <Camera className="h-4 w-4 mr-2" /> Capture Photo
                  </Button>
                ) : (
                  <div className="flex flex-col gap-2 flex-1">
                    <Button className="w-full h-11 rounded-xl font-semibold"
                            style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                            onClick={() => setStep(3)}>
                      Continue <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                    <button onClick={() => { setSelfieBase64(null); startCamera(); }}
                      className="text-xs text-muted-foreground hover:text-foreground text-center underline">
                      Retake photo
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Bank-account identity check */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="mb-2">
                <h2 className="text-lg font-bold">Verify Your Bank Account</h2>
                <p className="text-sm text-muted-foreground mt-1">Use an account registered in your own name. Paystack checks it against the bank before you can continue.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium block mb-1.5">Payout bank</label>
                  <input
                    value={bankQuery}
                    onChange={(e) => setBankQuery(e.target.value)}
                    placeholder="Search for your bank"
                    className="w-full h-11 rounded-xl border border-[#EBEBEB] px-3 text-sm outline-none focus:border-primary"
                  />
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-[#EBEBEB]">
                    {banks.filter((bank) => bank.name.toLowerCase().includes(bankQuery.toLowerCase())).slice(0, 12).map((bank) => (
                      <button
                        key={bank.code}
                        type="button"
                        onClick={() => { setBankCode(bank.code); setBankQuery(bank.name); }}
                        className={cn("w-full text-left px-3 py-2.5 text-sm border-b last:border-b-0 hover:bg-[#F7F7F7]", bankCode === bank.code && "bg-primary/10 text-primary font-medium")}
                      >
                        {bank.name}
                      </button>
                    ))}
                    {!banks.length && <p className="px-3 py-3 text-sm text-muted-foreground">Loading Paystack bank list…</p>}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1.5">10-digit account number</label>
                  <input
                    inputMode="numeric"
                    maxLength={10}
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="0123456789"
                    className="w-full h-11 rounded-xl border border-[#EBEBEB] px-3 font-mono text-sm outline-none focus:border-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">Paystack confirms this account is registered in your own name.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setStep(2)}>Back</Button>
                <Button className="flex-1 h-11 rounded-xl font-semibold" disabled={!bankCode || accountNumber.length !== 10}
                        style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                        onClick={() => setStep(4)}>
                  Continue <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Property ownership document */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="mb-2">
                <h2 className="text-lg font-bold">Property Ownership Document</h2>
                <p className="text-sm text-muted-foreground mt-1">Prove you own or manage the property you'll be listing</p>
              </div>

              <div className="space-y-2">
                {PROP_DOCS.map(doc => (
                  <button key={doc.id} onClick={() => setPropDocType(doc.id)}
                    className={cn("w-full flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all",
                      propDocType === doc.id ? "border-primary bg-primary/5" : "border-[#EBEBEB] hover:border-primary/40")}>
                    <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                      propDocType === doc.id ? "bg-primary text-white" : "bg-[#F7F7F7] text-muted-foreground")}>
                      <Building className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{doc.label}</p>
                      <p className="text-xs text-muted-foreground">{doc.desc}</p>
                    </div>
                    {propDocType === doc.id && <CheckCircle className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                ))}
              </div>

              {propDocType && (
                <label className={cn("flex flex-col items-center justify-center w-full border-2 border-dashed rounded-xl cursor-pointer transition-colors",
                  propDocPreview ? "border-primary/40 bg-primary/5 p-2" : "border-[#EBEBEB] hover:border-primary/40 hover:bg-[#FAFAFA] p-8 mt-2")}>
                  {propDocPreview ? (
                    <div className="w-full">
                      <img src={propDocPreview} alt="Property doc" className="w-full max-h-48 object-contain rounded-lg" />
                      <p className="text-xs text-center text-muted-foreground mt-2">Tap to change</p>
                    </div>
                  ) : propDocBase64 ? (
                    <div className="text-center">
                      <Landmark className="h-8 w-8 text-primary mx-auto mb-2" />
                      <p className="text-sm font-medium">Document uploaded</p>
                      <p className="text-xs text-muted-foreground">Tap to change</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm font-medium">Upload document</p>
                      <p className="text-xs text-muted-foreground mt-1">JPG, PNG or PDF • Max 10MB</p>
                    </div>
                  )}
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handlePropDocFile} />
                </label>
              )}

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setStep(3)}>Back</Button>
                <Button className="flex-1 h-11 rounded-xl font-semibold" disabled={!propDocBase64 || !propDocType}
                        style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                        onClick={() => setStep(5)}>
                  Continue <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 5: Review & submit */}
          {step === 5 && (
            <div className="space-y-5">
              <div className="mb-2">
                <h2 className="text-lg font-bold">Review & Submit</h2>
                <p className="text-sm text-muted-foreground mt-1">Confirm everything looks correct before submitting</p>
              </div>

              {/* Optional profile photo — lands on the dashboard avatar / NavBar
                  and shows up on listings/messages immediately. Separate from
                  the KYC face check, which is for verification only. */}
              <div className="rounded-xl border border-[#EBEBEB] p-4 flex items-center gap-4">
                <AvatarUploader user={user} size={72} hint="Update your visible profile photo" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">Profile Photo</p>
                  <p className="text-xs text-muted-foreground">
                    This is what other users see next to your name on listings and in messages.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {/* ID doc summary */}
                <div className="rounded-xl border border-[#EBEBEB] p-4 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                      <CreditCard className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-muted-foreground">Identity Document</p>
                      <p className="font-semibold text-sm">{ID_DOCS.find(d => d.id === idDocType)?.label}</p>
                    </div>
                    <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                  </div>
                  {idDocPreview && <img src={idDocPreview} alt="ID" className="w-full max-h-32 object-contain rounded-lg border border-[#EBEBEB]" />}
                </div>

                {/* Selfie summary */}
                <div className="rounded-xl border border-[#EBEBEB] p-4 flex items-center gap-4">
                  {selfieBase64 && <img src={selfieBase64} alt="Selfie" className="w-16 h-16 rounded-full object-cover border-2 border-primary/30 shrink-0" />}
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Face Verification</p>
                    <p className="font-semibold text-sm">Selfie captured</p>
                  </div>
                  <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                </div>

                {/* Property doc summary */}
                {propDocBase64 ? (
                  <div className="rounded-xl border border-[#EBEBEB] p-4 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                        <Building className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground">Property Document</p>
                        <p className="font-semibold text-sm">{PROP_DOCS.find(d => d.id === propDocType)?.label ?? "Document uploaded"}</p>
                      </div>
                      <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                    </div>
                    {propDocPreview && <img src={propDocPreview} alt="Property doc" className="w-full max-h-32 object-contain rounded-lg border border-[#EBEBEB]" />}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    Property document skipped — you can add it later from your dashboard.
                  </div>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800 flex items-start gap-2.5">
                <Lock className="h-4 w-4 shrink-0 mt-0.5 text-blue-500" />
                <span>Your documents are encrypted in transit and reviewed securely. Verification typically completes in a few minutes.</span>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setStep(4)} disabled={submitting}>Back</Button>
                <Button className="flex-1 h-11 rounded-xl font-semibold" onClick={handleSubmit} disabled={submitting}
                        style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
                  {submitting ? "Submitting…" : "Submit for Verification"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}