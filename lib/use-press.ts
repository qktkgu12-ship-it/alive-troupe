"use client";

import { useRef } from "react";

/**
 * 폰에서 확실하게 먹히는 '누름'. 글쓰기 툴바 버튼이 쓴다.
 *
 * ⚠️ click을 기다리면 안 된다.
 *    편집칸의 커서를 지키려면 pointerdown을 막아야 하는데, pointerdown을 막으면
 *    브라우저가 그 뒤에 만들어 주던 mousedown·click까지 같이 취소하는 기기가 있다
 *    → 버튼이 아무 일도 안 한다.
 *    그래서 누르는 순간(pointerdown)에 바로 실행하고, 뒤따라 click이 오더라도
 *    방금 처리한 것이면 무시한다. 키보드 Enter처럼 pointerdown 없이 오는 click은
 *    그대로 살아 있다.
 */
export function usePress(onPress: () => void) {
  const firedAt = useRef(0);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      firedAt.current = Date.now();
      onPress();
    },
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => {
      if (Date.now() - firedAt.current < 700) return;
      onPress();
    },
  };
}
