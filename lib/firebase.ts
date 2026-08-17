// Firebase 초기화 (클라이언트 전용)
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Next.js 의 핫리로드/SSR 환경에서 앱이 중복 초기화되지 않도록 보호
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Firestore 오프라인 캐시(IndexedDB)를 켠다.
// 재방문 시 이미 받은 문서는 로컬에서 읽고, 서버에서는 '바뀐 문서'만 받아오므로
// 로딩이 크게 빨라진다. 여러 탭을 동시에 열어도 안전하도록 multi-tab 매니저 사용.
// initializeFirestore는 앱당 1회만 가능 → 핫리로드/중복 호출 시 getFirestore로 폴백.
function createDb(a: FirebaseApp): Firestore {
  if (typeof window === "undefined") return getFirestore(a); // SSR/빌드 시엔 캐시 불필요
  try {
    return initializeFirestore(a, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // 이미 초기화됐거나 IndexedDB를 못 쓰는 환경(사파리 시크릿 등) → 메모리 캐시로 동작
    return getFirestore(a);
  }
}

export const db = createDb(app);
export const googleProvider = new GoogleAuthProvider();

export const ADMIN_EMAIL =
  process.env.NEXT_PUBLIC_ADMIN_EMAIL?.toLowerCase() ?? "";

export default app;
