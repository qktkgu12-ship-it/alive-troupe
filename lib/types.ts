// 공통 타입 정의

export type Role = "admin" | "member" | "guest";
// admin  = 관리자
// member = 정단원 (승인 완료, 전체 접근)
// guest  = 준단원·게스트 (가입 직후 기본값, 아무것도 못 봄 = 승인 대기)

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: Role;
  name: string; // 실명
  contact: string; // 연락처 (관리자만 열람)
  part: string; // 배역·파트(포지션)
  group: string; // 소속·기수
  avatar?: string; // 프로필 사진 (압축된 data URL)
  createdAt: number;
}

export type ArchiveKind = "performance" | "rehearsal" | "etc";
export const ARCHIVE_KIND_LABEL: Record<ArchiveKind, string> = {
  performance: "공연",
  rehearsal: "연습",
  etc: "기타",
};

export interface ArchiveItem {
  id: string;
  title: string; // 제목 (예: 커튼콜, 1막 런스루)
  productionId: string | null; // 소속 작품 (null = 미지정 = 관리자만)
  kind: ArchiveKind; // 종류
  date: string; // YYYY-MM-DD
  url: string; // 외부 링크 (유튜브/구글포토 등 사진·영상 모두)
  description: string; // 설명·메모
  tags: string[]; // 검색용 키워드
  createdBy: string; // uid
  createdByName: string;
  createdAt: number;
}

// 확정 일정 (관리자 등록)
export interface ScheduleEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm (선택)
  endTime: string; // HH:mm (선택)
  location: string; // 장소
  memo: string; // 메모·준비물
  createdAt: number;
}

// 개인 가능 일정 (단원이 본인 가능 날짜를 체크)
// 문서 ID = `${uid}_${yearMonth}` 형태, 월 단위로 저장
export interface Availability {
  uid: string;
  name: string;
  yearMonth: string; // YYYY-MM
  dates: string[]; // 가능한 날짜 목록 (YYYY-MM-DD)
  updatedAt: number;
}

// 작품(공연) — 접근 제어의 중심 단위 (음원·아카이빙 공용)
export interface Production {
  id: string;
  name: string; // 작품명 (예: 2026 정기공연 - 넥스트 투 노멀)
  gisu: string; // 기수 (예: 5기)
  participants: string[]; // 참여 단원 uid 목록 (이 작품 자료 접근 가능)
  order: number;
  createdAt: number;
}

export type AudioKind = "mr" | "guide" | "etc";
export const AUDIO_KIND_LABEL: Record<AudioKind, string> = {
  mr: "MR",
  guide: "가이드",
  etc: "기타",
};

// 곡별 음원 (구글 드라이브 등 외부 링크 연동)
export interface AudioTrack {
  id: string;
  productionId: string;
  song: string; // 곡명
  kind: AudioKind; // MR / 가이드 / 기타
  label: string; // 표시용 이름(선택) 예: "MR 2키 다운"
  url: string; // 구글 드라이브 등 외부 링크
  addedByName: string;
  createdAt: number;
}

// 게시판
export type BoardKey = "free" | "costume" | "stage";
export const BOARD_LABEL: Record<BoardKey, string> = {
  free: "자유게시판",
  costume: "의상·소품",
  stage: "무대",
};
export const BOARD_ORDER: BoardKey[] = ["free", "costume", "stage"];

export interface Post {
  id: string;
  board: BoardKey;
  isNotice: boolean; // 공지 (관리자만 작성, 모든 게시판 상단 고정)
  title: string;
  content: string;
  images?: string[]; // 첨부 사진 (압축된 data URL)
  authorUid: string;
  authorName: string;
  authorAvatar?: string; // 작성 시점의 글쓴이 프로필 사진
  createdAt: number;
  updatedAt: number;
}

// 사이트 설정 (현재 공연 + 테마색)
export interface SiteSettings {
  troupeName: string;
  currentProduction: string; // 현재 진행 중인 공연명
  accentColor: string; // HEX 예: #7c3aed
}
