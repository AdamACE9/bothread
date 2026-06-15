import { firebaseReady, getDb } from "./firebase";
import type { SubmitResult } from "./waitlist";

export type FeedbackCategory = "bug" | "feature" | "general" | "other";

export interface FeedbackInput {
  category: FeedbackCategory;
  message: string;
  email?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitFeedback({
  category,
  message,
  email,
}: FeedbackInput): Promise<SubmitResult> {
  const msg = message.trim();
  if (!msg) return { ok: false, message: "Please write a short message." };
  if (msg.length > 4000) return { ok: false, message: "Please keep it under 4000 characters." };

  const mail = email?.toLowerCase().trim();
  if (mail && !EMAIL_RE.test(mail)) {
    return { ok: false, message: "That email doesn’t look right — leave it blank or fix it." };
  }
  if (!firebaseReady) {
    return { ok: false, message: "Feedback isn’t connected yet — please try again shortly." };
  }

  try {
    const db = await getDb();
    if (!db) return { ok: false, message: "Feedback isn’t connected yet — please try again shortly." };
    const { addDoc, collection, serverTimestamp } = await import("firebase/firestore");
    await addDoc(collection(db, "feedback"), {
      category,
      message: msg,
      email: mail && mail.length ? mail : null,
      createdAt: serverTimestamp(),
      userAgent: navigator.userAgent.slice(0, 512),
      page: window.location.pathname.slice(0, 200),
    });
    return { ok: true, message: "Thank you — we read every note." };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "permission-denied") {
      return { ok: false, message: "Submission was blocked. Please try again later." };
    }
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
