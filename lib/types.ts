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
  title: string; // 공연·연습명
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

// 음원 자료실: 작품(공연) = 폴더
export interface Production {
  id: string;
  name: string; // 작품명 (예: 2026 정기공연 - 넥스트 투 노멀)
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

// 사이트 설정 (현재 공연 + 테마색)
export interface SiteSettings {
  troupeName: string;
  currentProduction: string; // 현재 진행 중인 공연명
  accentColor: string; // HEX 예: #7c3aed
}
