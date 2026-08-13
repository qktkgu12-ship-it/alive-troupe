// 프로필 사진 (없으면 기본 실루엣 아바타)
export default function Avatar({
  src,
  name,
  className = "h-8 w-8",
}: {
  src?: string | null;
  name?: string;
  className?: string;
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading="lazy" decoding="async" className={`shrink-0 rounded-full border border-slate-200 object-cover ${className}`} />;
  }
  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#eef0f3] ${className}`}>
      <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-full">
        {/* 머리 */}
        <circle cx="50" cy="32" r="16" fill="#b8bec9" />
        {/* 어깨 — 반원 (간격 확보) */}
        <path d="M8 100 A42 42 0 0 1 92 100 Z" fill="#b8bec9" />
      </svg>
    </div>
  );
}
