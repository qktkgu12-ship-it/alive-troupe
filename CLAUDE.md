# ALIVE 앱

Next.js 15 + Firebase(Firestore/FCM). 단원/관리자 역할. 브랜드색 `#e53535`.

**개발 브랜치**: `claude/pc-to-mobile-continuity-rd9ize` → push 후 main에 반영.

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
