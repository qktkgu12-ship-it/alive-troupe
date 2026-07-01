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

// 강조색은 이제 코드에 고정(globals.css). 예전에 캐시된 색이 덮어쓰지 않도록 한 번 정리.
const themeInitScript = `(function(){try{['alive-accent','alive-accent-fg','alive-accent-2'].forEach(function(k){localStorage.removeItem(k);});}catch(e){}})();`;

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
