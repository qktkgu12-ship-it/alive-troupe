# 🎭 ALIVE 얼라이브

뮤지컬 극단 ALIVE 단원 전용 홈페이지.

## 기능
- 🔐 구글 로그인 + 관리자 승인제 (3단계 등급: 관리자 / 정단원 / 준단원·게스트)
- 📅 일정: 단원별 월간 가능일자 체크 → 전체 가능현황 → 관리자 확정일정 등록
- 🎬 아카이빙: 외부 링크(영상·사진) 기록, 검색·태그
- 🎵 음원 자료실: 작품(폴더)별 → 곡별 MR·가이드 (구글 드라이브 링크 연동)
- 👥 단원 명단 (관리자 전용, 연락처 포함)
- 🎨 공연별 테마색 자유 설정

## 기술 스택
- Next.js (App Router) · TypeScript · Tailwind CSS
- Firebase Authentication / Firestore
- Vercel 자동 배포

## 시작하기
👉 **설치·배포 방법은 [SETUP.md](./SETUP.md) 를 그대로 따라 하세요.**

```bash
npm install      # 의존성 설치 (최초 1회)
npm run dev      # 로컬 실행 → http://localhost:3000
npm run build    # 배포용 빌드
```

`.env.local` 에 Firebase 설정값이 필요합니다. (`.env.local.example` 참고)

## 폴더 구조
```
app/            화면(페이지)
  login/        로그인
  pending/      승인 대기 + 프로필 입력
  schedule/     일정 (가능일정·전체현황·확정일정)
  archive/      아카이빙
  audio/        음원 자료실 (구글 드라이브 링크)
  members/      단원 명단 (관리자)
  admin/        관리자 (승인·등급·테마)
components/      공통 UI (내비게이션, 권한 가드)
lib/             Firebase 초기화, 인증/테마 컨텍스트, 타입, 유틸
firestore.rules  Firestore 보안 규칙
```
