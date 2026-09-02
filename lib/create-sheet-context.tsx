"use client";

// 전역 '등록 바텀시트'.
// 어느 페이지에 있든(홈 포함) 페이지 이동 없이 그 자리에서 등록 시트가 올라옴.
// 게시판 글쓰기는 에디터가 커서 기존처럼 /board/write 페이지로 이동.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import BottomSheet from "@/components/BottomSheet";
import ArchiveForm from "@/components/forms/ArchiveForm";
import AudioForm from "@/components/forms/AudioForm";
import EventForm from "@/components/forms/EventForm";
import type { Production } from "@/lib/types";

// 일정방 만들기는 일정 페이지('일정 잡기' 탭)에서 직접 처리
export type CreateKind = "archive" | "audio" | "event";

const SHEET_TITLE: Record<CreateKind, string> = {
  archive: "자료 등록",
  audio: "자료실 등록",
  event: "확정 일정 등록",
};

const DEFAULT_CATEGORIES = ["음원", "기타"];

type Ctx = {
  openCreate: (kind: CreateKind) => void;
  closeCreate: () => void;
  /** 등록이 끝나면 올라가는 신호 — 페이지가 목록을 새로고침할 때 사용 */
  createdAt: { kind: CreateKind; at: number } | null;
};

const CreateSheetContext = createContext<Ctx>({
  openCreate: () => {},
  closeCreate: () => {},
  createdAt: null,
});

export const useCreateSheet = () => useContext(CreateSheetContext);

export function CreateSheetProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, role } = useAuth();
  const { settings } = useTheme();
  const isAdmin = role === "admin";

  const [kind, setKind] = useState<CreateKind | null>(null);
  const [productions, setProductions] = useState<Production[]>([]);
  const [createdAt, setCreatedAt] = useState<{ kind: CreateKind; at: number } | null>(null);
  const globalSubmitRef = useRef<(() => void) | null>(null);

  const openCreate = useCallback((k: CreateKind) => setKind(k), []);
  const closeCreate = useCallback(() => setKind(null), []);

  // 자료 등록(아카이브·자료실)에 필요한 작품 목록은 시트를 열 때만 불러옴
  useEffect(() => {
    if (kind !== "archive" && kind !== "audio") return;
    if (!user) return;
    let alive = true;
    (async () => {
      const q = isAdmin
        ? query(collection(db, "productions"), orderBy("order", "asc"))
        : query(collection(db, "productions"), where("participants", "array-contains", user.uid));
      const snap = await getDocs(q);
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Production, "id">) }))
        .sort((a, b) => a.order - b.order);
      if (alive) setProductions(list);
    })();
    return () => {
      alive = false;
    };
  }, [kind, user, isAdmin]);

  function done(k: CreateKind) {
    setCreatedAt({ kind: k, at: Date.now() });
    setKind(null);
  }

  const authorName = profile?.name || profile?.displayName || "";
  const categories =
    settings.resourceCategories && settings.resourceCategories.length > 0
      ? settings.resourceCategories
      : DEFAULT_CATEGORIES;

  // 오늘 날짜(로컬)
  const today = (() => {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  })();

  return (
    <CreateSheetContext.Provider value={{ openCreate, closeCreate, createdAt }}>
      {children}

      <BottomSheet open={!!kind} title={kind ? SHEET_TITLE[kind] : undefined} onClose={closeCreate} onConfirm={() => globalSubmitRef.current?.()}>
        {kind === "archive" && user && (
          <ArchiveForm
            productions={productions}
            isAdmin={isAdmin}
            author={{ uid: user.uid, name: authorName }}
            onSaved={() => done("archive")}
            onCancel={closeCreate}
            submitRef={globalSubmitRef}
          />
        )}

        {kind === "audio" && (
          <AudioForm
            productions={productions}
            categories={categories}
            defaultCat={categories[0] ?? "음원"}
            addedByName={authorName}
            onAdded={() => done("audio")}
            onCancel={closeCreate}
            submitRef={globalSubmitRef}
          />
        )}

        {kind === "event" && (
          <EventForm
            initial={{ date: today, startTime: "", endTime: "" }}
            onSaved={() => done("event")}
            onCancel={closeCreate}
            submitRef={globalSubmitRef}
          />
        )}
      </BottomSheet>
    </CreateSheetContext.Provider>
  );
}
