"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Avatar from "@/components/Avatar";
import type { PublicProfile } from "@/lib/types";

type Fallback = { name?: string; avatar?: string };

interface ViewerState {
  open: (uid: string, fallback?: Fallback) => void;
}

const Ctx = createContext<ViewerState | undefined>(undefined);

export function useProfileViewer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProfileViewer must be used within ProfileViewerProvider");
  return ctx;
}

export function ProfileViewerProvider({ children }: { children: ReactNode }) {
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [data, setData] = useState<PublicProfile | null>(null);
  const [fallback, setFallback] = useState<Fallback>({});
  const [loading, setLoading] = useState(false);

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
    <Ctx.Provider value={{ open }}>
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

            {loading ? (
              <p className="mt-2 text-sm text-slate-400">불러오는 중…</p>
            ) : (
              <div className="mt-3 space-y-1.5 text-sm">
                {data?.part ? (
                  <p className="flex items-center justify-center gap-2">
                    <span className="text-slate-400">배역·파트</span>
                    <span className="font-medium text-slate-700">{data.part}</span>
                  </p>
                ) : null}
                {data?.group ? (
                  <p className="flex items-center justify-center gap-2">
                    <span className="text-slate-400">소속·기수</span>
                    <span className="font-medium text-slate-700">{data.group}</span>
                  </p>
                ) : null}
                {!data?.part && !data?.group && (
                  <p className="text-sm text-slate-400">등록된 추가 정보가 없어요.</p>
                )}
              </div>
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

/** 클릭하면 프로필 팝업이 뜨는 아바타 버튼 */
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
  if (!uid) return <Avatar src={avatar} name={name} className={className} />;
  return (
    <button
      type="button"
      onClick={() => open(uid, { name, avatar })}
      className="shrink-0 rounded-full transition hover:opacity-80"
      aria-label={`${name || "단원"} 프로필 보기`}
    >
      <Avatar src={avatar} name={name} className={className} />
    </button>
  );
}
