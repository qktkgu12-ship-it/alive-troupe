// 로딩 중 보여주는 빈 자리 표시(스켈레톤) — 체감 속도 개선

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card divide-y divide-slate-100 !p-0">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3.5">
          <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card !p-4">
          <div className="flex gap-2">
            <div className="h-5 w-12 animate-pulse rounded-full bg-slate-100" />
            <div className="h-5 w-16 animate-pulse rounded-full bg-slate-100" />
          </div>
          <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
