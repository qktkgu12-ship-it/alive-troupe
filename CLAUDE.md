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

---

# 🎨 인수인계 — 레이아웃 다듬기 (진행 중)

**사용자는 홈 화면 레이아웃을 계속 다듬고 싶어 한다.** 아래는 지금까지의 맥락이다.

## 지켜야 할 원칙

**"정보를 빼지 말고 시각적 무게를 낮춘다."**
사용자가 동의한 방향이다. 화면이 답답했던 원인은 정보량이 아니라 모든 요소가 같은 크기로 외치고 있어서였다.
→ 요소를 삭제하는 제안보다, **굵기·명도·그림자·여백을 조절**하는 제안을 먼저 하라.

**개성은 남긴다.** 카드 라운드, 이모지 아이콘, 팀 컬러바는 이 앱의 정체성이라 유지하기로 했다. "미니멀하게 만들자"는 방향은 거절당했다.

**하단 내비는 건드리지 않는다.** 인스타그램 치수를 실측해 맞췄고 스크롤 축소·사파리 툴바 대응까지 들어간, 완성도가 가장 높은 부분이다. 외부 피드백이 여기를 1순위로 지목한 적 있으나 사용자와 함께 기각했다.

## 이미 적용된 것 (되돌리지 말 것)

| 항목 | 값 | 이유 |
|---|---|---|
| 홈 인사말 | 인사 + 캐치프라이즈 (**날짜 줄 없음**) | 날짜는 폰 상단바와 중복 |
| 캐러셀 카드 높이 | **160px 고정** (비율 아님) | 비율은 넓은 기기에서 과하게 커짐 |
| 카드 머리 정렬 | `flex-col + justify-start` | ⚠️ `<button>`은 내용을 세로 가운데로 모은다. 늘리면 D-day·제목이 중앙으로 밀린다 |
| 페이지 인디케이터 | 14px · 무채색 slate-500 | 일정별 강조색이 로고(빨강)와 충돌 |
| 텍스트 계층 | 섹션 18/bold/900 · 항목 15/medium/800 · 메타 12/400 | 굵기와 명도를 **같이** 낮춰야 계층이 생김 |
| 아이콘 배경 | `bg-slate-50` | 목록 훑을 때 눈이 아이콘마다 걸리던 문제 |
| 여백 | 섹션 사이 `space-y-6` ↑ / 행 안쪽 `py-2` ↓ | 여백이 '박스 안'이 아니라 '정보 사이'에 있어야 함 |
| 그림자 | `.card`·일정 카드 모두 낮춤 | 진하면 카드마다 테두리처럼 보임 |

## 아직 안 한 것 (다음 후보)

1. **캐러셀 오른쪽 정렬 어긋남** — 카드가 아래 섹션 카드보다 오른쪽이 안으로 들어와 있다. peek(옆 카드 살짝 보이기) 때문인데, 잘린 화살표 버튼과 겹쳐 "정렬이 깨진 화면"처럼 보인다. **peek을 없애고 아래 카드와 폭을 맞추는 쪽**을 권했다.
2. **캐러셀 섹션 제목 없음** — 아카이브·자료실은 `제목 >` 헤더가 있는데 정작 제일 중요한 일정 카드만 제목이 없다. `다가오는 일정 >` 복구 제안했으나 아직 미적용.
3. **아이콘 언어 불일치** — 아카이브는 컬러 이모지, 자료실은 단색 음표. **사용자가 이모지는 건드리지 말라고 했으므로 통일 제안은 하지 말 것.**
4. **초록 카드 vs 빨간 로고** — 개별 지정 일정이 맨 위에 오면 화면이 초록으로 읽힌다. 인디케이터는 이미 무채색으로 바꿨고, 남은 건 `오늘` 칩과 펼치기 버튼.

## 작업 방식

- 프리뷰 브랜치에 올려 사용자가 확인 → OK 하면 main 병합. **main 병합은 항상 승인 후.**
- 로그인이 필요해 브라우저로 화면 확인이 안 된다. `npx next build`로 검증하고, **화면 확인은 사용자에게 맡긴다** — 확인 못 했으면 못 했다고 말할 것.
- 사용자는 비개발자다. 수치 변경은 **왜 그 값인지**와 **되돌리는 법**을 같이 알려 주면 좋아한다.
- 외부 AI 피드백을 가져와 의견을 묻는 일이 잦다. **동의만 하지 말고 코드를 실제로 확인하고 판단하라** — 지난번 피드백은 아이콘 크기를 76px로 단언했으나 실제는 36px였다.

## 남은 기술 부채 (레이아웃과 별개)

- `events/{id}/absences`·`attendees`를 일정마다 2회씩 조회 → 일정 20개면 쿼리 40회. 참석자 수를 일정 문서에 비정규화하면 해결되나 구조 변경이라 보류 중.
- `app/schedule/page.tsx` 3600줄. 분할하면 유지보수는 좋아지나 실행 속도는 그대로고 회귀 위험만 커서 권하지 않았다.

---

## 히스토리
- 예약 신청·승인 + 기기 알림: PR #1 → 롤백(2026-08-21, `a7d9fd9`) → 재구현 후 2026-09-02 프로덕션 배포
- 네이버 연동: 2026-09-02부터 **소속회원 예약 처리 제거** — 모든 네이버 예약이 `externalBookings`로만 들어가 시간만 차단. 단원 예약은 홈페이지 '예약 신청'으로만 받는다.
- 네이버 예약 관리 페이지: `https://m-partner.booking.naver.com/bizes/1715363/biz-items/7953780/schedules`
