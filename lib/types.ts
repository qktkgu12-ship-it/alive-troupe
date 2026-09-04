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
  part: string; // (구버전) 배역·파트 — 소개글로 대체됨
  group: string; // (구버전) 소속·기수 — 소개글로 대체됨
  bio?: string; // 소개글
  avatar?: string; // 프로필 사진 (압축된 data URL)
  team?: string; // 소속 팀 (A팀/B팀 등, 관리자 지정) — 빈값이면 팀 미지정(전체)
  createdAt: number;
  notifSince?: number; // 알림 기능을 처음 켠 시점 (이후 생긴 것만 알림)
  notifReads?: Record<string, number>; // 읽은 알림 ID → 읽은 시각
}

// 단원끼리 볼 수 있는 공개 프로필 (연락처 등 민감정보 제외)
// users 문서는 본인·관리자만 읽을 수 있어, 명단/댓글에서 서로 프로필을 보려면 별도 공개본이 필요
export interface PublicProfile {
  name: string;
  part: string; // (구버전) 배역·파트
  group: string; // (구버전) 소속·기수
  bio?: string; // 소개글
  avatar?: string;
  role?: Role; // 표시용(배지) — 실제 권한은 users 문서 기준
  team?: string; // 소속 팀 (표시·필터용)
}

export type ArchiveKind = "performance" | "rehearsal" | "etc";
export const ARCHIVE_KIND_LABEL: Record<ArchiveKind, string> = {
  performance: "공연",
  rehearsal: "연습",
  etc: "기타",
};

// 종류별 이모지 — 아카이브 목록과 홈 카드가 같은 걸 쓴다
export const ARCHIVE_KIND_EMOJI: Record<ArchiveKind, string> = {
  rehearsal: "🎬",
  performance: "🎪",
  etc: "📁",
};

// 한 자료 안의 개별 영상/링크 (라벨로 구분해 골라봄)
export interface ArchiveClip {
  label: string; // 예: 1차, 2차, 정면캠
  url: string;
}

export interface ArchiveItem {
  id: string;
  title: string; // 제목 (예: 커튼콜, 1막 런스루)
  productionId: string | null; // 소속 작품 (null = 미지정 = 관리자만)
  kind: ArchiveKind; // 종류
  date: string; // YYYY-MM-DD
  url: string; // 대표 링크 (= clips[0].url, 구버전 호환용)
  clips?: ArchiveClip[]; // 여러 영상(라벨+링크). 없으면 url 하나만 있는 구버전 자료
  description: string; // 설명·메모
  tags: string[]; // 검색용 키워드
  createdBy: string; // uid
  createdByName: string;
  createdAt: number;
}

// 확정 일정 불참 의견 (events/{id}/absences/{uid})
export interface Absence {
  uid: string;
  name: string;
  reason: string;
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
  team?: string; // 대상 팀 (빈값이면 전체 공통)
  // 개별 지정 참여자. 값이 있으면 team보다 우선한다 (팀 대신 이 명단이 대상).
  participantUids?: string[];
  participantLabel?: string; // "5명" 등 표시용
  source?: string; // 'naver' = 네이버 스마트플레이스 예약 (초록색), 'external' = 외부 손님 예약
  hidden?: boolean; // 숨겨진 일정 (관리자만 볼 수 있음, 취소선으로 표시)
  // 단원 예약 신청이 승인돼서 만들어진 일정이면 신청한 단원의 uid.
  // 이 사람은 관리자가 아니어도 자기 일정을 지울 수 있다.
  createdBy?: string;
  createdAt: number;
}

// 단원 스튜디오 예약 신청 (관리자 승인 전 임시 보관)
export interface BookingRequest {
  id: string;
  requesterUid: string;
  requesterName: string;
  requesterAvatar?: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  location?: string;
  team?: string;
  participantUids?: string[];
  participantLabel?: string;
  createdAt: number;
}

