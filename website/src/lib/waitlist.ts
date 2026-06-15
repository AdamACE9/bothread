import { firebaseReady, getDb } from "./firebase";

export type WaitlistSource = "hero" | "waitlist" | "footer";
export interface SubmitResult {
  ok: boolean;
  message: string;
}

// base64url of the normalized email — a safe, deduplicating Firestore document id.
function encodeEmail(email: string): string {
  return btoa(email).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitWaitlist(
  rawEmail: string,
  source: WaitlistSource = "hero"
): Promise<SubmitResult> {
  const email = rawEmail.toLowerCase().trim();

  if (!email || email.length < 5 || email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, message: "Please enter a valid email address." };
  }
  if (!firebaseReady) {
    return { ok: false, message: "The waitlist isn’t connected yet — please try again shortly." };
  }

  try {
    const db = await getDb();
    if (!db) return { ok: false, message: "The waitlist isn’t connected yet — please try again shortly." };
    const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
    // setDoc with the email as id = idempotent upsert (a repeat signup is a no-op, not a dupe).
    await setDoc(doc(db, "waitlist", encodeEmail(email)), {
      email,
      source,
      createdAt: serverTimestamp(),
      userAgent: navigator.userAgent.slice(0, 512),
    });
    return { ok: true, message: "You’re on the list. We’ll reach out with access." };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "permission-denied") {
      return { ok: false, message: "Submission was blocked. Please try again later." };
    }
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
