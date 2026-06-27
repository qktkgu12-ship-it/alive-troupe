// 날짜 배지
// variant="solid" : 강조색 꽉 찬 사각형 + 흰 숫자 (홈 강조 카드 등 단독 강조용)
// variant="plain" : 박스 없이 강조색 숫자 + 회색 요일 (목록용 — 가볍게)

export default function DateBadge({
  day,
  weekday,
  size = "md",
  variant = "solid",
}: {
  day: number;
  weekday: string;
  size?: "sm" | "md";
  variant?: "solid" | "plain";
}) {
  if (variant === "plain") {
    return (
      <div className="flex w-11 shrink-0 flex-col items-center leading-none">
        <span className="text-2xl font-extrabold text-accent">{day}</span>
        <span className="mt-1 text-[11px] font-medium text-slate-400">{weekday}</span>
      </div>
    );
  }

  const md = size === "md";
  return (
    <div
      className={`bg-accent-gradient flex shrink-0 flex-col items-center justify-center rounded-2xl text-accent-fg ${
        md ? "h-16 w-16" : "h-12 w-12"
      }`}
    >
      <span className={`font-extrabold leading-none ${md ? "text-[28px]" : "text-xl"}`}>{day}</span>
      <span className={`mt-1 font-medium leading-none opacity-90 ${md ? "text-[11px]" : "text-[10px]"}`}>{weekday}</span>
    </div>
  );
}
