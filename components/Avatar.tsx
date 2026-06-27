// 프로필 사진 (없으면 이름 첫 글자 동그라미)
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
  const initial = (name || "?").trim().charAt(0) || "?";
  return (
    <div className={`grid shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent ${className}`}>
      {initial}
    </div>
  );
}
