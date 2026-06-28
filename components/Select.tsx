// 통일된 드롭다운(select) — 네이티브 화살표 제거 + 직접 그린 화살표로 좌우 여백 균등
import type { SelectHTMLAttributes } from "react";
import { ChevronDownIcon } from "./Icons";

export default function Select({
  className = "",
  wrapperClassName = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <select
        {...props}
        className={`input w-full cursor-pointer appearance-none !pr-9 transition hover:border-slate-300 ${className}`}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}
