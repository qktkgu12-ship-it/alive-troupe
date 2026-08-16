"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@/components/Icons";

const ANIM_MS = 520; // sheet-up/down 동일 duration

/**
 * 공용 바텀시트.
 * - 스티키 헤더: X(취소) | 제목 | ✓(확인, onConfirm 있을 때만)
 * - X / ✓ / 배경 클릭 / 스와이프 모두 닫힘 애니메이션 후 onClose 호출
 * - PC(sm 이상)에서는 가운데 모달 형태로 보임.
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
  /** false를 반환(또는 resolve)하면 바텀시트를 닫지 않음 (유효성 검사 실패 등) */
  onConfirm?: () => boolean | void | Promise<boolean | void>;
  children: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startY: number; isDragging: boolean }>({ startY: 0, isDragging: false });
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  // open=false로 바뀌면 closing 상태도 초기화
  useEffect(() => {
    if (!open) {
      setClosing(false);
      closingRef.current = false;
    }
  }, [open]);

  // 열려 있을 때 배경 스크롤 잠금
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // ESC로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 닫힘 애니메이션 → onClose
  function handleClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(() => {
      onClose();
    }, ANIM_MS);
  }

  // ✓ 버튼: 확인 로직 실행 후 닫힘 (false 반환 시 유효성 실패 → 닫지 않음)
  function handleConfirm() {
    if (onConfirm?.() === false) return;
    handleClose();
  }

  // 스와이프 다운으로 닫기 (헤더 영역만)
  function onTouchStart(e: React.TouchEvent) {
    dragState.current = { startY: e.touches[0].clientY, isDragging: true };
    if (sheetRef.current) sheetRef.current.style.transition = "none";
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!dragState.current.isDragging) return;
    const dy = e.touches[0].clientY - dragState.current.startY;
    if (dy > 0 && sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (!dragState.current.isDragging) return;
    dragState.current.isDragging = false;
    const dy = e.changedTouches[0].clientY - dragState.current.startY;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "";
      sheetRef.current.style.transform = "";
    }
    if (dy > 80) handleClose();
  }

  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4 ${
        closing ? "animate-overlay-out" : "animate-overlay-in"
      }`}
      onClick={handleClose}
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-canvas shadow-2xl sm:rounded-2xl ${
          closing ? "animate-sheet-down" : "animate-sheet-up"
        }`}
        style={{ willChange: "transform" }}
      >
        {/* 스티키 헤더 */}
        <div
          className="sticky top-0 z-10 flex shrink-0 items-center justify-between bg-canvas px-4 py-3"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* X 버튼 */}
          <button
            onClick={handleClose}
            aria-label="닫기"
            className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 active:scale-95"
          >
            <XIcon className="h-[22px] w-[22px]" />
          </button>

          {/* 제목 */}
          <p className="text-[16px] font-bold text-slate-900">{title ?? ""}</p>

          {/* ✓ 버튼 */}
          {onConfirm ? (
            <button
              onClick={handleConfirm}
              aria-label="완료"
              className="grid h-11 w-11 place-items-center rounded-full bg-accent text-accent-fg shadow-sm transition hover:brightness-110 active:scale-95"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
                <path d="M4 13l5 5L20 7" />
              </svg>
            </button>
          ) : (
            <div className="h-11 w-11" />
          )}
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-4 pb-10">{children}</div>
      </div>
    </div>,
    document.body
  );
}
