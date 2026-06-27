"use client";

// 단원 명단은 '관리' 탭의 회원 관리로 통합되었습니다. 주소로 들어오면 그쪽으로 보냅니다.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MembersPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin");
  }, [router]);
  return <p className="py-12 text-center text-slate-400">이동 중…</p>;
}
