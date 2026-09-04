"use client";

import { useEffect, useMemo, useState } from "react";
import { ONE_CAST } from "@/lib/teams";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Guard from "@/components/Guard";
import { ProfileAvatar, useProfileViewer } from "@/components/ProfileViewer";
import EmptyState from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { MembersIcon } from "@/components/Icons";
import { useTheme } from "@/lib/theme-context";
import type { PublicProfile } from "@/lib/types";

// 팀 순서 기반 색상 (schedule 페이지와 동일한 팔레트)
const TEAM_PALETTE: { border: string; color: string; bg: string }[] = [
  { border: "rgb(94,234,212)", color: "rgb(15,118,110)", bg: "rgba(94,234,212,0.28)" },   // pastel mint
  { border: "rgb(196,181,253)", color: "rgb(109,40,217)", bg: "rgba(196,181,253,0.35)" }, // pastel violet
];

type Member = PublicProfile & { uid: string };

function MembersInner() {
  const { seed } = useProfileViewer();
  const { settings } = useTheme();
  const teams = settings.teams ?? [];
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "publicProfiles"));
        const list = snap.docs
          .map((d) => ({ uid: d.id, ...(d.data() as PublicProfile) }))
          .filter((m) => m.name || m.bio); // 빈 프로필 제외
        setMembers(list);
        // 방금 받은 프로필을 캐시에 심어, 카드별 아바타가 개별 재조회하지 않도록
        seed(Object.fromEntries(list.map((m) => [m.uid, m as PublicProfile])));
      } catch (e) {
        console.error("멤버 불러오기 오류:", e);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const base = s
      ? members.filter((m) =>
          [m.name, m.bio].filter(Boolean).some((v) => (v as string).toLowerCase().includes(s))
        )
      : members;
    // 이름 가나다순
    return [...base].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
  }, [members, search]);

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">멤버</h1>
        <span className="text-sm text-slate-400">{members.length}명</span>
      </div>

      <input
        className="input"
        placeholder="이름 · 소개글로 검색"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <SkeletonList />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={MembersIcon}
            title={members.length === 0 ? "표시할 단원이 없습니다." : "검색 결과가 없습니다."}
            hint={members.length === 0 ? "관리자가 '전 단원 공개 프로필 동기화'를 실행하면 명단이 채워져요." : undefined}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((m) => (
            <div key={m.uid} className="card flex items-center gap-3 !p-4">
              <ProfileAvatar uid={m.uid} name={m.name || "이름없음"} avatar={m.avatar} className="h-12 w-12 text-base" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-bold text-slate-900">{m.name || "이름없음"}</p>
                  {m.role === "admin" && (
                    <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent">관리자</span>
                  )}
                  {m.team && (() => {
                    const idx = teams.indexOf(m.team!);
                    const c = TEAM_PALETTE[idx] ?? null;
                    // 원캐스트는 팀 목록에 없다 — 모든 일정에 들어가는 사람이라 강조색으로
                    const one = m.team === ONE_CAST;
                    return (
                      <span
                        style={c ? { backgroundColor: c.bg, color: c.color } : {}}
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          c ? "" : one ? "bg-accent-soft text-accent" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {m.team}
                      </span>
                    );
                  })()}
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  {m.bio || "소개글 없음"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MembersPage() {
  return (
    <Guard>
      <MembersInner />
    </Guard>
  );
}
