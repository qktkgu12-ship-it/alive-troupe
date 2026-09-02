import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";
import { NotificationsProvider } from "@/lib/notifications-context";
import { CreateSheetProvider } from "@/lib/create-sheet-context";
import { PostEditorProvider } from "@/lib/post-editor-context";
import { ProfileViewerProvider } from "@/components/ProfileViewer";
import PwaSetup from "@/components/PwaSetup";
import BottomNav from "@/components/BottomNav";

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
  // 상태바 기본색 — 평면 캔버스와 같은 값. (흰색이면 어느 화면과도 안 맞아 경계선이 생긴다)
  // 홈에서는 빛 번짐 맨 윗줄에 맞춰 AppShell이 이 값을 다시 칠한다.
  themeColor: "#f7f8fa",
  colorScheme: "light", // 다크모드 기기의 '검은 로딩화면' 방지
};

const FONT_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendard-dynamic-subset.min.css";

// 스타일시트가 오기 전에도 배경이 흰색으로 칠해지도록 최소한의 색만 인라인으로.
// (globals.css는 별도 파일이라 로드 전 한 프레임 동안 기기 기본색 = 다크모드면 검정)
const criticalCss = `:root{color-scheme:light}html{background:#f7f8fa}body{background:#f7f8fa;color:#0f172a;margin:0;padding:0}`;

// (1) 마지막으로 본 강조색을 즉시 칠해 깜빡임 방지
// (2) 폰트 <link>를 media="print"로 받아 렌더를 막지 않다가, 다 받으면 media="all"로 전환.
//     React는 서버 HTML에 onLoad 문자열을 넣어주지 않으므로 이 스크립트가 직접 처리한다.
// (3) 안전장치: 인증이 실패해 auth-context가 스플래시를 못 내려도 8초 뒤엔 무조건 걷어낸다.
const themeInitScript = `(function(){try{var r=document.documentElement;var s=function(k,v){var x=localStorage.getItem(k);if(x)r.style.setProperty(v,x);};s('alive-accent','--accent');s('alive-accent-fg','--accent-fg');s('alive-accent-2','--accent-2');}catch(e){}try{var l=document.getElementById('alive-font');if(l){var go=function(){l.media='all';};if(l.sheet)go();else l.addEventListener('load',go);}}catch(e){}setTimeout(function(){try{var p=document.getElementById('alive-splash');if(p)p.style.display='none';}catch(e){}},8000);})();`;

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
          {/* 시각적 중심: 로고를 수학적 중심보다 ~6vh 위, 1px 오른쪽 */}
          <div style={{ transform: "translate(1px, -6vh)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/wordmark.png" alt="ALIVE" style={{ width: "min(180px, 48vw)", display: "block" }} />
          </div>
        </div>
        <AuthProvider>
          <ThemeProvider>
            <ProfileViewerProvider>
              {/* 알림 버튼은 AppShell 헤더 안에, 등록 바텀시트는 전역으로 */}
              <NotificationsProvider>
                <CreateSheetProvider>
                  <PostEditorProvider>
                  {children}
                  {/* 하단 내비게이션 — 화면을 옮겨도 다시 만들어지지 않도록
                      페이지 안이 아니라 레이아웃에 둔다 (선택 알약이 미끄러지려면 필요) */}
                  <BottomNav />
                  {/* 서비스 워커 등록 + '앱으로 설치' 배너 */}
                  <PwaSetup />
                  </PostEditorProvider>
                </CreateSheetProvider>
              </NotificationsProvider>
            </ProfileViewerProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
