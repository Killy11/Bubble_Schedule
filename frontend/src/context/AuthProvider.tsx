"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { upsertUserProfile } from "@/lib/firebase/users";
import { removeToken } from "@/lib/fcm";

interface AuthContextValue {
  user: FirebaseUser | null;
  /** true until Firebase reports the initial auth state */
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (
    mode: "signin" | "signup",
    email: string,
    password: string,
  ) => Promise<void>;
  /** Mint/refresh the server session cookie from the current user. */
  syncSession: (forceFreshToken?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setLoading(false);
      }),
    [],
  );

  const syncSession = useCallback(async (forceFreshToken = false) => {
    const current = auth.currentUser;
    if (!current) throw new Error("Not signed in");
    const idToken = await current.getIdToken(forceFreshToken);
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) throw new Error("Could not create session");
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const { user: u } = await signInWithPopup(auth, provider);
    await upsertUserProfile(u);
    await syncSession(true);
  }, [syncSession]);

  const signInWithEmail = useCallback(
    async (mode: "signin" | "signup", email: string, password: string) => {
      const { user: u } =
        mode === "signup"
          ? await createUserWithEmailAndPassword(auth, email, password)
          : await signInWithEmailAndPassword(auth, email, password);
      await upsertUserProfile(u);
      await syncSession(true);
    },
    [syncSession],
  );

  const signOut = useCallback(async () => {
    // Needs the signed-in user (Firestore rules), so it goes first. Best effort.
    if (auth.currentUser) await removeToken(auth.currentUser.uid).catch(() => {});
    await fetch("/api/session", { method: "DELETE" });
    await firebaseSignOut(auth);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signInWithGoogle, signInWithEmail, syncSession, signOut }),
    [user, loading, signInWithGoogle, signInWithEmail, syncSession, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
