// 통일된 라인 아이콘 세트 (24x24, stroke 기반, currentColor)
import type { ReactNode, FC } from "react";

type IconProps = { className?: string };

function makeIcon(children: ReactNode): FC<IconProps> {
  return function Icon({ className }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {children}
      </svg>
    );
  };
}

// 박공지붕 집 + 아치형 문 (아이콘 시안 A)
export const HomeIcon = makeIcon(
  <>
    <path d="M3 10.2 12 3l9 7.2V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8.8Z" />
    <path d="M9.6 21v-4.9a2.4 2.4 0 0 1 4.8 0V21" />
  </>
);

// 달력 — 시안 A와 같은 모서리 반경·굵기로 맞춘 우리 달력
export const CalendarIcon = makeIcon(
  <>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 9.8h18M8 2.8v4M16 2.8v4" />
  </>
);

// 슬레이트(클래퍼보드) + 재생 삼각형 (아이콘 시안 A)
export const ArchiveIcon = makeIcon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.4" />
    <path d="M3 8.6h18" />
    <path d="m7.4 4 2.6 4.6M12.6 4l2.6 4.6" />
    <path d="M10.2 11.6v5l4.4-2.5-4.4-2.5Z" />
  </>
);

export const MusicIcon = makeIcon(
  <>
    <path d="M9 18V6l10-2v12" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  </>
);

export const MembersIcon = makeIcon(
  <>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.8 20a5.2 5.2 0 0 1 10.4 0" />
    <path d="M16 5.1a3.2 3.2 0 0 1 0 6.1M16.5 20a5.2 5.2 0 0 0-2.8-4.6" />
  </>
);

export const AdminIcon = makeIcon(
  <>
    <path d="M12 3.5 19 6v5.4c0 4.4-3 7.4-7 8.9-4-1.5-7-4.5-7-8.9V6z" />
    <path d="m9 12 2 2 4-4" />
  </>
);

export const HeartIcon = makeIcon(
  <path d="M19.5 12.6 12 20l-7.5-7.4a4.6 4.6 0 0 1 6.5-6.5l1 1 1-1a4.6 4.6 0 0 1 6.5 6.5z" />
);

export const CommentIcon = makeIcon(
  <path d="M20 4H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3v3l4-3h9a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z" />
);

export const EyeIcon = makeIcon(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </>
);

export const EyeOffIcon = makeIcon(
  <>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <path d="M3 3l18 18" />
  </>
);

// 말풍선 + 글줄 (아이콘 시안 A)
export const BoardIcon = makeIcon(
  <>
    <path d="M6 4h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-8L6 19.6V16a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" />
    <path d="M7.6 8.8h8.8M7.6 12.2h5.4" />
  </>
);

export const ChevronDownIcon = makeIcon(<path d="m6 9 6 6 6-6" />);

export const PlusIcon = makeIcon(<path d="M12 5v14M5 12h14" />);

export const LinkIcon = makeIcon(
  <>
    {/* 복사 아이콘 — 뒤 사각형(획만), 앞 사각형(흰 배경으로 덮음) */}
    <rect x="2" y="2" width="13" height="13" rx="3.5" />
    <rect x="7" y="7" width="13" height="13" rx="3.5" fill="white" />
  </>
);

export const QuoteIcon = makeIcon(
  <>
    <path d="M7.5 7C6 7 5 8.2 5 9.8 5 11.3 6 12.3 7.3 12.3c.2 1.5-.6 2.4-2 2.7" />
    <path d="M15.5 7c-1.5 0-2.5 1.2-2.5 2.8 0 1.5 1 2.5 2.3 2.5.2 1.5-.6 2.4-2 2.7" />
  </>
);

export const ListBulletIcon = makeIcon(
  <>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1.2" />
    <circle cx="4.5" cy="12" r="1.2" />
    <circle cx="4.5" cy="18" r="1.2" />
  </>
);

export const ListOrderedIcon = makeIcon(
  <>
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="M4 5.5 5.2 5v3.2M3.6 17h1.8l-1.8 2.2h1.8" />
  </>
);

