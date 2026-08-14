"use client";

import { useEffect } from "react";
import { XIcon } from "@/components/Icons";

/**
 * 공용 바텀시트.
 * - 스티키 헤더: X(취소) | 제목 | ✓(확인, onConfirm 있을 때만)
 * - 배경(어두운 곳) 클릭으로도 닫힘
 * PC(sm 이상)에서는 가운데 모달 형태로 보임.
 */
export default function BottomSheet({
  open,
  title,
  onClose,
  onConfirm,
  children,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  onConfirm?: () => void;
  children: React.ReactNode;
}) {
  // 열려 있을 때 배경 스크롤 잠금
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // ESC로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet-up flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-canvas shadow-2xl sm:rounded-2xl"
      >
        {/* 스티키 헤더 */}
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between bg-white/90 px-2 py-2 backdrop-blur-sm">
          {/* X 버튼 */}
          <button
            onClick={onClose}
            aria-label="닫기"
            className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
          >
            <XIcon className="h-5 w-5" />
          </button>

          {/* 제목 */}
          <p className="text-[15px] font-bold text-slate-900">{title ?? ""}</p>

          {/* ✓ 버튼 (onConfirm 있을 때만 활성) */}
          {onConfirm ? (
            <button
              onClick={onConfirm}
              aria-label="완료"
              className="grid h-10 w-10 place-items-center rounded-full bg-accent text-accent-fg transition hover:brightness-110 active:scale-95"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="M4 13l5 5L20 7" />
              </svg>
            </button>
          ) : (
            <div className="h-10 w-10" />
          )}
        </div>

        {/* 본문 (스크롤) */}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
