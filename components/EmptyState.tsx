// 빈 화면 안내 (아이콘 + 문구)
import type { FC } from "react";

export default function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: FC<{ className?: string }>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Icon className="h-7 w-7" />
      </span>
      <div>
        <p className="font-medium text-slate-600">{title}</p>
        {hint && <p className="mt-1 text-sm text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}
