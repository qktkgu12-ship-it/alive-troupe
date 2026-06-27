// 강조색으로 꽉 찬 심플·강렬한 날짜 배지 (큰 흰 숫자 + 작은 요일, 월 표시 없음)

export default function DateBadge({
  day,
  weekday,
  size = "md",
}: {
  day: number;
  weekday: string;
  size?: "sm" | "md";
}) {
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
