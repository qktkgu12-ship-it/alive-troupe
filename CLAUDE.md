# ALIVE 앱

Next.js 15 + Firebase(Firestore/FCM). 단원/관리자 역할. 브랜드색 `#e53535`.

**개발 브랜치**: `claude/pc-to-mobile-continuity-rd9ize` (프리뷰 전용 — main 병합은 사용자 승인 후).

## 핵심 파일
- `app/schedule/page.tsx` — 일정(예약·확정 탭)
- `app/api/push/route.ts` — FCM 발송 서버 (audience: all/uids/admins/self)
- `lib/types.ts`, `lib/push.ts`, `lib/utils.ts`, `lib/notifications.ts`
- `firestore.rules` — 변경 시 Firebase Console에서 수동 게시 (CLI 없음)

## 컬렉션
`events`·`bookingRequests`·`fcmTokens`·`posts`·`users`·`productions`·`settings/site`(pushPaused)

## 히스토리
- 예약 신청·승인 흐름 + 기기 알림: PR #1 → **롤백됨** (2026-08-21, revert `a7d9fd9`)
- 네이버 예약 관리: `https://m-partner.booking.naver.com/bizes/1715363/biz-items/7953780/schedules`

## 롤백된 PR #1 내용 (재구현 참고용)

### 추가 예정이었던 기능
1. **단원 예약 신청** — 확정 탭에서 "예약 신청" 버튼 → `BookingRequestSheet` (제목·인원·날짜·시간 선택) → `bookingRequests` 컬렉션에 저장 + 관리자에게 푸시
2. **관리자 승인** — 확정 탭 상단에 `PendingApprovals` 인라인 표시 → 승인 시 `events` 생성 + `bookingRequests` 삭제 + 신청 단원에게 푸시 + 네이버 예약관리 바텀시트
3. **기기 알림 문구**
   - 신청 → 관리자: `[예약신청] {날짜} {이름}님의 예약 신청이 접수되었습니다!`
   - 승인 → 단원: `[예약확정] {날짜} 예약이 확정되었습니다!`

### 필요한 타입 (`lib/types.ts`에 추가)
```ts
export interface BookingRequest {
  id: string; requesterUid: string; requesterName: string; requesterAvatar?: string;
  title: string; date: string; startTime: string; endTime: string;
  team?: string; participantUids?: string[]; participantLabel?: string; createdAt: number;
}
```

### Firestore 규칙 (`firestore.rules`에 추가)
```
match /bookingRequests/{id} {
  allow read: if isMember();
  allow create: if isMember() && request.resource.data.requesterUid == request.auth.uid;
  allow delete: if isAdmin() || (isMember() && resource.data.requesterUid == request.auth.uid);
}
```

### `lib/push.ts`에 추가
```ts
export async function pushToAdmins(msg: { title: string; body: string; href?: string; tag?: string }) {
  await send({ ...msg, audience: "admins" });
}
```

### `app/api/push/route.ts` 수정
`audience === "admins"` 분기에서 `isMember && title`이면 커스텀 문구 허용 (예약 신청 알림용).
