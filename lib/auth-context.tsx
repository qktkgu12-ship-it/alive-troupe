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
  getRedirectResult,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db, googleProvider, ADMIN_EMAIL } from "./firebase";
import { pushSignupRequest, refreshPushToken } from "./push";
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

// 스플래시 화면 최소 표시 시간 기준점. 모듈이 로드되는 순간을 시작으로 본다.
const SPLASH_START = Date.now();
const MIN_SPLASH_MS = 600; // ms — 너무 빨리 사라지면 깜빡임처럼 보임

/**
 * 스플래시를 페이드아웃하고 숨긴다.
 * 주의: el.remove()로 DOM에서 빼면 안 된다. 이 노드는 RootLayout이 렌더한
 * React 트리의 일부라, 삭제해도 fiber에는 참조가 남는다. 이후 페이지 이동에서
 * React가 그 노드 기준으로 insertBefore를 호출하다 NotFoundError로 앱이 죽는다.
 * display:none으로 숨기기만 하면 트리는 그대로라 안전하다.
 */
function removeSplash() {
  if (typeof document === "undefined") return;
  const el = document.getElementById("alive-splash");
  if (!el) return;
  const elapsed = Date.now() - SPLASH_START;
  const delay = Math.max(0, MIN_SPLASH_MS - elapsed);
  window.setTimeout(() => {
    el.style.transition = "opacity 0.45s ease";
    el.style.opacity = "0";
    window.setTimeout(() => {
      el.style.display = "none";
    }, 470);
  }, delay);
}

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
      // 승인 대기가 생겼음을 관리자에게 알린다.
      // (안 알리면 관리자가 관리자 페이지를 열어 볼 때까지 승인이 밀린다)
      // 문구는 서버가 고정한다 — guest가 임의 내용을 주입하지 못하게 하기 위함.
      if (!isAdmin) void pushSignupRequest();
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
    // 리다이렉트 방식을 잠깐 배포했던 동안 리다이렉트 도중에 멈춘 기기가 있을 수 있어
    // 결과를 한 번 받아 준다. 평소에는 아무것도 하지 않는다.
    getRedirectResult(auth).catch(() => {
      // 대기 중인 리다이렉트가 없으면 그냥 넘어간다 (onAuthStateChanged가 최종 판단)
    });

    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          await loadProfile(u);
        } catch (e) {
          console.error("프로필 로드 실패", e);
          setProfile(null);
        }
        // 이 기기의 푸시 토큰이 아직 살아있는지 조용히 확인한다.
        // 토큰이 갱신됐거나 저장소가 회수됐으면 다시 등록해 준다.
        // 화면을 막지 않도록 기다리지 않는다.
        void refreshPushToken(u.uid);
      } else {
        setProfile(null);
      }
      setLoading(false);
      // 인증 상태 확정 → 스플래시 화면 제거
      removeSplash();
    });
    return () => unsub();
  }, []);

  async function signIn() {
    // 팝업 방식을 쓴다. signInWithRedirect는 쓰면 안 된다 —
    // authDomain(alive-troupe.firebaseapp.com)이 앱 도메인과 다른 교차 출처라,
    // Chrome 115+의 스토리지 파티셔닝 때문에 리다이렉트로 돌아와도
    // getRedirectResult()가 결과를 읽지 못하고 로그인 화면으로 되돌아온다.
    // (리다이렉트를 쓰려면 /__/auth/** 를 앱 도메인으로 리버스 프록시해야 한다)
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