// 외부 손님 예약 (Apps Script가 네이버 예약 메일에서 파싱해 넣음)
// 예약상품이 '극단 얼라이브 소속 회원 예약'이 아닌 경우 → 확정 일정에는 안 뜨지만
// 일정방에서 스튜디오가 이미 잡혀 있다는 걸 알 수 있게 날짜·시간만 보관한다.
export interface ExternalBooking {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  product?: string; // 예약상품명 (참고용)
  createdAt: number;
}

// 일정방 (일정 잡기). 방마다 가능일정을 따로 모음
// availability 문서: coordinations/{id}/availability/{uid}
export interface Coordination {
  id: string;
  title: string; // 일정 이름
  memo?: string; // 설명(선택)
  team?: string; // 대상 팀 (빈값이면 전체) — participantUids 없을 때 응답 진행률의 분모 기준
  participantUids?: string[]; // 대상을 개별 지정한 경우(팀 대신) — 있으면 이 인원 수가 분모
  location?: string; // 장소 (기본: 스튜디오 얼라이브)
  candidateDates?: string[]; // 후보 날짜(YYYY-MM-DD). 단원은 이 중에서만 고름
  deadline?: number; // 가능시간 제출 마감(ms)
  targetMonth?: string; // (구버전) 대상 기간(달) YYYY-MM
  createdBy: string;
  createdByName: string;
  status: "open" | "done"; // 진행중 / 확정됨
  confirmedDate?: string; // 확정된 날짜 YYYY-MM-DD (status==="done")
  confirmedStart?: string; // 확정 시작 HH:mm
  confirmedEnd?: string; // 확정 종료 HH:mm
  confirmedAt?: number; // 확정 시각(ms) — '며칠 만에 성사' 표시용
  confirmedEventId?: string; // 확정 시 생성된 events 문서 ID (변경 시 이 문서를 update)
  createdAt: number;
}

