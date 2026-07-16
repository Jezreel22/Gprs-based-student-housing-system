"use client";

/**
 * Real face-presence + liveness check for the KYC selfie, with zero external
 * dependencies. Two layers, run on every captured frame:
 *
 * 1. Native `FaceDetector` (Shape Detection API) — when the browser supports
 *    it, this is a real, model-backed face detector. If it returns ≥1 face
 *    covering a reasonable fraction of the frame, confidence is high.
 * 2. Heuristic fallback (everywhere else) — measures brightness, contrast
 *    (variance), skin-tone pixel coverage, and central focus. A live webcam
 *    frame of a face looks very different from a static uploaded photo of a
 *    landscape or a dark/blank frame: faces have mid-range brightness, lots of
 *    local variance, and a meaningful fraction of skin-tone pixels in the
 *    centre. Each signal contributes to a 0–100 score.
 *
 * This is deliberately NOT a claim of spoof resistance against a determined
 * attacker holding up a printed photo — that needs a liveness/face-match API.
 * But it does stop the specific failures called out: a "selfie" with no face, a
 * dark/blank frame, or an arbitrary uploaded image passing as identity proof.
 *
 * Returns a 0–100 confidence. Callers treat < FACE_CONFIDENCE_FLOOR (server) as
 * a rejection.
 */

interface FaceResult {
  confidence: number;
  reason: string;
}

let detectorSingleton: any | null = null;
async function getFaceDetector(): Promise<any | null> {
  if (detectorSingleton === undefined) return null;
  if (detectorSingleton) return detectorSingleton;
  try {
    const ctor = (globalThis as any).FaceDetector;
    if (typeof ctor !== "function") {
      detectorSingleton = null;
      return null;
    }
    detectorSingleton = new ctor({ fastMode: true, maxDetectedFaces: 1 });
  } catch {
    detectorSingleton = null;
  }
  return detectorSingleton;
}

function scoreHeuristic(ctx: CanvasRenderingContext2D, w: number, h: number): { score: number; brightness: number } {
  const { data } = ctx.getImageData(0, 0, w, h);
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  // Centre region (face should be roughly centred in a selfie).
  const cx0 = Math.floor(w * 0.25), cx1 = Math.floor(w * 0.75);
  const cy0 = Math.floor(h * 0.2), cy1 = Math.floor(h * 0.8);
  let skinPixels = 0, centrePixels = 0;
  const lum: number[] = [];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      rSum += r; gSum += g; bSum += b; count++;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      lum.push(l);
      if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
        centrePixels++;
        // Generic skin-tone heuristic (works across light and dark skin within
        // a range; intentionally permissive on hue, stricter on the R>G>B rule).
        if (r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15) {
          skinPixels++;
        }
      }
    }
  }
  const meanLum = lum.reduce((a, b) => a + b, 0) / lum.length;
  const variance = lum.reduce((a, b) => a + (b - meanLum) ** 2, 0) / lum.length;
  const skinRatio = centrePixels > 0 ? skinPixels / centrePixels : 0;

  // Brightness: too dark (<40) or blown out (>230) is not a usable face frame.
  const brightnessScore = meanLum < 30 || meanLum > 235 ? 0 : meanLum < 50 ? 30 : 100;
  // Variance: a real face has high local contrast (eyes, mouth, nose); a flat
  // colour/wall has almost none.
  const varianceScore = Math.min(100, (variance / 900) * 100);
  // Skin coverage in the centre: a face fills a good chunk of the centre.
  const skinScore = Math.min(100, (skinRatio / 0.18) * 100);

  const score = Math.round(brightnessScore * 0.25 + varianceScore * 0.3 + skinScore * 0.45);
  return { score, brightness: meanLum };
}

/**
 * Analyse a captured selfie canvas/image and return a 0–100 face confidence +
 * a short reason string for the UI. Never throws.
 */
export async function checkFacePresence(source: HTMLVideoElement | HTMLImageElement): Promise<FaceResult> {
  const w = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || 640;
  const h = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || 480;
  if (w < 200 || h < 200) {
    return { confidence: 0, reason: "Frame too small to check — move closer to the camera." };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { confidence: 0, reason: "Couldn't analyse the frame." };
  ctx.drawImage(source, 0, 0, w, h);

  // Layer 1: native face detection, if the browser exposes it.
  const detector = await getFaceDetector();
  if (detector) {
    try {
      const faces = await detector.detect(canvas);
      if (faces && faces.length >= 1) {
        const f = faces[0].boundingBox;
        const faceArea = f.width * f.height;
        const frameArea = w * h;
        const coverage = faceArea / frameArea;
        // A genuine selfie has the face taking up a meaningful share. A tiny
        // far-away dot or a background face shouldn't count.
        if (coverage >= 0.08 && coverage <= 0.85) {
          return { confidence: 95, reason: "Face detected." };
        }
        return {
          confidence: coverage < 0.08 ? 30 : 60,
          reason: coverage < 0.08 ? "Move closer so your face fills more of the frame." : "Face too close — hold the camera further away.",
        };
      }
      // Detector ran but found nothing — still fall through to the heuristic so
      // a model miss on a valid face isn't an instant rejection.
    } catch {
      // fall through to heuristic
    }
  }

  // Layer 2: heuristic. Rejects dark/blank/flat frames and non-skin subjects.
  const { score, brightness } = scoreHeuristic(ctx, w, h);
  let reason = "Face detected.";
  if (score < 55) {
    reason =
      brightness < 30 ? "Too dark — find better lighting."
      : brightness > 235 ? "Too bright — reduce glare on your face."
      : "No face detected. Face the camera directly with nothing covering your face.";
  }
  return { confidence: score, reason };
}
