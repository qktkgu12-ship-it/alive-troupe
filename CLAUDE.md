# ALIVE 극단 내부 앱 — Claude 작업 메모

## 프로젝트 개요
- Next.js 15 App Router + Firebase Firestore + FCM 푸시
- 한국어 극단(ALIVE) 내부 웹앱. 단원/관리자 역할 구분
- 브랜드 색상: `#e53535` (빨강)

## 브랜치 규칙
- **개발 브랜치**: `claude/pc-to-mobile-continuity-rd9ize`
- **기본 브랜치**: `main`
- 모든 변경은 위 개발 브랜치에서 작업 후 푸시

## 주요 구조

```
app/
  schedule/page.tsx   — 일정 페이지 (예약·확정 탭)
  api/push/route.ts   — FCM 푸시 발송 서버 엔드포인트
lib/
  types.ts            — 공통 타입 (BookingRequest 등)
  push.ts             — 클라이언트 측 푸시 헬퍼
  utils.ts            — 유틸 함수 (bookingWhenLabel 등)
  notifications.ts    — 인앱 알림 조회 로직
  firebase.ts         — 클라이언트 Firebase 초기화
  firebase-admin.ts   — 서버 Firebase Admin 초기화
firestore.rules       — Firestore 보안 규칙
```

## Firestore 컬렉션
| 컬렉션 | 용도 |
|---|---|
| `events` | 확정된 일정 |
| `bookingRequests` | 단원 예약 신청 (관리자가 승인 전 임시 보관) |
| `fcmTokens` | 기기별 FCM 토큰 (문서 ID = 토큰) |
| `posts` / `postLikes` | 게시판 |
| `archives` / `audio` | 아카이브·음원 자료실 |
| `users` | 단원 프로필 (role: guest/member/admin) |
| `productions` | 작품 정보 |
| `settings/site` | 사이트 설정 (pushPaused 등) |

## 푸시 알림 audience
- `all` — 승인된 단원 전체 (member/admin)
- `uids` — 지정 단원들 (최대 100명)
- `admins` — 관리자만
- `self` — 본인 테스트용

## 주요 히스토리
- 예약 신청·승인 흐름 (BookingRequest, PendingApprovals, 기기 알림) → **PR #1 squash merge 후 롤백됨** (2026-08-21)
  - revert 커밋: `a7d9fd9`
  - 현재 main은 `4d34835` 상태 (예약 기능 없음)

## 네이버 예약 관리 URL (관리자용)
`https://m-partner.booking.naver.com/bizes/1715363/biz-items/7953780/schedules`

## Firebase CLI
- 이 원격 샌드박스에는 Firebase CLI가 없음
- `firestore.rules` 변경 시 파일을 사용자에게 전달 → Firebase Console에서 수동 게시

## 디자인 파일 위치
- `.dc.html` 형식의 디자인 컴포넌트 파일들 (scratchpad에 임시 생성)
- SC 템플릿 문법: `<sc-for>`, `<sc-if>`, `{{ handlebars }}`
- 캔버스 시드: `seed-canvas.mjs --template --artboard --canvas`
