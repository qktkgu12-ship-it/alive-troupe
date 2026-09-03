import type { MetadataRoute } from "next";

// 모바일 홈 화면 추가 / PWA 매니페스트
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ALIVE 얼라이브",
    short_name: "ALIVE",
    description: "뮤지컬 극단 ALIVE 단원 전용 공간",
    start_url: "/",
    // 앱에서 열었을 때 이 범위를 벗어나면 브라우저로 빠진다.
    // 구글 로그인은 accounts.google.com으로 나갔다 오므로 범위 밖 이동을 허용해야 한다.
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f8fa", // 스플래시 배경 — 앱의 첫 화면 색과 맞춤
    theme_color: "#f7f8fa", // 상태바 기본색 — 캔버스와 맞춤 (홈에서는 JS가 빛 번짐 색으로 교체)
    lang: "ko",
    categories: ["productivity", "social"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // 아이콘을 길게 누르면 뜨는 바로가기
    shortcuts: [
      { name: "일정", short_name: "일정", url: "/schedule" },
      { name: "게시판", short_name: "게시판", url: "/board" },
      { name: "자료실", short_name: "자료실", url: "/audio" },
    ],
  };
}
