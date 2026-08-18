import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";
import { NotificationsProvider } from "@/lib/notifications-context";
import { CreateSheetProvider } from "@/lib/create-sheet-context";
import { ProfileViewerProvider } from "@/components/ProfileViewer";

export const metadata: Metadata = {
  title: "ALIVE 얼라이브",
  description: "뮤지컬 극단 ALIVE 단원 전용 공간",
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#ffffff",
  colorScheme: "light", // 다크모드 기기의 '검은 로딩화면' 방지
};

const FONT_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendard-dynamic-subset.min.css";

// 스타일시트가 오기 전에도 배경이 흰색으로 칠해지도록 최소한의 색만 인라인으로.
// (globals.css는 별도 파일이라 로드 전 한 프레임 동안 기기 기본색 = 다크모드면 검정)
// alive-dot: 스플래시 로딩 인디케이터 점 애니메이션
const criticalCss = `:root{color-scheme:light}html{background:#f7f8fa}body{background:#f7f8fa;color:#0f172a;margin:0;padding:0}@keyframes alive-dot{0%,80%,100%{transform:scale(.5);opacity:.2}40%{transform:scale(1);opacity:.75}}`;

// (1) 마지막으로 본 강조색을 즉시 칠해 깜빡임 방지
// (2) 폰트 <link>를 media="print"로 받아 렌더를 막지 않다가, 다 받으면 media="all"로 전환.
//     React는 서버 HTML에 onLoad 문자열을 넣어주지 않으므로 이 스크립트가 직접 처리한다.
const themeInitScript = `(function(){try{var r=document.documentElement;var s=function(k,v){var x=localStorage.getItem(k);if(x)r.style.setProperty(v,x);};s('alive-accent','--accent');s('alive-accent-fg','--accent-fg');s('alive-accent-2','--accent-2');}catch(e){}try{var l=document.getElementById('alive-font');if(l){var go=function(){l.media='all';};if(l.sheet)go();else l.addEventListener('load',go);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* 1순위: 첫 페인트 색 확보 → 검은 화면 방지 */}
        <style dangerouslySetInnerHTML={{ __html: criticalCss }} />
        {/* 폰트 CDN 연결을 미리 열어 두면 왕복 1회(DNS+TLS)를 아낌 */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        {/* 폰트는 JS 파싱을 기다리지 않고 HTML 파싱 시점에 바로 요청 시작.
            media="print"라 렌더를 막지 않고, 아래 스크립트가 로드 후 all로 전환 */}
        <link id="alive-font" rel="stylesheet" href={FONT_CSS} media="print" />
        <noscript>
          <link rel="stylesheet" href={FONT_CSS} />
        </noscript>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {/*
         * 스플래시 화면: 서버 HTML에 포함 → JS/React 로드 전에 즉시 표시됨.
         * auth-context에서 인증 완료 후 페이드아웃·제거.
         *
         * 시각적 중심(optical center) 적용:
         *   가로형 로고(wordmark)는 수학적 중심(50%)에 두면 아래로 처져 보임.
         *   위 여백:아래 여백 ≈ 0.85:1 → translateY(-6vh)로 로고를 살짝 위로.
         */}
        <div
          id="alive-splash"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "#f7f8fa",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          {/* 시각적 중심: 로고를 수학적 중심보다 ~6vh 위로 */}
          <div style={{ transform: "translateY(-6vh)", display: "flex", flexDirection: "column", alignItems: "center", gap: "32px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/wordmark.png" alt="ALIVE" style={{ width: "min(180px, 48vw)", display: "block" }} />
            {/* 로딩 인디케이터: 3개 점이 차례로 팝업 */}
            <div style={{ display: "flex", gap: "9px" }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "rgb(var(--accent,124 58 237)/0.4)",
                    animation: `alive-dot 1.3s ease-in-out ${i * 0.22}s infinite both`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <AuthProvider>
          <ThemeProvider>
            <ProfileViewerProvider>
              {/* 알림 버튼은 AppShell 헤더 안에, 등록 바텀시트는 전역으로 */}
              <NotificationsProvider>
                <CreateSheetProvider>{children}</CreateSheetProvider>
              </NotificationsProvider>
            </ProfileViewerProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
