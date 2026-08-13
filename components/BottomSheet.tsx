"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 공용 바텀시트.
 * - 아래에서 부드럽게 올라오는 슬라이드 애니메이션
 * - 위쪽 드래그 핸들(그래버)을 아래로 끌어 닫기
 * - 배경(어두운 곳) 클릭으로도 닫힘
 * PC(sm 이상)에서는 가운데 모달 형태로 보임.
 */
export default function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);

  // 열려 있을 때 배경 스크롤 잠금
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // 열릴 때마다 드래그 위치 초기화
  useEffect(() => {
    if (open) {
      setDrag(0);
      setDragging(false);
    }
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

  function onDown(e: React.PointerEvent) {
    setDragging(true);
    startY.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!dragging) return;
    setDrag(Math.max(0, e.clientY - startY.current));
  }
  function onUp() {
    if (!dragging) return;
    setDragging(false);
    if (drag > 110) onClose();
    else setDrag(0);
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: dragging ? "none" : "transform 0.25s ease",
        }}
        className="animate-sheet-up flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-canvas shadow-2xl sm:rounded-2xl"
      >
        {/* 드래그 핸들 (아래로 끌어 닫기) — 터치 영역 넓게 */}
        <div
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="flex w-full shrink-0 cursor-grab touch-none flex-col items-center bg-white py-3 active:cursor-grabbing"
        >
          <span className="h-1.5 w-10 rounded-full bg-slate-300" />
        </div>

        {title && (
          <div className="shrink-0 bg-white px-4 pb-3 pt-1.5">
            <p className="text-center font-bold text-slate-900">{title}</p>
          </div>
        )}

        {/* 본문 (스크롤) */}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
