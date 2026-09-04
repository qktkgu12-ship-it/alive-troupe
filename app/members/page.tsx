"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Guard from "@/components/Guard";
import { ProfileAvatar, useProfileViewer } from "@/components/ProfileViewer";
import EmptyState from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { MembersIcon } from "@/components/Icons";
import type { PublicProfile } from "@/lib/types";

type Member = PublicProfile & { uid: string };

function MembersInner() {
  const { seed } = useProfileViewer();
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
                  {/* 팀 배지는 안 보여 준다.
                      팀은 '어느 일정에 들어가는가'를 정하는 운영용 값이라
                      (팀 없음 = 비활성) 단원 명단에 띄우면 서로의 활동 상태가
                      드러난다. 일정 화면에서는 필요하니 거기서만 쓴다. */}
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