export const XIcon = makeIcon(<path d="M6 6l12 12M18 6 6 18" />);

export const CheckIcon = makeIcon(<path d="M5 13l4 4L19 7" />);

export const SearchIcon = makeIcon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
);

export const ShareIcon = makeIcon(
  <>
    <path d="M12 15V4" />
    <path d="m8 7.5 4-3.5 4 3.5" />
    <path d="M5 12v6.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V12" />
  </>
);

export const BellIcon = makeIcon(
  <>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </>
);

export const ClockIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </>
);

export const PinIcon = makeIcon(
  <>
    <path d="M12 21s6.5-5.4 6.5-10.5A6.5 6.5 0 0 0 5.5 10.5C5.5 15.6 12 21 12 21z" />
    <circle cx="12" cy="10.5" r="2.3" />
  </>
);

export const TrashIcon = makeIcon(
  <>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6.5 7l.8 12a1 1 0 0 0 1 .95h7.4a1 1 0 0 0 1-.95l.8-12" />
    <path d="M10 11v5M14 11v5" />
  </>
);

export const PencilIcon = makeIcon(
  <>
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    <path d="m14.5 5.5 3 3" />
  </>
);

// 폴더 — 시안 A와 같은 폭·모서리로 맞춘 우리 폴더
export const FolderIcon = makeIcon(
  <path d="M3 7a2.5 2.5 0 0 1 2.5-2.5h3.3l2.3 2.6h7.4A2.5 2.5 0 0 1 21 9.6V18a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18V7Z" />
);

// 확성기(메가폰). 예전엔 스피커 모양이었는데, 스피커는 '소리 크기'로 읽혀서
// 공지와 뜻이 달랐다. 나팔 입이 오른쪽으로 벌어지고 아래에 손잡이가 달린 형태로 바꿨다.
export const MegaphoneIcon = makeIcon(
  <>
    {/* 나팔 — 왼쪽 통에서 오른쪽 입구로 벌어진다 */}
    <path d="M17 5.5 10 9.8H4.2a1.2 1.2 0 0 0-1.2 1.2v2a1.2 1.2 0 0 0 1.2 1.2H10l7 4.3z" />
    {/* 손잡이 */}
    <path d="M6.6 14.2v3.1a1.7 1.7 0 0 0 3.4 0v-2.4" />
    {/* 퍼져 나가는 소리 */}
    <path d="M19.8 9.9a3.4 3.4 0 0 1 0 4.2" />
  </>
);

export const UserPlusIcon = makeIcon(
  <>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.8 20a5.2 5.2 0 0 1 10.4 0" />
    <path d="M18 8v6M21 11h-6" />
  </>
);

// ── 글쓰기 툴바 ──────────────────────────────────────────
export const CameraIcon = makeIcon(
  <>
    <path d="M3 8.8a2 2 0 0 1 2-2h1.9l1.3-2.1h7.6l1.3 2.1H19a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.8Z" />
    <circle cx="12" cy="12.8" r="3.6" />
  </>
);

// 글자 서식 (T)
export const TextIcon = makeIcon(<path d="M5 5.5h14M12 5.5V19" />);

// 정렬 — 지금 정렬 상태에 맞춰 줄 길이가 바뀐다
export const AlignIcon = ({ align = "left", className }: { align?: "left" | "center" | "right"; className?: string }) => {
  // 짧은 줄 두 개의 좌우 위치만 바꿔 정렬을 나타낸다
  const short = { left: [3, 14], center: [6, 18], right: [10, 21] }[align];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M3 5.5h18" />
      <path d={`M${short[0]} 12h${short[1] - short[0]}`} />
      <path d="M3 18.5h18" />
    </svg>
  );
};

// 가로 점 세 개 (더보기)
export const DotsIcon: FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </svg>
);

// 투표
export const PollIcon = makeIcon(
  <>
    <path d="M4.5 19.5V13M12 19.5V5.5M19.5 19.5v-9" />
  </>
);

