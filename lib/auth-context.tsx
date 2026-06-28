"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db, googleProvider, ADMIN_EMAIL } from "./firebase";
import type { Role, UserProfile } from "./types";

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  role: Role | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // 단원끼리 볼 수 있는 공개 프로필(이름·배역·기수·사진) 동기화. 연락처 등 민감정보는 제외.
  function syncPublicProfile(p: UserProfile) {
    setDoc(
      doc(db, "publicProfiles", p.uid),
      {
        name: p.name || p.displayName || "",
        part: p.part || "",
        group: p.group || "",
        avatar: p.avatar || "",
        role: p.role,
      },
      { merge: true }
    ).catch(() => {});
  }

  async function loadProfile(u: User) {
    const ref = doc(db, "users", u.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      // 최초 로그인: 프로필 생성. 관리자 이메일이면 admin, 아니면 guest(대기)
      const isAdmin = (u.email ?? "").toLowerCase() === ADMIN_EMAIL;
      const newProfile: UserProfile = {
        uid: u.uid,
        email: u.email ?? "",
        displayName: u.displayName ?? "",
        photoURL: u.photoURL ?? "",
        role: isAdmin ? "admin" : "guest",
        name: u.displayName ?? "",
        contact: "",
        part: "",
        group: "",
        createdAt: Date.now(),
      };
      await setDoc(ref, newProfile);
      setProfile(newProfile);
      syncPublicProfile(newProfile);
      return;
    }

    const data = snap.data() as UserProfile;
    // 관리자 이메일인데 아직 admin이 아니면 승격 (안전장치)
    if ((u.email ?? "").toLowerCase() === ADMIN_EMAIL && data.role !== "admin") {
      await setDoc(ref, { role: "admin" }, { merge: true });
      data.role = "admin";
    }
    setProfile(data);
    syncPublicProfile(data);
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          await loadProfile(u);
        } catch (e) {
          console.error("프로필 로드 실패", e);
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  async function signIn() {
    await signInWithPopup(auth, googleProvider);
  }

  async function signOut() {
    await fbSignOut(auth);
  }

  async function refreshProfile() {
    if (user) await loadProfile(user);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role: profile?.role ?? null,
        loading,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
