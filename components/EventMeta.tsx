// 일정 메타(시간·장소) — 라인 아이콘과 함께
import { ClockIcon, PinIcon } from "./Icons";

export default function EventMeta({
  startTime,
  endTime,
  location,
  className = "",
}: {
  startTime?: string;
  endTime?: string;
  location?: string;
  className?: string;
}) {
  const time = startTime ? `${startTime}${endTime ? `~${endTime}` : ""}` : "";
  if (!time && !location) {
    return <span className={`text-slate-400 ${className}`}>시간·장소 미정</span>;
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 ${className}`}>
      {time && (
        <span className="inline-flex items-center gap-1">
          <ClockIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          {time}
        </span>
      )}
      {location && (
        <span className="inline-flex items-center gap-1">
          <PinIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          {location}
        </span>
      )}
    </span>
  );
}
