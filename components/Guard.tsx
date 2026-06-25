"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AppShell from "./AppShell";

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 text-center text-slate-500">
      {children}
    </div>
  );
}

/**
 * 보호된 페이지 래퍼.
 * require="member" : 정단원 이상(정단원·관리자)만 접근
 * require="admin"  : 관리자만 접근
 */
export default function Guard({
  children,
  require = "member",
}: {
  children: React.ReactNode;
  require?: "member" | "admin";
}) {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    } else if (role === "guest") {
      router.replace("/pending");
    }
  }, [loading, user, role, router]);

  if (loading) {
    return (
      <FullScreen>
        <div className="animate-pulse">불러오는 중…</div>
      </FullScreen>
    );
  }

  if (!user || role === "guest") {
    return (
      <FullScreen>
        <div className="animate-pulse">이동 중…</div>
      </FullScreen>
    );
  }

  if (require === "admin" && role !== "admin") {
    return (
      <AppShell>
        <div className="card text-center">
          <p className="text-lg font-semibold">접근 권한이 없습니다</p>
          <p className="mt-1 text-sm text-slate-500">
            이 페이지는 관리자만 볼 수 있어요.
          </p>
        </div>
      </AppShell>
    );
  }

  return <AppShell>{children}</AppShell>;
}
