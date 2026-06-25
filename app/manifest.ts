import type { MetadataRoute } from "next";

// 모바일 홈 화면 추가 / PWA 매니페스트
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ALIVE 얼라이브",
    short_name: "ALIVE",
    description: "뮤지컬 극단 ALIVE 단원 전용 공간",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
