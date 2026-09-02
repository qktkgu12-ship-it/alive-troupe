# ALIVE 앱

Next.js 15 + Firebase(Firestore/FCM). 단원/관리자 역할. 브랜드색 `#e53535`.

**저장소**: `qktkgu12-ship-it/alive-troupe`
**브랜치**: `main`=프로덕션 / `claude/pc-to-mobile-continuity-rd9ize`=프리뷰 작업용
→ 작업은 프리뷰 브랜치에 올리고, **main 병합은 사용자 승인 후**.

## 핵심 파일
- `app/schedule/page.tsx` — 일정(예약·확정·일정잡기 탭) ← 주요 작업 파일, 3500줄대
- `components/EventCard.tsx` — 일정 카드 공용 (홈 캐러셀 `carousel` / 목록 `list` 두 변형)
- `components/forms/EventForm.tsx` — 확정 일정 등록·수정 폼 (달력 + 타임바)
- `components/ScheduleCarousel.tsx` — 홈 상단 캐러셀
- `app/api/push/route.ts` — FCM 발송 (audience: all/uids/admins/self)
- `app/api/cron/reminder/route.ts` — 내일 일정 리마인더 (Vercel Cron)
- `lib/types.ts`, `lib/push.ts`, `lib/utils.ts`, `lib/notifications.ts`
- `components/BottomSheet.tsx` — 공용 바텀시트 (onConfirm이 false 반환 시 닫히지 않음)

## 컬렉션
`events`(+`absences`/`attendees` 하위) · `bookingRequests` · `externalBookings` · `coordinations`(+`availability`) · `fcmTokens` · `posts` · `users` · `publicProfiles` · `productions` · `settings/site`(pushPaused)

## ⚠️ 파일만 고치면 반영 안 되는 것 2가지

**CLI가 없어서 콘솔에 직접 붙여넣어야 한다. 사용자는 비개발자 → 항상 전체 코드로 줄 것.**

| 파일 | 어디에 |
|---|---|
| `firestore.rules` | Firebase Console → Firestore → 규칙 탭 → 게시 |
| `scripts/naver-booking-appscript.gs` | script.google.com 프로젝트에 붙여넣기 |

---

## 기기 알림 (FCM)

`/api/push`가 ID 토큰으로 발신자 등급을 확인한 뒤 발송한다.
guest가 `admins`로 보내면 서버가 문구를 고정한다(가입 신청 전용 — 임의 내용 주입 방지).
`settings/site`의 `pushPaused`로 전체 중지 가능.

| 상황 | 받는 사람 | 위치 |
|---|---|---|
| 새 일정 등록 | 전체 | `EventForm` |
| 일정 변경(날짜·시간·장소만) | 참여자 | `EventForm` |
| 일정 취소 | 참여자 | `EventsSection.removeEvent` |
| 예약 신청 | 관리자 | `BookingRequestSheet` |
| 예약 승인 / 거절 | 신청자 | `PendingApprovals` |
| 불참 — 전체·팀 일정 | 관리자 | `EventCard.setAbsent` |
| 불참 — 개별 지정 일정 | 대상 인원 | `EventCard.setAbsent` |
| 대상 아닌 사람이 참석 | 원래 대상 인원 | `EventCard.setAttend` |
| 새 가입 신청 | 관리자 | `lib/auth-context` |
| 가입 승인 | 본인 | `app/admin` |
| 일정방 생성 / 확정 / 재촉 | 대상자 | `CoordSection`·`CoordDetail` |
| 새 글·공지 / 댓글 | 전체 / 관련자 | `board`·`PostEditorSheet` |
| 새 아카이브·음원 | 작품 참여자 | `ArchiveForm`·`AudioForm` |
| **내일 일정 리마인더** | 참여자(불참자 제외) | `api/cron/reminder` |

**리마인더**: Vercel Cron이 매일 11:00 UTC(=한국 20시) 호출. `vercel.json`에 스케줄, 환경변수 `CRON_SECRET` 필요.
**Cron은 프로덕션에서만 동작** — 프리뷰 브랜치에서는 안 돌아간다.

---

## 주요 화면 구조

### 홈 (`app/page.tsx`)
인사말 헤더 → `ScheduleCarousel` → 아카이브 / 자료실 / 전체글 카드.
캐러셀 카드는 접힘 **높이 160px 고정**(비율 아님), 펼치면 내용만큼 늘어난다.
페이지 인디케이터는 무채색 — 일정별 강조색을 쓰면 로고(빨강)와 부딪히고 의미도 안 읽힌다.

### 확정 탭 (`EventsSection`)
- 월 헤더 줄 우측에 승인대기 dot + `예약하기`/`일정 등록` 버튼 (팀 필터 칩은 제거됨)
- 달력 더블탭 → 관리자는 등록 시트, 단원은 예약 신청 시트
- `PendingApprovals` — 확정 시 `events` 생성 + `bookingRequests` 삭제 + 신청자에게 알림 + 네이버 차단 시트

### 예약 신청 / 확정 일정 등록·수정
셋 다 **같은 날짜·시간 UI**를 쓴다 — 달력 그리드 + 30분 슬롯 타임바(두 번 탭해 범위 선택).
- 일정 있는 날짜: 점 표시 → 선택 시 `DateConflictModal`("그래도 선택하시겠습니까")
- 이미 잡힌 시간대: 회색. **관리자 폼은 회색도 선택 가능**(일부러 겹쳐야 할 때가 있음) → 고르면 빗금 + 경고 문구
- 수정 모드에서는 자기 자신을 겹침 대상에서 제외

### 일정 잡기 탭 (`CoordSection`)
`CoordCreateForm`(대상·후보 날짜) → `CoordDetail`(히트맵, 가능 날짜 제출, 방장은 미제출자 재촉·확정).

---

## 레퍼런스

```tsx
<BottomSheet open title="제목" onClose={...} onConfirm={() => false | void} />
// onConfirm이 false를 반환하면 시트가 닫히지 않는다 (확인 단계용)
```

- 빨간 pill 버튼: `flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold text-accent-fg` + `style={{ backgroundColor: "rgb(var(--accent))" }}`
- 원형 아이콘 버튼: `grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-accent-fg`
- 브랜드색: `rgb(var(--accent))` = `#e53535`
- 텍스트 계층(홈): 섹션 제목 `18px bold slate-900` / 항목 제목 `15px medium slate-800` / 메타 `12px slate-400`

## 히스토리
- 예약 신청·승인 + 기기 알림: PR #1 → 롤백(2026-08-21, `a7d9fd9`) → 재구현 후 2026-09-02 프로덕션 배포
- 네이버 연동: 2026-09-02부터 **소속회원 예약 처리 제거** — 모든 네이버 예약이 `externalBookings`로만 들어가 시간만 차단. 단원 예약은 홈페이지 '예약 신청'으로만 받는다.
- 네이버 예약 관리 페이지: `https://m-partner.booking.naver.com/bizes/1715363/biz-items/7953780/schedules`