// 키보드 내리기
export const KeyboardDownIcon = makeIcon(
  <>
    <rect x="2.5" y="3.5" width="19" height="11" rx="2.4" />
    <path d="M6.5 7.2h.01M10 7.2h.01M13.5 7.2h.01M17 7.2h.01M8 11h8" />
    <path d="m9 18 3 3 3-3" />
  </>
);

// 세로 점 세 개 (더보기 메뉴)
export const DotsVerticalIcon: FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <circle cx="12" cy="5" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="12" cy="19" r="1.5" />
  </svg>
);

// 경로(href) → 아이콘 매핑 (헤더/사이드바 공용)
// 하단 내비게이션에서 '선택된 칸'에 쓰는 꽉 찬 아이콘.
// 외곽선 버전과 같은 자리·같은 크기로 그려서 전환할 때 흔들리지 않는다.
function makeSolidIcon(children: ReactNode): FC<IconProps> {
  return function Icon({ className }: IconProps) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        {children}
      </svg>
    );
  };
}

// 집 — 문을 도려낸 한 덩어리 (evenodd)
export const HomeIconSolid = makeSolidIcon(
  <path
    fillRule="evenodd"
    clipRule="evenodd"
    d="M12 2.8a1 1 0 0 1 .62.22l9 7.2A1 1 0 0 1 22 11v8a3 3 0 0 1-3 3h-4.2v-5.9a2.8 2.8 0 0 0-5.6 0V22H5a3 3 0 0 1-3-3v-8a1 1 0 0 1 .38-.78l9-7.2A1 1 0 0 1 12 2.8Z"
  />
);

export const CalendarIconSolid = makeSolidIcon(
  <>
    <path d="M8 1.9a.9.9 0 0 1 .9.9v1.3h6.2V2.8a.9.9 0 0 1 1.8 0v1.4A3.6 3.6 0 0 1 21 7.7v1.2H3V7.7a3.6 3.6 0 0 1 4.1-3.5V2.8a.9.9 0 0 1 .9-.9Z" />
    <path d="M3 10.7h18V18a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7.3Z" />
  </>
);

// 슬레이트 — 재생 삼각형과 윗줄 사선을 도려낸다
export const ArchiveIconSolid = makeSolidIcon(
  <>
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M5.4 3h13.2A2.4 2.4 0 0 1 21 5.4v3.9H3V5.4A2.4 2.4 0 0 1 5.4 3Zm3.1 6.3L6.1 5h2.3l2.4 4.3H8.5Zm5.2 0L11.3 5h2.3L16 9.3h-2.3Z"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M3 10.7h18v7.9A2.4 2.4 0 0 1 18.6 21H5.4A2.4 2.4 0 0 1 3 18.6v-7.9Zm7.2 1.1v5.4l4.7-2.7-4.7-2.7Z"
    />
  </>
);

export const FolderIconSolid = makeSolidIcon(
  <path d="M3 7a2.5 2.5 0 0 1 2.5-2.5h3.3l2.3 2.6h7.4A2.5 2.5 0 0 1 21 9.6V18a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18V7Z" />
);

// 말풍선 — 글줄을 도려낸다
export const BoardIconSolid = makeSolidIcon(
  <path
    fillRule="evenodd"
    clipRule="evenodd"
    d="M6 3.5h12a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-3.5 3.5h-7.8l-4.4 3.9a.8.8 0 0 1-1.3-.6v-3.6A3.5 3.5 0 0 1 2.5 13V7A3.5 3.5 0 0 1 6 3.5Zm1.6 4.4a.9.9 0 0 0 0 1.8h8.8a.9.9 0 0 0 0-1.8H7.6Zm0 3.4a.9.9 0 0 0 0 1.8H13a.9.9 0 0 0 0-1.8H7.6Z"
  />
);

export const NAV_ICON: Record<string, FC<IconProps>> = {
  "/": HomeIcon,
  "/schedule": CalendarIcon,
  "/archive": ArchiveIcon,
  "/audio": FolderIcon,
  "/board": BoardIcon,
  "/members": MembersIcon,
  "/admin": AdminIcon,
};
