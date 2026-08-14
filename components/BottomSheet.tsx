"use client";

import { useEffect, useRef } from "react";
import { XIcon } from "@/components/Icons";

/**
 * 공용 바텀시트.
 * - 스티키 헤더: X(취소) | 제목 | ✓(확인, onConfirm 있을 때만)
 * - 배경(어두운 곳) 클릭으로도 닫힘
 * - 위에서 아래로 스와이프해서 닫기 (핸들 없음)
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
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startY: number; isDragging: boolean }>({ startY: 0, isDragging: false });

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

  // 스와이프 다운으로 닫기 (헤더 영역만)
  function onTouchStart(e: React.TouchEvent) {
    dragState.current = { startY: e.touches[0].clientY, isDragging: true };
    if (sheetRef.current) sheetRef.current.style.transition = "none";
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!dragState.current.isDragging) return;
    const dy = e.touches[0].clientY - dragState.current.startY;
    if (dy > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (!dragState.current.isDragging) return;
    dragState.current.isDragging = false;
    const dy = e.changedTouches[0].clientY - dragState.current.startY;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "";
      sheetRef.current.style.transform = "";
    }
    if (dy > 80) onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet-up flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-canvas shadow-2xl sm:rounded-2xl"
        style={{ willChange: "transform" }}
      >
        {/* 스티키 헤더 — 배경색은 바텀시트 배경(canvas)과 동일 */}
        <div
          className="sticky top-0 z-10 flex shrink-0 items-center justify-between bg-canvas px-4 py-3"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* X 버튼 — 흰색 배경 */}
          <button
            onClick={onClose}
            aria-label="닫기"
            className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 active:scale-95"
          >
            <XIcon className="h-[22px] w-[22px]" />
          </button>

          {/* 제목 */}
          <p className="text-[16px] font-bold text-slate-900">{title ?? ""}</p>

          {/* ✓ 버튼 (onConfirm 있을 때만 활성) */}
          {onConfirm ? (
            <button
              onClick={onConfirm}
              aria-label="완료"
              className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 active:scale-95"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
                <path d="M4 13l5 5L20 7" />
              </svg>
            </button>
          ) : (
            <div className="h-11 w-11" />
          )}
        </div>

        {/* 본문 (스크롤) — 하단 여백 pb-10으로 여유 있게 */}
        <div className="flex-1 overflow-y-auto p-4 pb-10">{children}</div>
      </div>
    </div>
  );
}
