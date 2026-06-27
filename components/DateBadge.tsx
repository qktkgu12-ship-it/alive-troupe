// 달력 한 장을 뜯은 듯한 정사각형 날짜 배지 (상단 색 띠 '월' + 큰 '일' + '요일')

export default function DateBadge({
  month,
  day,
  weekday,
  size = "md",
}: {
  month: number;
  day: number;
  weekday: string;
  size?: "sm" | "md";
}) {
  const md = size === "md";
  return (
    <div
      className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-accent/15 bg-white text-center ${
        md ? "w-16" : "w-12"
      }`}
    >
      <div className={`bg-accent-soft font-bold text-accent ${md ? "py-1 text-[11px]" : "py-0.5 text-[10px]"}`}>
        {month}월
      </div>
      <div className={`flex flex-1 flex-col items-center justify-center leading-none ${md ? "py-2" : "py-1.5"}`}>
        <span className={`font-extrabold text-slate-900 ${md ? "text-[26px]" : "text-lg"}`}>{day}</span>
        <span className={`mt-1 font-medium text-slate-400 ${md ? "text-[11px]" : "text-[10px]"}`}>{weekday}</span>
      </div>
    </div>
  );
}
