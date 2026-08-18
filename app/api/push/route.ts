// 푸시 발송 엔드포인트 (관리자 전용)
//
// 클라이언트가 직접 FCM에 쏘게 하면 서버 키가 노출되므로, 반드시 서버를 거친다.
// 호출자가 진짜 관리자인지 ID 토큰으로 검증한 뒤에만 발송한다.

import { NextResponse } from "next/server";
import { adminAuth, adminDb, adminMessaging } from "@/lib/firebase-admin";

export const runtime = "nodejs"; // firebase-admin은 엣지 런타임에서 못 돈다
export const dynamic = "force-dynamic";

const ADMIN_EMAIL = (process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "").toLowerCase();

// FCM은 한 번에 500개까지 받는다
const BATCH = 500;

interface Body {
  title?: string;
  body?: string;
  href?: string;
  tag?: string;
  /** 이 uid들에게는 보내지 않는다 (보통 글쓴이 본인) */
  exclude?: string[];
}

export async function POST(req: Request) {
  const auth = adminAuth();
  const db = adminDb();
  const messaging = adminMessaging();
  if (!auth || !db || !messaging) {
    // 서비스 계정 키가 아직 등록되지 않은 상태
    return NextResponse.json({ error: "push-not-configured" }, { status: 503 });
  }

  // ---- 1. 호출자 확인 ----
  const header = req.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let uid: string;
  let email: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
    email = (decoded.email ?? "").toLowerCase();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ---- 2. 관리자인지 확인 ----
  let isAdmin = ADMIN_EMAIL !== "" && email === ADMIN_EMAIL;
  if (!isAdmin) {
    const snap = await db.collection("users").doc(uid).get();
    isAdmin = snap.exists && snap.get("role") === "admin";
  }
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // ---- 3. 내용 확인 ----
  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  const title = (payload.title ?? "").trim();
  const body = (payload.body ?? "").trim();
  if (!title) return NextResponse.json({ error: "title-required" }, { status: 400 });

  const href = payload.href ?? "/";
  const tag = payload.tag ?? "alive";
  const exclude = new Set(payload.exclude ?? []);

  // ---- 4. 받을 토큰 모으기 ----
  const tokenSnap = await db.collection("fcmTokens").get();
  const tokens: string[] = [];
  tokenSnap.forEach((d) => {
    if (!exclude.has(d.get("uid") as string)) tokens.push(d.id);
  });
  if (tokens.length === 0) return NextResponse.json({ sent: 0 });

  // ---- 5. 발송 ----
  // notification 대신 data만 보낸다. 그래야 서비스 워커의 onBackgroundMessage가
  // 항상 호출돼서 아이콘·클릭 이동을 우리가 통제할 수 있다.
  let sent = 0;
  const dead: string[] = [];

  for (let i = 0; i < tokens.length; i += BATCH) {
    const part = tokens.slice(i, i + BATCH);
    const res = await messaging.sendEachForMulticast({
      tokens: part,
      data: { title, body, href, tag },
      webpush: {
        headers: { Urgency: "high", TTL: "86400" },
        fcmOptions: { link: href },
      },
    });
    sent += res.successCount;
    res.responses.forEach((r, idx) => {
      const code = r.error?.code ?? "";
      // 기기를 바꿨거나 앱을 지운 경우 → 죽은 토큰이므로 정리
      if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
        dead.push(part[idx]);
      }
    });
  }

  // ---- 6. 죽은 토큰 청소 ----
  // 놔두면 발송할 때마다 계속 실패하며 쌓인다
  if (dead.length > 0) {
    const batch = db.batch();
    dead.slice(0, 500).forEach((t) => batch.delete(db.collection("fcmTokens").doc(t)));
    await batch.commit().catch(() => {});
  }

  return NextResponse.json({ sent });
}
