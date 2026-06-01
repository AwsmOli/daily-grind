import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { defineStore } from "pinia";
import { ref } from "vue";

import { auth, isFirebaseConfigured } from "../lib/firebase";

export const useSessionStore = defineStore("session", () => {
  const user = ref<User | null>(null);
  const isBooting = ref(true);
  const error = ref("");
  const hasInitialized = ref(false);

  let resolveBooting: () => void;
  const bootPromise = new Promise<void>((resolve) => {
    resolveBooting = resolve;
  });
  const waitForBoot = () => bootPromise;

  const init = () => {
    if (hasInitialized.value) return;
    hasInitialized.value = true;

    if (!auth || !isFirebaseConfigured) {
      isBooting.value = false;
      resolveBooting!();
      return;
    }

    onAuthStateChanged(auth, (nextUser) => {
      user.value = nextUser;
      isBooting.value = false;
      resolveBooting!();
    });
  };

  const ensureAnonymousSession = async () => {
    if (!auth) throw new Error("Firebase Auth is not configured.");

    if (auth.currentUser) return auth.currentUser;

    const credential = await signInAnonymously(auth);
    user.value = credential.user;
    return credential.user;
  };

  const loginWithEmail = async (email: string, password: string) => {
    if (!auth) throw new Error("Firebase Auth is not configured.");

    const credential = await signInWithEmailAndPassword(
      auth,
      email.trim(),
      password,
    );
    user.value = credential.user;
    return credential.user;
  };

  const requestPasswordReset = async (email: string) => {
    if (!auth) throw new Error("Firebase Auth is not configured.");
    await sendPasswordResetEmail(auth, email.trim());
  };

  const logout = async () => {
    if (!auth) return;

    await signOut(auth);
    user.value = null;
  };

  return {
    user,
    isBooting,
    error,
    init,
    waitForBoot,
    logout,
    ensureAnonymousSession,
    loginWithEmail,
    requestPasswordReset,
  };
});
