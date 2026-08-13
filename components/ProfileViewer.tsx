"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Avatar from "@/components/Avatar";
import Spinner from "@/components/Spinner";
import type { PublicProfile } from "@/lib/types";

type Fallback = { name?: string; avatar?: string };

interface ViewerState {
  open: (uid: string, fallback?: Fallback) => void;
  profiles: Record<string, PublicProfile | null>;
  ensure: (uid: string) => void;
  seed: (entries: Record<string, PublicProfile>) => void;
}

const Ctx = createContext<ViewerState | undefined>(undefined);

export function useProfileViewer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProfileViewer must be used within ProfileViewerProvider");
  return ctx;
}

// 최신 공개 프로필(uid → name/avatar 등)을 캐시에서 가져온다.
// 목록·댓글에 박제된 옛 이름/사진 대신 최신 프로필이 보이도록 사용.
export function useLiveProfile(uid?: string): PublicProfile | null | undefined {
  const ctx = useContext(Ctx);
  useEffect(() => {
    if (uid && ctx) ctx.ensure(uid);
  }, [uid, ctx]);
  return uid && ctx ? ctx.profiles[uid] : undefined;
}

export function ProfileViewerProvider({ children }: { children: ReactNode }) {
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [data, setData] = useState<PublicProfile | null>(null);
  const [fallback, setFallback] = useState<Fallback>({});
  const [loading, setLoading] = useState(false);

  // 실시간 공개 프로필 캐시 (uid당 한 번만 조회)
  const [profiles, setProfiles] = useState<Record<string, PublicProfile | null>>({});
  const requested = useRef<Set<string>>(new Set());
  const ensure = useCallback((uid: string) => {
    if (!uid || requested.current.has(uid)) return;
    requested.current.add(uid);
    getDoc(doc(db, "publicProfiles", uid))
      .then((snap) => setProfiles((p) => ({ ...p, [uid]: snap.exists() ? (snap.data() as PublicProfile) : null })))
      .catch(() => setProfiles((p) => ({ ...p, [uid]: null })));
  }, []);

  // 이미 한 번에 불러온 공개 프로필을 캐시에 심어 개별 재조회를 막는다. (멤버 명단 등)
  const seed = useCallback((entries: Record<string, PublicProfile>) => {
    const keys = Object.keys(entries);
    if (keys.length === 0) return;
    keys.forEach((uid) => requested.current.add(uid));
    setProfiles((p) => ({ ...entries, ...p })); // 개별 조회로 최신화된 값이 있으면 그대로 유지
  }, []);

  const open = useCallback((uid: string, fb: Fallback = {}) => {
    setOpenUid(uid);
    setFallback(fb);
    setData(null);
    setLoading(true);
    getDoc(doc(db, "publicProfiles", uid))
      .then((snap) => setData(snap.exists() ? (snap.data() as PublicProfile) : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  function close() {
    setOpenUid(null);
  }

  const name = data?.name || fallback.name || "단원";
  const avatar = data?.avatar || fallback.avatar || "";

  return (
    <Ctx.Provider value={{ open, profiles, ensure, seed }}>
      {children}

      {openUid && (
        <div
          onClick={close}
          className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[300px] rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl"
          >
            <div className="mx-auto mb-3 w-fit">
              <Avatar src={avatar} name={name} className="h-20 w-20 text-2xl" />
            </div>
            <p className="text-lg font-bold text-slate-900">{name}</p>
            {data?.role && data.role !== "guest" && (
              <span
                className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  data.role === "admin" ? "bg-accent-soft text-accent" : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {data.role === "admin" ? "관리자" : "정단원"}
              </span>
            )}

            {loading ? (
              <div className="mt-4 flex justify-center"><Spinner /></div>
            ) : data?.bio ? (
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{data.bio}</p>
            ) : (
              <p className="mt-3 text-sm text-slate-400">등록된 소개글이 없어요.</p>
            )}

            <button
              onClick={close}
              className="mt-5 w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/** 클릭하면 프로필 팝업이 뜨는 아바타 버튼 (최신 공개 프로필로 표시) */
export function ProfileAvatar({
  uid,
  name,
  avatar,
  className,
}: {
  uid?: string;
  name?: string;
  avatar?: string;
  className?: string;
}) {
  const { open } = useProfileViewer();
  const live = useLiveProfile(uid);
  const shownName = live?.name || name;
  const shownAvatar = live?.avatar ?? avatar;
  if (!uid) return <Avatar src={avatar} name={name} className={className} />;
  return (
    <button
      type="button"
      onClick={() => open(uid, { name: shownName, avatar: shownAvatar })}
      className="shrink-0 rounded-full transition hover:opacity-80"
      aria-label={`${shownName || "단원"} 프로필 보기`}
    >
      <Avatar src={shownAvatar} name={shownName} className={className} />
    </button>
  );
}

/** 최신 이름 텍스트 (프로필 변경 시 옛 이름 대신 최신으로) */
export function ProfileName({ uid, name }: { uid?: string; name?: string }) {
  const live = useLiveProfile(uid);
  return <>{live?.name || name || "단원"}</>;
}
