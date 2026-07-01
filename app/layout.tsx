import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";
import NotificationBell from "@/components/NotificationBell";
import { ProfileViewerProvider } from "@/components/ProfileViewer";

export const metadata: Metadata = {
  title: "ALIVE 얼라이브",
  description: "뮤지컬 극단 ALIVE 단원 전용 공간",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#ffffff",
};

// 강조색은 코드에 고정(globals.css). 예전 캐시 색 정리 + Pretendard 폰트를 '비차단'으로 주입.
// (기존엔 <head>의 폰트 CDN 링크가 렌더를 막아, jsdelivr가 느리면 화면이 통째로 멈추는 문제가 있었음)
const themeInitScript = `(function(){try{['alive-accent','alive-accent-fg','alive-accent-2'].forEach(function(k){localStorage.removeItem(k);});}catch(e){}try{var l=document.createElement('link');l.rel='stylesheet';l.href='https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendard-dynamic-subset.min.css';document.head.appendChild(l);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* 폰트 CDN은 아래 스크립트에서 '비차단'으로 주입 → CDN이 느려도 화면이 멈추지 않음 */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <AuthProvider>
          <ThemeProvider>
            <ProfileViewerProvider>
              {children}
              <NotificationBell />
            </ProfileViewerProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
