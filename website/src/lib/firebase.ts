import type { Firestore } from "firebase/firestore";

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Firebase web config values are PUBLIC by design. Security is enforced by Firestore rules.
export const firebaseReady = Boolean(cfg.apiKey && cfg.projectId && cfg.appId);

let dbPromise: Promise<Firestore | null> | null = null;

// Lazily import + initialize Firebase only when a form is actually submitted,
// keeping it out of the initial bundle.
export function getDb(): Promise<Firestore | null> {
  if (!firebaseReady) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = (async () => {
      const { initializeApp, getApps, getApp } = await import("firebase/app");
      const { getFirestore } = await import("firebase/firestore");
      const app = getApps().length ? getApp() : initializeApp(cfg as Record<string, string>);
      return getFirestore(app);
    })();
  }
  return dbPromise;
}
