"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Guard from "@/components/Guard";
import type { Role, UserProfile } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = {
  admin: "관리자",
  member: "정단원",
  guest: "준단원·게스트",
};
const ROLE_STYLE: Record<Role, string> = {
  admin: "bg-accent text-accent-fg",
  member: "bg-emerald-100 text-emerald-700",
  guest: "bg-amber-100 text-amber-700",
};

function MembersInner() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getDocs(query(collection(db, "users"), orderBy("createdAt", "asc")))
      .then((snap) => setUsers(snap.docs.map((d) => d.data() as UserProfile)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const approved = users.filter((u) => u.role !== "guest");
    if (!s) return approved;
    return approved.filter(
      (u) =>
        (u.name || "").toLowerCase().includes(s) ||
        (u.part || "").toLowerCase().includes(s) ||
        (u.group || "").toLowerCase().includes(s)
    );
  }, [users, search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">단원 명단</h1>
        <span className="text-sm text-slate-400">총 {filtered.length}명</span>
      </div>

      <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
        🔒 이 페이지와 연락처 정보는 관리자만 볼 수 있습니다.
      </div>

      <input
        className="input"
        placeholder="이름 · 배역 · 기수로 검색"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <p className="py-12 text-center text-slate-400">불러오는 중…</p>
      ) : filtered.length === 0 ? (
        <p className="card py-12 text-center text-slate-400">단원이 없습니다.</p>
      ) : (
        <>
          {/* 데스크탑: 표 */}
          <div className="card hidden overflow-x-auto !p-0 sm:block">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">이름</th>
                  <th className="px-4 py-3 font-semibold">배역·파트</th>
                  <th className="px-4 py-3 font-semibold">소속·기수</th>
                  <th className="px-4 py-3 font-semibold">연락처</th>
                  <th className="px-4 py-3 font-semibold">등급</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((u) => (
                  <tr key={u.uid}>
                    <td className="px-4 py-3 font-medium">{u.name || u.displayName || "-"}</td>
                    <td className="px-4 py-3 text-slate-600">{u.part || "-"}</td>
                    <td className="px-4 py-3 text-slate-600">{u.group || "-"}</td>
                    <td className="px-4 py-3 text-slate-600">{u.contact || "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_STYLE[u.role]}`}>
                        {ROLE_LABEL[u.role]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 모바일: 카드 */}
          <div className="space-y-2 sm:hidden">
            {filtered.map((u) => (
              <div key={u.uid} className="card !p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{u.name || u.displayName || "-"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_STYLE[u.role]}`}>
                    {ROLE_LABEL[u.role]}
                  </span>
                </div>
                <dl className="mt-2 space-y-1 text-sm text-slate-600">
                  <div className="flex gap-2"><dt className="w-16 text-slate-400">배역</dt><dd>{u.part || "-"}</dd></div>
                  <div className="flex gap-2"><dt className="w-16 text-slate-400">기수</dt><dd>{u.group || "-"}</dd></div>
                  <div className="flex gap-2"><dt className="w-16 text-slate-400">연락처</dt><dd>{u.contact || "-"}</dd></div>
                </dl>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function MembersPage() {
  return (
    <Guard require="admin">
      <MembersInner />
    </Guard>
  );
}
