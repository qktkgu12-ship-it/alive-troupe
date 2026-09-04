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

// 본문 글꼴 — 원티드 산스 (wanteddev/wanted-sans, SIL OFL).
//
// split 빌드를 쓴다. 통짜 파일은 1.26MB지만 이건 92조각으로 나뉘어 있어
// unicode-range로 화면에 실제로 쓰인 글자 조각만 받아 온다 (Pretendard와 같은 방식).
//
// ⚠️ 주소를 바꿀 땐 반드시 응답이 200인지 확인할 것.
//    예전 Pretendard 주소가 404였는데 아무 표시가 없어서, 이 앱은 오랫동안
//    웹폰트 없이 기기 기본 글꼴로 그려지고 있었다 (PC는 맑은 고딕, 아이폰은 애플 SD).
//    글자 위치가 기기마다 미묘하게 다르던 것도 그 탓이었다.
const FONT_CSS =
  "https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.3/packages/wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.css";

// 토스페이스 — 이모지 글꼴 (https://github.com/toss/tossface, TossSpace License).
// 기기마다 제각각인 시스템 이모지(애플·구글·삼성) 대신 어디서나 같은 그림이 나온다.
//
// ⚠️ 이 글꼴은 이모지만 있는 게 아니라 숫자·#·* 자모도 들고 있다(키캡 이모지 1️⃣ 때문).
//    그래서 앱 전체 글꼴 목록 맨 앞에 두면 안 된다 — 본문 숫자까지 이 글꼴로 그려진다.
//    globals.css의 .tf 클래스를 붙인 곳(이모지만 들어 있는 칸)에서만 쓴다.
const EMOJI_CSS = "https://cdn.jsdelivr.net/gh/toss/tossface/dist/tossface.css";

// 스타일시트가 오기 전에도 배경이 흰색으로 칠해지도록 최소한의 색만 인라인으로.
// (globals.css는 별도 파일이라 로드 전 한 프레임 동안 기기 기본색 = 다크모드면 검정)
const criticalCss = `:root{color-scheme:light}html{background:#f7f8fa}body{background:#f7f8fa;color:#0f172a;margin:0;padding:0}`;

// (1) 마지막으로 본 강조색을 즉시 칠해 깜빡임 방지
// (2) 폰트 <link>를 media="print"로 받아 렌더를 막지 않다가, 다 받으면 media="all"로 전환.
//     React는 서버 HTML에 onLoad 문자열을 넣어주지 않으므로 이 스크립트가 직접 처리한다.
// (3) 안전장치: 인증이 실패해 auth-context가 스플래시를 못 내려도 8초 뒤엔 무조건 걷어낸다.
const themeInitScript = `(function(){try{var r=document.documentElement;var s=function(k,v){var x=localStorage.getItem(k);if(x)r.style.setProperty(v,x);};s('alive-accent','--accent');s('alive-accent-fg','--accent-fg');s('alive-accent-2','--accent-2');}catch(e){}try{['alive-font','alive-emoji'].forEach(function(id){var l=document.getElementById(id);if(!l)return;var go=function(){l.media='all';};if(l.sheet)go();else l.addEventListener('load',go);});}catch(e){}setTimeout(function(){try{var p=document.getElementById('alive-splash');if(p)p.style.display='none';}catch(e){}},8000);})();`;

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
        {/* suppressHydrationWarning: 위 스크립트가 React보다 먼저 media를 all로 바꿔 두므로
            서버 HTML(print)과 화면(all)이 다르다. 의도된 차이라 경고만 끈다. */}
        <link id="alive-font" rel="stylesheet" href={FONT_CSS} media="print" suppressHydrationWarning />
        {/* 이모지 글꼴도 같은 방식으로 — 늦게 와도 시스템 이모지가 먼저 보일 뿐이라
            글이 안 보이는 구간은 없다 */}
        <link id="alive-emoji" rel="stylesheet" href={EMOJI_CSS} media="print" suppressHydrationWarning />
        <noscript>
          <link rel="stylesheet" href={FONT_CSS} />
          <link rel="stylesheet" href={EMOJI_CSS} />
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
