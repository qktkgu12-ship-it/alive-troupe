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

// 화면이 그려지기 직전에 실행 → 마지막으로 본 테마색을 즉시 칠해 깜빡임 방지
const themeInitScript = `(function(){try{var r=document.documentElement;var s=function(k,v){var x=localStorage.getItem(k);if(x)r.style.setProperty(v,x);};s('alive-accent','--accent');s('alive-accent-fg','--accent-fg');s('alive-bg','--bg');s('alive-surface','--surface');s('alive-surface-strong','--surface-strong');}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          as="style"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendard-dynamic-subset.min.css"
        />
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
