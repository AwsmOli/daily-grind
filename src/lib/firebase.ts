import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import {
  getMessaging,
  isSupported as isMessagingSupported,
  type Messaging,
} from "firebase/messaging";

const env = import.meta.env as ImportMetaEnv;

const requiredKeys: Array<keyof ImportMetaEnv> = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

export const isFirebaseConfigured = requiredKeys.every((key) => {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
});

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = isFirebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

const createFirestoreClient = () => {
  if (!app) return null;

  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentSingleTabManager(undefined),
      }),
    });
  } catch {
    return getFirestore(app);
  }
};

export const auth = app ? getAuth(app) : null;
export const db = createFirestoreClient();
export const functionsClient = app ? getFunctions(app) : null;

export const getMessagingClient = async (): Promise<Messaging | null> => {
  if (!app) return null;

  try {
    const supported = await isMessagingSupported();
    return supported ? getMessaging(app) : null;
  } catch {
    return null;
  }
};
