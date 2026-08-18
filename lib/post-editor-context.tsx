"use client";

// 게시판 글쓰기·수정 시트를 어디서든 열 수 있게 해 주는 전역 통로.
//
// 모바일에서는 전체화면 시트가 열리고, PC에서는 기존 /board/write 페이지로 간다.
// (시트는 키보드·툴바를 전제로 만든 모바일용 화면이라)

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PostEditorSheet, { type EditorTarget } from "@/components/PostEditorSheet";
import { isMobileDevice } from "@/lib/utils";
import type { Post } from "@/lib/types";

type Ctx = {
  /** 새 글 쓰기. cat을 주면 그 게시판으로 미리 맞춰 둔다 */
  openWrite: (cat?: string) => void;
  /** 기존 글 고치기 */
  openEdit: (post: Post, onSaved?: (p: Post) => void) => void;
};

const PostEditorContext = createContext<Ctx>({ openWrite: () => {}, openEdit: () => {} });

export const usePostEditor = () => useContext(PostEditorContext);

export function PostEditorProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [target, setTarget] = useState<EditorTarget>(null);

  const openWrite = useCallback(
    (cat?: string) => {
      if (!isMobileDevice()) {
        router.push(cat ? `/board/write?cat=${encodeURIComponent(cat)}` : "/board/write");
        return;
      }
      setTarget({ cat });
    },
    [router]
  );

  const openEdit = useCallback((post: Post, onSaved?: (p: Post) => void) => {
    setTarget({ post, onSaved });
  }, []);

  const value = useMemo(() => ({ openWrite, openEdit }), [openWrite, openEdit]);

  return (
    <PostEditorContext.Provider value={value}>
      {children}
      <PostEditorSheet open={!!target} target={target} onClose={() => setTarget(null)} />
    </PostEditorContext.Provider>
  );
}
