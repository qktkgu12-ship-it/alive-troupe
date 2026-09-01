# ALIVE 앱

Next.js 15 + Firebase(Firestore/FCM). 단원/관리자 역할. 브랜드색 `#e53535`.

**개발 브랜치**: `claude/pc-to-mobile-continuity-rd9ize` (프리뷰 전용 — main 병합은 사용자 승인 후).  
**최신 커밋**: `8a4af3c` — 예약 확인 바텀시트 + 승인 대기 UI 개선

## 핵심 파일
- `app/schedule/page.tsx` — 일정(예약·확정 탭) ← 주요 작업 파일
- `app/api/push/route.ts` — FCM 발송 서버 (audience: all/uids/admins/self)
- `lib/types.ts`, `lib/push.ts`, `lib/utils.ts`, `lib/notifications.ts`
- `firestore.rules` — 변경 시 Firebase Console에서 수동 게시 (CLI 없음)
- `components/BottomSheet.tsx` — 공용 바텀시트 (onConfirm이 false 반환 시 닫히지 않음)

## 컬렉션
`events`·`bookingRequests`·`fcmTokens`·`posts`·`users`·`productions`·`settings/site`(pushPaused)·`coordinations`·`externalBookings`

## ⚠️ 배포 대기 중 (Firebase Console에서 수동 게시 필요)
`firestore.rules` 파일이 이미 최신 상태임 — Firebase Console → Firestore → 규칙 탭에 붙여넣고 게시만 하면 됨.  
미배포 시 단원이 `bookingRequests` 쓰기 권한 없어서 예약 신청 실패함.

---

## 현재 구현 완료된 기능 (브랜치에 존재)

### 확정 탭 (EventsSection)
- **달력**: 더블탭 → 관리자는 일정 등록 시트, 단원은 예약 신청 시트(해당 날짜 자동 선택)
- **externalBookings**: 달력에 외부 손님 예약 표시, 날짜 탭 시 DateConflictModal
- **팀 필터 칩**: 같은 줄 우측에 타원형 텍스트 버튼
  - 단원: `+ 예약하기` (빨간 pill)
  - 관리자: `+ 일정 등록` (빨간 pill)
- **PendingApprovals** (관리자 전용): 승인 대기 목록
  - 신청자 아바타·이름·팀 배지 표시
  - 카드 클릭 → 펼쳐서 확정/거절
  - 확정 시 `events` 생성 + `bookingRequests` 삭제 + 단원에게 확정 알림
  - 확정 후 네이버 예약관리 바텀시트

### BookingRequestSheet (단원 예약 신청)
컴포넌트 위치: `app/schedule/page.tsx` 내 `function BookingRequestSheet`

**플로우**:
1. "예약하기" 버튼 또는 달력 더블탭 → 바텀시트 열림
2. 일정 이름 + 장소 입력
3. 참여인원 카드 (팀탭: settings.teams 전체 표시, 개별탭: 단원 목록 + 본인 자동 체크)
4. 달력에서 날짜 1개 선택 → 시간바 표시
5. 하단 "이 일정으로 예약하기" 버튼 또는 헤더 ✓ 버튼
   → **확인 바텀시트** "이 일정으로 예약할까요?" (일정/장소/날짜/시간/대상 요약)
   → "네, 예약할게요" → Firestore `bookingRequests` 저장 + 관리자 푸시
   → **성공 바텀시트** "예약이 신청되었습니다!" → 확인 → 모든 시트 닫힘

**핵심 구현 포인트**:
- `onConfirm={requestConfirm}` — `false` 반환 → BottomSheet 안 닫힘 (확인시트 열기)
- `confirmStep: null | "confirm" | "success"` 상태로 3단계 관리
- `closeAll()`: confirmStep 초기화 + onClose() 모두 호출

### CoordSection (일정 잡기 탭)
- "일정방 만들기" 버튼: `h-9 w-9` 원형 아이콘 버튼 (헤더 우측)
- 일정방 만들기 폼: `CoordCreateForm` (팀/개별 대상 선택, 날짜 후보)
- 일정방 상세: `CoordDetail` (히트맵, 가능 날짜 제출)

---

## 주요 컴포넌트 레퍼런스

### BottomSheet props
```tsx
<BottomSheet
  open={boolean}
  title="제목"
  onClose={() => ...}
  onConfirm={() => false | void}  // false 반환 시 닫히지 않음
>
```

### BookingRequest 타입 (lib/types.ts)
```ts
export interface BookingRequest {
  id: string;
  requesterUid: string; requesterName: string; requesterAvatar?: string;
  title: string; date: string; startTime: string; endTime: string;
  location?: string;
  team?: string; participantUids?: string[]; participantLabel?: string;
  createdAt: number;
}
```

### 아이콘/스타일 레퍼런스
- 빨간 pill 버튼: `flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold text-accent-fg` + `style={{ backgroundColor: "rgb(var(--accent))" }}`
- 원형 아이콘 버튼: `grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-accent-fg`
- 브랜드색: `rgb(var(--accent))` = `#e53535`

---

## 히스토리
- 예약 신청·승인 흐름 + 기기 알림: PR #1 → **롤백됨** (2026-08-21, revert `a7d9fd9`)
- 네이버 예약 관리: `https://m-partner.booking.naver.com/bizes/1715363/biz-items/7953780/schedules`
- 이후 재구현 + UI 개편 진행 중 (브랜치 `claude/pc-to-mobile-continuity-rd9ize`)
