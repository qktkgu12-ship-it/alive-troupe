"use client";

// 화면을 꽉 채우는 오버레이용 '실제로 보이는 높이'
//
// iOS 사파리는 스크롤에 따라 하단 툴바가 접혔다 펴지는데,
// 그때 100vh·100dvh·inset-0 은 곧바로 다시 계산되지 않아
// 오버레이 아래쪽이 툴바 뒤로 잘려 보인다.
// visualViewport 가 지금 눈에 보이는 영역을 정확히 알려주므로 그 값을 쓴다.

import { useEffect, useState } from "react";

export function useViewportHeight(active: boolean): number | undefined {
  const [h, setH] = useState<number>();

  useEffect(() => {
    if (!active) return;

    const measure = () => setH(window.visualViewport?.height ?? window.innerHeight);
    measure();

    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);

    return () => {
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [active]);

  return h;
}
