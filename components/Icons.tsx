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

export const HomeIcon = makeIcon(
  <>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5.5 10v9a1 1 0 0 0 1 1H9.5v-4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V20h3a1 1 0 0 0 1-1v-9" />
  </>
);

export const CalendarIcon = makeIcon(
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
  </>
);

export const ArchiveIcon = makeIcon(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4.5 17 4-3.5 3 2.5 3-2.5 5 4.5" />
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

export const BoardIcon = makeIcon(
  <>
    <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
    <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
  </>
);

export const ChevronDownIcon = makeIcon(<path d="m6 9 6 6 6-6" />);

export const PlusIcon = makeIcon(<path d="M12 5v14M5 12h14" />);

export const XIcon = makeIcon(<path d="M6 6l12 12M18 6 6 18" />);

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

export const FolderIcon = makeIcon(
  <path d="M3.5 7.5a2 2 0 0 1 2-2h3l2 2.2h6a2 2 0 0 1 2 2v6.3a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
);

export const MegaphoneIcon = makeIcon(
  <>
    <path d="M3 10v4a1 1 0 0 0 1 1h3l5 4V5L7 9H4a1 1 0 0 0-1 1z" />
    <path d="M15.5 8.5a4.5 4.5 0 0 1 0 7" />
  </>
);

export const UserPlusIcon = makeIcon(
  <>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.8 20a5.2 5.2 0 0 1 10.4 0" />
    <path d="M18 8v6M21 11h-6" />
  </>
);

// 경로(href) → 아이콘 매핑 (헤더/사이드바 공용)
export const NAV_ICON: Record<string, FC<IconProps>> = {
  "/": HomeIcon,
  "/schedule": CalendarIcon,
  "/archive": ArchiveIcon,
  "/audio": FolderIcon,
  "/board": BoardIcon,
  "/members": MembersIcon,
  "/admin": AdminIcon,
};
