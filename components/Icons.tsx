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

// 경로(href) → 아이콘 매핑 (헤더/사이드바 공용)
export const NAV_ICON: Record<string, FC<IconProps>> = {
  "/": HomeIcon,
  "/schedule": CalendarIcon,
  "/archive": ArchiveIcon,
  "/audio": MusicIcon,
  "/members": MembersIcon,
  "/admin": AdminIcon,
};