// 개인 가능 일정 (단원이 본인 가능 날짜를 체크)
// (구) 전역 조율: 문서 ID = `${uid}_${yearMonth}`. (신) 카드별: coordinations/{cid}/availability/{uid}
export interface Availability {
  uid: string;
  name: string;
  avatar?: string; // 제출 시점의 프로필 사진 (명단 표시용)
  team?: string; // 제출 시점의 소속 팀 (팀별 조율 집계용)
  yearMonth?: string; // YYYY-MM (구 전역 방식에서만 사용)
  dates: string[]; // 가능한 날짜 목록 (YYYY-MM-DD)
  // 날짜별 가능 시간 슬롯(30분 단위, "HH:mm"). 비어있거나 없으면 그 날은 '아무때나 가능'
  slots?: { [date: string]: string[] };
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

export type AudioKind = "mr" | "guide" | "etc"; // (구버전 호환용)
export const AUDIO_KIND_LABEL: Record<AudioKind, string> = {
  mr: "MR",
  guide: "가이드",
  etc: "기타",
};

// 자료실 종류별 기본 이모지 (극단 설정에 없을 때 쓰는 값)
export const DEFAULT_RESOURCE_CATEGORIES = ["음원", "기타"];
export const DEFAULT_RESOURCE_EMOJIS: Record<string, string> = { "음원": "🎵", "기타": "📁" };
export const FALLBACK_RESOURCE_EMOJI = "📄";

// 자료실 한 항목의 종류·제목 (구버전 필드 호환)
export function resourceCategory(t: { category?: string }) {
  return t.category || "음원";
}

// 자료실 항목 (구글 드라이브 등 외부 링크 연동). 컬렉션명은 호환을 위해 'audio' 유지.
export interface AudioTrack {
  id: string;
  productionId: string;
  category?: string; // 자료 종류 (음원/기타/…). 없으면 '음원'으로 취급
  title?: string; // 제목·넘버명·문서명 (구버전: song)
  memo?: string; // 메모(선택)
  url: string; // 구글 드라이브 등 외부 링크
  addedByName: string;
  createdBy?: string; // 올린 사람 uid. 이걸로 수정·삭제 권한을 가른다 (구버전 자료엔 없음)
  createdAt: number;
  // ----- 구버전 호환 -----
  song?: string;
  kind?: AudioKind;
  label?: string;
}

// 게시판
export type BoardKey = "free" | "costume" | "stage"; // (구버전 키)
export const BOARD_LABEL: Record<BoardKey, string> = {
  free: "자유게시판",
  costume: "의상·소품",
  stage: "무대",
};
export const BOARD_ORDER: BoardKey[] = ["free", "costume", "stage"];

// 게시판 종류 기본값(관리자가 추가/삭제). 카테고리는 '이름' 문자열로 저장됨.
export const DEFAULT_BOARD_CATEGORIES = ["자유게시판", "의상·소품", "무대"];
// 구버전 글은 board가 키(free/costume/stage)로 저장돼 있어 이름으로 변환
export function boardCategoryLabel(board: string): string {
  return (BOARD_LABEL as Record<string, string>)[board] ?? board;
}

// 투표(선택) — 글에 붙는 투표. 글쓴이가 단일/복수·익명 여부·마감을 정함
export interface Poll {
  question?: string; // 투표 질문(선택)
  options: string[]; // 선택지
  multiple: boolean; // 복수 선택 허용
  anonymous: boolean; // 익명(누가 골랐는지 숨김)
  deadline?: number; // 마감 시각(ms). 없으면 무기한
}

// 개별 투표 기록 (posts/{postId}/votes/{uid})
export interface PollVote {
  uid: string;
  name: string;
  avatar?: string;
  choices: number[]; // 선택한 선택지 인덱스들
  createdAt: number;
}

export interface Post {
  id: string;
  board: string; // 카테고리 이름(신규) 또는 구버전 키(free/costume/stage)
  isNotice: boolean; // 공지 (관리자만 작성, 모든 게시판 상단 고정)
  title: string;
  content: string;
  hasImages?: boolean; // 첨부 사진 존재 여부 (실제 사진은 postMedia 문서에 별도 저장)
  images?: string[]; // (구버전 호환) 예전 글은 사진이 글 문서 안에 들어있을 수 있음
  tags?: string[]; // 태그
  poll?: Poll; // 투표(선택)
  authorUid: string;
  authorName: string;
  authorAvatar?: string; // 작성 시점의 글쓴이 프로필 사진
  likeCount?: number;
  commentCount?: number;
  viewCount?: number;
  createdAt: number;
  updatedAt: number;
}

// 게시글 첨부 사진 (별도 저장 → 목록 쿼리 경량화)
export interface PostMedia {
  images: string[];
  authorUid: string;
}

// 댓글 (posts/{postId}/comments)
export interface Comment {
  id: string;
  authorUid: string;
  authorName: string;
  authorAvatar?: string; // 작성 시점의 프로필 사진(압축 data URL) — 다른 사람 프로필은 못 읽으므로 denormalize
  content: string;
  parentId?: string; // 대댓글이면 부모 댓글 id (없으면 최상위 댓글)
  // @로 부른 단원들의 uid. 본문에도 "@이름"이 글자로 남아 있지만,
  // 이름이 바뀌면 글자로는 못 찾으므로 부른 순간의 uid를 따로 남긴다.
  mentionUids?: string[];
  createdAt: number;
}

// 사이트 설정 (현재 공연 + 테마색)
export interface SiteSettings {
  troupeName: string;
  currentProduction: string; // (구버전) 현재 진행 중인 공연명 텍스트
  currentProductionId?: string; // 현재 진행 작품의 productions 문서 id (자료등록 기본값)
  resourceCategories?: string[]; // 자료실 종류(탭) 목록 — 관리자가 추가/삭제
  resourceCategoryEmojis?: Record<string, string>; // 자료실 종류별 이모지
  boardCategories?: string[]; // 게시판 종류(탭) 목록 — 관리자가 추가/삭제
  teams?: string[]; // 팀 목록 (A팀/B팀 등) — 관리자가 추가/삭제, 비어있으면 팀 기능 off
  accentColor: string; // HEX 예: #7c3aed
  /**
   * 기기 알림 일시 중지.
   * 켜 두면 서버가 단원에게 가는 푸시를 전부 막는다 (본인 테스트 발송만 통과).
   * 시험 삼아 글·일정을 등록할 때 단원들 폰이 울리지 않게 하려고 쓴다.
   */
  pushPaused?: boolean;
}
