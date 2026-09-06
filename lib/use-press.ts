"use client";

import { useRef } from "react";

/** 이만큼 넘게 움직였으면 '누른 것'이 아니라 '민 것'으로 본다 (px) */
const SLOP = 10;

/**
 * 폰에서 확실하게 먹히는 '누름'. 글쓰기 툴바 버튼이 쓴다.
 *
 * ⚠️ click만 기다리면 안 된다.
 *    편집칸의 커서를 지키려면 pointerdown의 기본 동작을 막아야 하는데,
 *    그러면 브라우저가 뒤에 만들어 주던 mousedown·click까지 같이 취소하는 기기가 있다
 *    → 버튼이 아무 일도 안 한다.
 *
 * ⚠️ 그렇다고 pointerdown에서 바로 실행하면 안 된다.
 *    툴바는 넘치면 가로로 미는 줄이라, 밀려고 손을 대는 순간 그 자리의 버튼이
 *    실행돼 버린다. 실제로 "밀다가 엉뚱한 게 눌린다"는 게 이것 때문이었다.
 *
 * 그래서 **막는 건 pointerdown에서, 실행은 pointerup에서** 한다.
 * pointerup은 기본 동작을 막아도 그대로 오므로 둘 다 만족한다.
 * 손이 SLOP보다 많이 움직였으면 민 것으로 보고 실행하지 않는다.
 * 키보드 Enter처럼 pointerdown 없이 오는 click은 그대로 살아 있다.
 */
export function usePress(onPress: () => void) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const firedAt = useRef(0);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      // 커서를 지키려고 기본 동작만 막는다. 실행은 손을 뗄 때.
      e.preventDefault();
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      if (Math.abs(e.clientX - s.x) > SLOP || Math.abs(e.clientY - s.y) > SLOP) return;
      firedAt.current = Date.now();
      onPress();
    },
    // 스크롤이 시작되면 브라우저가 pointercancel을 보낸다 → 누름을 없던 일로
    onPointerCancel: () => {
      start.current = null;
    },
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => {
      if (Date.now() - firedAt.current < 700) return;
      onPress();
    },
  };
}
